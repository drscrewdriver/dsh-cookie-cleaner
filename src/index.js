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
import { cookieCleanerCommandText, cleanCookies, patchOutcomeText, patchReportText, setLang, statCookies, statCookiesLive } from './report.js'
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
  // 没有 guardPort 设置项，也没有任何端口写入路径（用户裁决 2026-11-05）：
  // 本插件只改配置里的 cookie 有效期；端口属启动行为面，不在职责内。
})

export const Config = z.object({
  userDataRoot: z.string().default(DEFAULT_SETTINGS.userDataRoot).volatile().description('覆盖 Electron userData 根目录（默认按平台惯例自动定位）'),
  expiredOnly: z.boolean().default(DEFAULT_SETTINGS.expiredOnly).volatile().description('保守档：只统计/只提示已过期的 dsh-auth cookie'),
  lang: z.string().default(DEFAULT_SETTINGS.lang).volatile().description(`输出语言：${LANGS.join('/')}（留空=自动探测）`),
  guardDays: z.natural().min(1).default(DEFAULT_SETTINGS.guardDays).volatile().description('cookie 体检与修复写入的目标绝对寿命（天）——这是防 431 真正有效的那一项'),
  guardMode: z.string().default(DEFAULT_SETTINGS.guardMode).volatile().description("patch 修复形态：'literal' 只动目标键，'expression' 同时把 bundle 层的 !!js 表达式还原回去"),
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
      stat = statCookies({ userDataRoot: cfg.userDataRoot })
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
  /** @type {{check:Function, plan:Function, fix:Function, revert:Function} | undefined} */
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
      // 端口不预填：面板不再提供控件，命令面必须当场给数（没给则由守卫拒写）
      lang: cfg.lang ? normalize(cfg.lang) : undefined,
      // cookie 库现状随体检一起回：只有面板这条走阶梯（普通只读打开不行时才试借句柄快照）。
      cookie: () => statCookiesLive({ userDataRoot: current().userDataRoot }),
    })
    if (offs.length === 0) return
    sctx.effect(() => () => offs.forEach((off) => { try { off() } catch { /* 已回收 */ } }), `${name}: patch routes`)
  })

  /**
   * cookie 读数（命令面专用）：**只走普通只读打开，不借句柄**。
   *
   * 为什么不跟面板共用阶梯：扫一次全机句柄表只在“用户显式点了体检”时才值得，
   * 而命令面/启动播报会被测试与脚本反复调用，拿它去做系统级扫描会直接卡住
   * （真机实测：`patch check` 在命令面触发借句柄后整个测试文件超时）。
   * 而且独立进程的镜像名与桌面端不同，目标进程本来就匹配不上——诚实回 busy。
   */
  function cookieBriefForCommand() {
    return cookieBrief(() => statCookies({ userDataRoot: current().userDataRoot }))
  }

  /** patch 子命令的统一入口（写只发生在这里——用户触发的回调链，不在 HMR 事务内）。 */
  async function runPatch(sub) {
    const cfg = current()
    const opts = { targetDays: cfg.guardDays, guardMode: cfg.guardMode }
    if (guard === undefined) {
      return { text: patchReportText({ reason: 'no-config-editor', rows: [] }, { lang: undefined }) }
    }
    if (sub === 'fix') {
      const outcome = await guard.fix(opts)
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
      description: '查看 DSH 客户端 cookie 库里的本地登录凭据（dsh-auth-*）并给出清理命令；`patch check|fix|revert|plan` 体检/修复 profile 的 cordis.patch.yml（只改 cookie 有效期）。',
      input: { hint: '[status|clean] | patch [check|fix|revert|plan]' },
      handler: async (invocation) => {
        const tokens = String(invocation?.rawInput ?? '').trim().split(/\s+/).filter(Boolean)
        try {
          if (tokens[0] === 'patch') {
            // 没有 `port` 子命令：本插件不写端口（启动行为面不在职责内）。
            const sub = ['check', 'fix', 'revert', 'plan'].includes(tokens[1]) ? tokens[1] : 'check'
            const { text } = await runPatch(sub)
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
