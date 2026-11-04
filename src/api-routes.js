/**
 * dsh-cookie-cleaner — 卡片到宿主的桥路由（四个端点，全部 POST-only）。
 *
 * 为什么走 `/api` 而不是 typert RPC：第三方卡片的宿主侧数据面在 perm-gate/free-search 上
 * 已跑通这一形态（`webServer.register({kind:'exact'})` + fetch POST），且面板只需几个
 * 幂等动作，不值得为它引入 remote 服务面。
 *
 * 路由派生式与 `src/client/routes.ts` **必须逐字符一致**，由 `tests/api-routes.test.js`
 * 用同一段字面量在两份源里双向核对——两半各持一份派生式而测试不钉，是 URL 漂移的老坑。
 */

/** 命名空间 = npm 包名（settings ns、卡 id、桥路径三处同串）。 */
export const NS = 'dsh-cookie-cleaner'

/** 四条路由：体检 / 修复 / 应用端口 / 回滚。 */
export function bridgeRoutesFor(ns = NS) {
  return Object.freeze({
    check: `/api/${ns}/patch/check`,
    fix: `/api/${ns}/patch/fix`,
    port: `/api/${ns}/patch/port`,
    revert: `/api/${ns}/patch/revert`,
  })
}

const MAX_BODY_BYTES = 64 * 1024

function sendJson(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(body))
}

/** 读 JSON body（有上限，超限直接拒——面板不该发大东西）。 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolve({}); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (e) { reject(new Error(`invalid json body: ${e.message}`)) }
    })
    req.on('error', reject)
  })
}

/**
 * cookie 库现状只留卡片需要看的字段（运行期必然 busy，不能谎报条数）。
 * @param {() => any} [stat]
 */
function cookieBrief(stat) {
  if (typeof stat !== 'function') return undefined
  try {
    const s = stat()
    if (s === undefined || s === null) return undefined
    return {
      verdict: s.verdict,
      reason: s.reason,
      path: s.path,
      authCookies: s.authCookies,
      totalCookies: s.totalCookies,
      bytes: s.bytes,
    }
  } catch { return undefined }
}

/**
 * 注册路由。
 * @param {unknown} webServer `webServer` 服务实例（只要求有 register）
 * @param {{check:(o:object)=>object, plan:(o:object)=>object, fix:(o:object)=>Promise<object>, applyPort:(o:object)=>Promise<object>, revert:()=>Promise<object>}} guard
 * @param {{lang?:string, targetDays?:number, guardMode?:string, port?:number, cookie?:() => any}} [defaults] 宿主设置里的默认档
 * @returns {Array<() => void>} 注销函数
 */
export function registerPatchRoutes(webServer, guard, defaults = {}) {
  const register = typeof webServer?.register === 'function' ? webServer.register.bind(webServer) : undefined
  if (register === undefined) return []
  const routes = bridgeRoutesFor(defaults.ns ?? NS)
  const offs = []

  /** 统一的一跳：POST-only、参数从 body 取、异常包成结构化错误。 */
  const endpoint = (path, run) => {
    offs.push(register({
      kind: 'exact',
      path,
      handler: (rawReq, rawRes) => {
        const req = rawReq
        const res = rawRes
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'method-not-allowed' })
          return
        }
        readJsonBody(req).then(async (body) => {
          const options = {
            targetDays: Number.isInteger(body?.targetDays) && body.targetDays >= 1 ? body.targetDays : defaults.targetDays,
            guardMode: body?.guardMode === 'expression' ? 'expression' : defaults.guardMode,
            lang: typeof body?.lang === 'string' ? body.lang : defaults.lang,
            // 端口不预填：body 没给就回退到设置值（可能是 0=未设定），合法/非法的取舍在守卫里做
            port: Number.isInteger(body?.port) && body.port >= 1 ? body.port : defaults.port,
          }
          const value = await run(options)
          sendJson(res, 200, { ok: true, value })
        }).catch((e) => {
          sendJson(res, 200, { ok: false, code: 'internal', message: String(e && e.message ? e.message : e) })
        })
      },
    }))
  }

  endpoint(routes.check, (options) => {
    const result = guard.check(options)
    const cookie = cookieBrief(defaults.cookie)
    return cookie === undefined ? result : { ...result, cookie }
  })
  endpoint(routes.fix, (options) => guard.fix(options))
  endpoint(routes.port, (options) => guard.applyPort(options))
  endpoint(routes.revert, () => guard.revert())
  return offs
}
