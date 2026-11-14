/**
 * dsh-cookie-cleaner — 运行期守护模块（薄整合自第三方 dsh-auth-cookie-guard）。
 *
 * 语义边界（本模块**只走 HTTP**，绝不打开 SQLite 写盘）：
 *
 *  1. 抬 webServer 监听器的 `server.maxHeaderSize`（默认 64 KiB）——431 在 Node 解析层就抛，
 *     不进 'request' 事件；不抬这个，退休逻辑根本没机会跑。Node 是**每 accept 一条新连接建
 *     parser 时**读该属性，所以运行时赋值即可对**新连接**当场生效（README 里那句"无需重启桌面端"
 *     的物理依据；对已建立的 keep-alive socket 无效，但 DSH 桌面每次启动都新建 TCP）。
 *  2. prepend 'request' 监听 `retire`：只解析 Cookie 头里的**名字**（形状 `dsh-auth-<43 base64url>`），
 *     浏览器 jar 按 creation-time 旧→新发送（RFC 6265 §5.4），所有启动 cookie 都是 Path=/，
 *     故尾部 keep 条 = 最新 keep 条；再加上"当前 host:port 派生的那条"保底，其余下发
 *     `Set-Cookie: name=; Max-Age=0; Path=/; Expires=...` 让浏览器自己从 jar 与磁盘库里退休。
 *  3. 每响应最多 96 条删除行（≈ 12 KiB），留在 Node HTTP 客户端 16 KiB 响应头预算之内；
 *     大 jar 分批多轮删完。
 *  4. 不解 cookie 值（值是签名会话载荷）、不写日志、不新增依赖（只用 node:crypto）。
 *
 * 与 dsh-auth-cookie-guard 的差异：本模块**由 dsh-cookie-cleaner 装载并在 config.runtimeGuard
 * 为 true 时才挂**；默认关，保持"离线 SQLite 清理 + 只读播报"的原语义。若与 dsh-auth-cookie-guard
 * 同时启用，二者语义不冲突但会双份下发删除行、日志重复——同一 profile 建议二选一。
 */

import { createHash } from 'node:crypto'

/** 上游 mint 的启动 cookie 前缀（dsh-client-connection 里 sha256(host:port) 的 base64url）。 */
const PREFIX = 'dsh-auth-'

/** 精确形状：前缀 + 43 字符 base64url 摘要。名字不合此形状一律不动（避免越界）。 */
const MINTED = /^dsh-auth-[A-Za-z0-9_-]{43}$/

/** 让浏览器删掉本条 cookie 的属性组合。Path=/ 必须匹配 mint 时的路径，不然命中不到。 */
const EXPIRATION = 'Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'

/** 单响应携带上限；~125 B/条 → ~12 KiB，稳在 undici/Node 默认 16 KiB 响应头预算之下。 */
const MAX_RETIRE_PER_RESPONSE = 96

/** 默认档位；可被 config 覆盖，但夹在 LIMITS 之间。 */
export const DEFAULTS = Object.freeze({ maxHeaderBytes: 64 * 1024, keep: 4, retireAbove: 0 })

/** 配置边界——防止误配把守护自己变成 431/内存杀手。 */
export const LIMITS = Object.freeze({
  maxHeaderBytes: [16 * 1024, 1024 * 1024],
  keep: [1, 64],
  retireAbove: [0, 10_000],
})

/**
 * 计算某 authority 对应的启动 cookie 名（与上游 mint 路径一致）。
 * http: 走 url.host（含端口），https: 走 url.origin。
 * @param {'http:'|'https:'} protocol
 * @param {string|undefined} host 形如 `127.0.0.1:34568` 的 authority
 * @returns {string|undefined} MINTED 名字；authority 不可读时 undefined
 */
export function cookieNameOf(protocol, host) {
  if (typeof host !== 'string' || host === '') return undefined
  try {
    const url = new URL(`${protocol}//${host}`)
    const authority = protocol === 'https:' ? url.origin : url.host
    return PREFIX + createHash('sha256').update(authority).digest('base64url')
  } catch {
    return undefined
  }
}

/**
 * 从 webServer 服务的 origin 读出协议与绑定 host，作为无 Host 头请求的兜底。
 * @param {{getOrigin?: () => string}} webServer
 * @returns {{protocol: string, boundName: string | undefined}}
 */
function listenerIdentity(webServer) {
  try {
    const url = new URL(webServer.getOrigin())
    return { protocol: url.protocol, boundName: cookieNameOf(url.protocol, url.host) }
  } catch {
    return { protocol: 'http:', boundName: undefined }
  }
}

/** 配置夹位；非法回退到默认。 */
function bounded(value, fallback, [min, max]) {
  const n = Number(value)
  if (value === undefined || value === null || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/**
 * 队列 Set-Cookie 删除行到当次响应的 writeHead 时刻，避免被应用层对象头 set-cookie 键整体替换吃掉。
 *
 * 真实握手是 `res.writeHead(303, { 'set-cookie': 会话 })` 的对象形态——Node 会**整块替换**同名键，
 * 提前 `res.setHeader('set-cookie', ...)` 会被覆盖掉。这里拦截 writeHead，把 pending 与
 * 应用层自己的 set-cookie 合并后再交给原方法，三种调用形态（对象、三参数、平铺数组）都覆盖。
 *
 * @param {import('node:http').ServerResponse} res
 * @param {string[]} lines `name=; Max-Age=0; Path=/; Expires=...` 序列化
 */
function armCookies(res, lines) {
  if (lines.length === 0) return
  const state = res[COOKIES] ?? (res[COOKIES] = { lines: [], armed: false })
  state.lines.push(...lines)
  if (state.armed) return
  state.armed = true

  const writeHead = res.writeHead
  res.writeHead = function (statusCode, statusMessage, headers) {
    const pending = state.lines
    let message
    if (typeof statusMessage === 'string') message = statusMessage
    else headers = statusMessage

    if (Array.isArray(headers)) {
      headers = [...headers, ...pending.flatMap((line) => ['set-cookie', line])]
    } else if (headers !== undefined && headers !== null) {
      const copy = {}
      const cookies = []
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'set-cookie') cookies.push(...normalizeCookieValues(headers[key]))
        else copy[key] = headers[key]
      }
      copy['set-cookie'] = [...cookies, ...pending]
      headers = copy
    } else {
      res.setHeader('set-cookie', [...normalizeCookieValues(res.getHeader('set-cookie')), ...pending])
    }

    return message === undefined
      ? writeHead.call(res, statusCode, headers)
      : writeHead.call(res, statusCode, message, headers)
  }
}

const COOKIES = Symbol('cookie-cleaner.runtime-guard.cookies')

/** 把 set-cookie 现值归一到数组形态，方便合并。 */
function normalizeCookieValues(value) {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * 装配运行期守护：抬 maxHeaderSize、挂 retire 监听；返回 dispose。
 *
 * @param {import('node:http').Server} server 原生 http.Server 引用（ctx.webServer.server）
 * @param {{
 *   maxHeaderBytes?: number,
 *   keep?: number,
 *   webServer?: { getOrigin?: () => string },
 *   onRetire?: (info: { total:number, retained:number, stale:number, emitted:number }) => void,
 * }} [opts]
 * @returns {() => void} dispose；再次调用无副作用
 */
export function installRuntimeGuard(server, opts = {}) {
  if (server === undefined || server === null) return () => {}

  const maxHeaderBytes = bounded(opts.maxHeaderBytes, DEFAULTS.maxHeaderBytes, LIMITS.maxHeaderBytes)
  const keep = bounded(opts.keep, DEFAULTS.keep, LIMITS.keep)
  // 阈值触发：条目数 > retireAbove 才开始退休；0 = 不设阈值（每次按 keep 收敛，现状）
  const retireAbove = bounded(opts.retireAbove, DEFAULTS.retireAbove, LIMITS.retireAbove)

  // ① 抬预算：Node 每 accept 时读该属性，运行时赋值对新连接立即生效。
  const previous = server.maxHeaderSize
  server.maxHeaderSize = maxHeaderBytes

  // 无 Host 头的请求兜底用监听器自己的 origin（webServer 有 getOrigin 就用；否则 http:）
  const { protocol, boundName } = listenerIdentity(opts.webServer ?? {})

  // ② 挂 retire：只匹配 MINTED 形状，保留 tail-keep ∪ current；每响应最多 96 条。
  function retire(req, res) {
    const header = req.headers.cookie
    if (typeof header !== 'string' || !header.includes(PREFIX)) return

    const names = []
    for (const segment of header.split(';')) {
      const at = segment.indexOf('=')
      if (at === -1) continue
      const name = segment.slice(0, at).trim()
      if (MINTED.test(name)) names.push(name)
    }
    if (names.length === 0) return
    // 阈值触发：jar 里合法启动 cookie 数 ≤ retireAbove 时完全不动（连 Set-Cookie 都不发）；
    // 只有“攒到 N 条以上”才按尾部 keep 收敛，对齐“大于 40 条才开始删”的诉求。
    if (retireAbove > 0 && names.length <= retireAbove) return

    const retained = new Set(names.slice(-keep))
    const current = cookieNameOf(protocol, req.headers.host) ?? boundName
    if (current !== undefined) retained.add(current)

    const stale = [...new Set(names)].filter((name) => !retained.has(name))
    if (stale.length === 0) return // 稳态幂等：不包装 writeHead

    const lines = stale.slice(0, MAX_RETIRE_PER_RESPONSE).map((name) => `${name}=; ${EXPIRATION}`)
    armCookies(res, lines)
    opts.onRetire?.({ total: names.length, retained: retained.size, stale: stale.length, emitted: lines.length })
  }
  server.prependListener('request', retire)

  let disposed = false
  return function dispose() {
    if (disposed) return
    disposed = true
    server.removeListener('request', retire)
    // 等值判断：防止有别的插件在我们之后又改过，dispose 别把新值踩回旧值。
    if (server.maxHeaderSize === maxHeaderBytes) server.maxHeaderSize = previous
  }
}

/**
 * 只读解析 Cookie 头：条数、启动 cookie（MINTED 形状）条数、实测字节数。
 * 不改任何东西、不下发 Set-Cookie。
 * @param {string|string[]|undefined} header `req.headers.cookie`
 * @returns {{total:number, minted:number, names:string[], headerBytes:number}}
 */
export function observeCookieHeader(header) {
  const text = Array.isArray(header) ? header.join('; ') : typeof header === 'string' ? header : ''
  const names = []
  let total = 0
  let headerBytes = text === '' ? 0 : Buffer.byteLength(text, 'utf8')
  for (const segment of text.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1) continue
    const name = segment.slice(0, at).trim()
    if (name === '') continue
    total += 1
    if (MINTED.test(name)) names.push(name)
  }
  return { total, minted: names.length, names, headerBytes }
}

/**
 * 只读水位观测臂：挂 `request` 监听记录最近一次 Cookie 头的水位。
 *
 * 为什么必须与退休解耦：真正触发 431 的是**浏览器实际发出的 Cookie 头**（内存 jar），
 * 而磁盘 jar 只在优雅退出时才落盘——强杀 / 崩溃后磁盘库会是旧的、甚至 0 条。
 * 所以“水位”不能只在 `runtimeGuard` 开启时才有：守护关掉时也得看得见，否则面板/命令
 * 只能报一个假的 0。
 *
 * @param {import('node:http').Server} server
 * @param {{now?:() => number, onObserve?:(info:object)=>void}} [opts]
 * @returns {{dispose:() => void, latest:() => object|undefined}}
 */
export function installCookieObserver(server, opts = {}) {
  if (server === undefined || server === null) return { dispose: () => {}, latest: () => undefined }
  const now = opts.now ?? Date.now
  let last
  function observe(req) {
    const parsed = observeCookieHeader(req?.headers?.cookie)
    if (parsed.total === 0) return // 没带 cookie 的请求不覆盖已有读数
    last = {
      total: parsed.total,
      minted: parsed.minted,
      unique: new Set(parsed.names).size,
      headerBytes: parsed.headerBytes,
      at: now(),
    }
    try { opts.onObserve?.(last) } catch { /* 观测不得弄挂请求 */ }
  }
  server.on('request', observe)
  let disposed = false
  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      server.removeListener('request', observe)
    },
    latest: () => last,
  }
}

/** 单响应携带上限（导出给测试断言用）。 */
export { MAX_RETIRE_PER_RESPONSE }
