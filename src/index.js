/**
 * dsh-cookie-cleaner — 宿主半（只读播报 + 工具入口，绝不在运行期写库）。
 *
 * 装载即工作：注册 `/cookie-cleaner` 命令 + 三代设置 waist。命令只做**只读**统计，
 * 并把「关闭客户端后自己跑一条命令」的处置直接打在聊天里——用户不必再找 AI 解析。
 *
 * 为什么不在这里执行清理（2026-11-04 对本机 0.2.1-rc.5 实测）：
 * - Host 是 Electron 的纯 Node 模式子进程，拿不到 `session.cookies`；
 * - 客户端在跑时 cookie 库被 Chromium 独占，Host runtime 只读打开都会抛
 *   `unable to open database file`；能否打开随时点漂移，不可依赖。
 * 因此写盘动作留在包内的独立脚本 `src/cli.js`（npm bin `dsh-cookie-cleaner`），
 * 在客户端关闭、宿主插件不存在的那个时间窗里执行。
 */
import z from '@deepseek-ai/schemastery'
import { cookieCleanerCommandText, cleanCookies, patchOutcomeText, patchReportText, setLang, statCookiesLive } from './report.js'
import { LANGS, detectLang, normalize } from './i18n.js'
import { installSettingsWaist } from './settings-waist.js'
import { createPatchGuard } from './patch-guard.js'
import { cookieBrief, registerPatchRoutes } from './api-routes.js'

/** Cordis 插件名（与 cordis.patch.yml 的 id 一致）。 */
export const name = 'cookie-cleaner'
export const inject = []

/** 默认配置（设置服务不可用时即用此值）。 */
export const DEFAULT_SETTINGS = Object.freeze({
  userDataRoot: '', // 覆盖 Electron userData 根（多实例/非默认安装位置用）
  expiredOnly: false, // 保守档：命令与脚本默认只把「已过期」当作可清理对象
  lang: '', // 输出语言（zh/en/ja/ko/fr/de/it/ru/es）；空=跟环境探测，探不到则 zh
  guardDays: 1, // patch 体检的目标cookie 绝对寿命（宿主 schema 要求 ≥1）
  guardMode: 'literal', // 'literal'=只动目标键 | 'expression'=把 bundle 层的 !!js 表达式还原回去
  // 面板「应用端口」要写的回落端口。**0 = 未设定**：插件不预填任何具体端口值（不把哪个官方默认写进代码），
  // 没填就不会写。
  guardPort: 0,
})

export const Config = z.object({
  userDataRoot: z.string().default(DEFAULT_SETTINGS.userDataRoot).volatile().description('覆盖 Electron userData 根目录（默认按平台惯例自动定位）'),
  expiredOnly: z.boolean().default(DEFAULT_SETTINGS.expiredOnly).volatile().description('保守档：只统计/只提示已过期的 dsh-auth cookie'),
  lang: z.string().default(DEFAULT_SETTINGS.lang).volatile().description(`输出语言：${LANGS.join('/')}（留空=自动探测）`),
  guardDays: z.natural().min(1).default(DEFAULT_SETTINGS.guardDays).volatile().description('cookie 体检的目标绝对寿命（天）；修复按钮就写这个值'),
  guardMode: z.string().default(DEFAULT_SETTINGS.guardMode).volatile().description("patch 修复形态：'literal' 只动目标键，'expression' 同时把 bundle 层的 !!js 表达式还原回去"),
  guardPort: z.natural().max(65535).default(DEFAULT_SETTINGS.guardPort).volatile().description('面板「应用端口」写入的回落端口（1-65535；0=未设定，不预填也不写）。写入形式是表达式，所以 `--port` 仍然优先'),
})

/** volatile 字段/字段级活引用解引出普通值。 */
export function resolveConfig(config) {
  if (config === null || typeof config !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(config)) {
    out[key] = value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
  }
  return out
}

/** 已知键合并默认值（未知键丢弃）。 */
function readConfig(config) {
  const resolved = resolveConfig(config)
  const out = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(out)) {
    const value = resolved[key]
    if (value !== undefined && value !== null) out[key] = value
  }
  return out
}

/**
 * @param {object} ctx Cordis 上下文。
 * @param {object} [config] patch 行下发的配置。
 */
export function apply(ctx, config = {}) {
  let current = () => readConfig(config)

  const log = (message) => {
    try {
      const logger = typeof ctx.logger === 'function' ? ctx.logger(name) : ctx.logger
      ;(logger?.info ?? logger?.log ?? console.log).call(logger ?? console, message)
    } catch {
      console.log(`[${name}]`, message)
    }
  }

  /** 只读现状 + 处置文案。overrides 可临时换档（`mode:'clean'` 只换措辞，仍不写盘）。 */
  function status(overrides = {}) {
    const cfg = { ...current(), ...overrides }
    // 设置里显式指定则优先，否则按环境探测（探不到落 zh）。
    const lang = normalize(cfg.lang || '')
    setLang(cfg.lang ? lang : detectLang())
    let stat
    try {
      stat = statCookiesLive({ userDataRoot: cfg.userDataRoot })
    } catch (e) {
      stat = { verdict: 'error', message: e && e.message ? e.message : String(e) }
    }
    return { stat, text: cookieCleanerCommandText(stat, { ...cfg, lang: undefined }) }
  }

  // ── 三代设置 waist（0.1.2/0.1.5 installSection、0.1.0/0.1.1 register、0.1.7+ volatile 托管）──
  installSettingsWaist(ctx, {
    ns: name,
    Config,
    base: () => resolveConfig(config),
    onSource: (source) => {
      current = () => readConfig(typeof source === 'function' ? source() : source)
    },
  })

  // ── patch 体检/修复守卫（只在 configEditor 就绪后存在；老线回调不触发，插件其余面照常）──
  /** @type {{check:Function, plan:Function, fix:Function, revert:Function, applyPort:Function} | undefined} */
  let guard
  ctx.inject(['configEditor', 'webServer'], (sctx) => {
    const editor = typeof sctx.get === 'function' ? sctx.get('configEditor') : undefined
    if (editor === undefined) return
    guard = createPatchGuard({ getEditor: () => editor })
    // 面板按钮的数据臂：两个服务都就绪才挂（缺任何一个都无法写）
    const server = typeof sctx.get === 'function' ? sctx.get('webServer') : undefined
    const cfg = current()
    const offs = registerPatchRoutes(server, guard, {
      targetDays: cfg.guardDays,
      guardMode: cfg.guardMode,
      // 端口不预填：用户没设就是 0（未设定），面板写时会被拒并提示先填
      port: cfg.guardPort,
      lang: cfg.lang ? normalize(cfg.lang) : undefined,
      // cookie 库现状随体检一起回：普通只读打开不行时会试借句柄快照，卡片据此区分实时/快照/读不到
      cookie: () => statCookiesLive({ userDataRoot: current().userDataRoot }),
    })
    if (offs.length === 0) return
    sctx.effect(() => () => offs.forEach((off) => { try { off() } catch { /* 已回收 */ } }), `${name}: patch routes`)
  })

  /**
   * cookie 实时读数（只读，与面板那条 API 同一个源）。
   * 字段清单复用 `api-routes.cookieBrief`：两半各自列一遍就是漂移的起点。
   * 读不到时它返回不带条数的形状，报告侧据此走 busy 档。
   */
  function cookieBriefForCommand() {
    return cookieBrief(() => statCookiesLive({ userDataRoot: current().userDataRoot }))
  }

  /** patch 子命令的统一入口（写只发生在这里——用户触发的回调链，不在 HMR 事务内）。 */
  async function runPatch(sub, overrides = {}) {
    const cfg = { ...current(), ...overrides }
    const opts = { targetDays: cfg.guardDays, guardMode: cfg.guardMode, port: cfg.guardPort }
    if (guard === undefined) {
      return { text: patchReportText({ reason: 'no-config-editor', rows: [] }, { lang: undefined }) }
    }
    if (sub === 'fix') {
      const outcome = await guard.fix(opts)
      return { text: patchReportText(outcome.result ?? guard.check(opts), { outcome }) }
    }
    if (sub === 'port') {
      // 启动行为面：端口必须用户当场给出，不拿设置里的默认值当“没填也写”的借口。
      const outcome = await guard.applyPort(opts)
      return { text: patchReportText(outcome.result ?? guard.check(opts), { outcome }) }
    }
    if (sub === 'revert') {
      const outcome = await guard.revert()
      return { text: patchOutcomeText(outcome) }
    }
    if (sub === 'plan') return { text: patchReportText(guard.plan(opts)) }
    // check 与面板同构：同一个 headerOccupancy 折算结果，两边不得各自算一套。
    return { text: patchReportText({ ...guard.check(opts), cookie: cookieBriefForCommand() }) }
  }

  // ── /cookie-cleaner 命令（fail-open：commands 服务缺失只降级不 fatal）──
  ctx.effect(() => registerCookieCleanerCommand(ctx, status, runPatch), `${name}: command register`)

  // ── 装载即播报一次（2s 延迟让宿主先起完；只读，绝不写盘）──
  ctx.effect(() => {
    const timer = setTimeout(() => {
      try {
        const { text } = status()
        log(text)
      } catch (e) {
        log(`现状播报失败: ${e.message}`)
      }
    }, 2000)
    return () => clearTimeout(timer)
  }, `${name}: startup report`)

  return { status, clean: cleanCookies, runPatch, patch: () => guard }
}

/**
 * 注册 `/cookie-cleaner`。`commands` 服务只在 web/desktop 装配面存在，headless
 * fiber 上读 `ctx.commands` 本身即 throw 且会被启动审计判失败，所以用 `ctx.get()`
 * 探测（缺失返回 undefined、永不 throw），外罩窄域 try/catch 只吞代理拒绝文案。
 *
 * 返回体必须是 `CommandResult`：宿主在注册边界上做硬校验
 * （`interaction/commands/src/index.ts:228-255`），`kind` 只认 `'success' | 'error'`，
 * 其它值直接 `throw unknown result kind`——这就是 0.1.x 的 `/cookie-cleaner` 在真宿主里
 * 每次调用都报错的原因（桅测只记了返回值、没校契约）。现在由
 * `tests/command-contract.test.js` 把这条规则钉住。
 */
function registerCookieCleanerCommand(ctx, status, runPatch) {
  try {
    const commands = typeof ctx.get === 'function' ? ctx.get('commands') : undefined
    if (typeof commands?.register !== 'function') return undefined
    return commands.register({
      name: 'cookie-cleaner',
      description: '查看 DSH 客户端 cookie 库里的本地登录凭据（dsh-auth-*）并给出清理命令；`patch check|fix|revert|plan|port <n>` 体检/修复 profile 的 cordis.patch.yml。',
      input: { hint: '[status|clean] | patch [check|fix|revert|plan|port <n>]' },
      handler: async (invocation) => {
        const tokens = String(invocation?.rawInput ?? '').trim().split(/\s+/).filter(Boolean)
        try {
          if (tokens[0] === 'patch') {
            const sub = ['check', 'fix', 'revert', 'plan', 'port'].includes(tokens[1]) ? tokens[1] : 'check'
            // `patch port 4300`：端口只从参数走，没给就交给守卫拒写（插件不代用户定端口）。
            const overrides = sub === 'port' && tokens[2] !== undefined ? { guardPort: Number(tokens[2]) } : {}
            const { text } = await runPatch(sub, overrides)
            return { kind: 'success', text }
          }
          const mode = tokens[0] === 'clean' ? 'clean' : 'status'
          const { text } = status({ mode })
          return { kind: 'success', text }
        } catch (e) {
          return { kind: 'error', text: `cookie-cleaner 失败: ${e && e.message ? e.message : String(e)}` }
        }
      },
    })
  } catch (e) {
    if (!/cannot get property "commands" without inject/.test(String(e?.message ?? e))) throw e
    return undefined
  }
}
