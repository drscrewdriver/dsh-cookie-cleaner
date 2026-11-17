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
import { installCookieObserver, installRuntimeGuard, DEFAULTS as GUARD_DEFAULTS, LIMITS as GUARD_LIMITS } from './runtime-guard.js'
import { MAX_HEADER_BYTES, detectNativeCleanup } from './core.js'

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
  // 运行期守护（薄整合自 dsh-auth-cookie-guard）：**拆成两个独立开关**（v0.7.0）。
  // retireStale 默认开：只发 `Set-Cookie: ...; Max-Age=0` 让浏览器丢历史启动 cookie，
  //   保留当前 authority 那条 + tail-keep，可逆、不碰 SQLite、不降鉴权强度 → 默认开是安全的。
  // raiseHeaderBudget 默认关：放宽 431 触发线属于「调松安全阈值」，不该被清理动作顺带打开。
  retireStale: true,
  raiseHeaderBudget: false,
  // 兼容旧字段：runtimeGuard=true 等价于同时打开上面两项。
  runtimeGuard: false,
  maxHeaderBytes: GUARD_DEFAULTS.maxHeaderBytes,
  keep: GUARD_DEFAULTS.keep,
  retireAbove: GUARD_DEFAULTS.retireAbove,
  // 没有 guardPort 设置项，也没有任何端口写入路径（用户裁决 2026-11-05）：
  // 本插件只改配置里的 cookie 有效期；端口属启动行为面，不在职责内。
})

export const Config = z.object({
  userDataRoot: z.string().default(DEFAULT_SETTINGS.userDataRoot).volatile().description('覆盖 Electron userData 根目录（默认按平台惯例自动定位）'),
  expiredOnly: z.boolean().default(DEFAULT_SETTINGS.expiredOnly).volatile().description('保守档：只统计/只提示已过期的 dsh-auth cookie'),
  lang: z.string().default(DEFAULT_SETTINGS.lang).volatile().description(`输出语言：${LANGS.join('/')}（留空=自动探测）`),
  guardDays: z.natural().min(1).default(DEFAULT_SETTINGS.guardDays).volatile().description('cookie 体检与修复写入的目标绝对寿命（天）——这是防 431 真正有效的那一项'),
  guardMode: z.string().default(DEFAULT_SETTINGS.guardMode).volatile().description("patch 修复形态：'literal' 只动目标键，'expression' 同时把 bundle 层的 !!js 表达式还原回去"),
  retireStale: z.boolean().default(DEFAULT_SETTINGS.retireStale).volatile().description('退休陈旧启动 cookie（默认开）：在响应里下发 Set-Cookie Max-Age=0，让浏览器自己丢掉历史端口的 dsh-auth-*；保留当前端口那条，不碰 SQLite'),
  raiseHeaderBudget: z.boolean().default(DEFAULT_SETTINGS.raiseHeaderBudget).volatile().description('抬高监听器头部预算（默认关）：把 server.maxHeaderSize 调到 maxHeaderBytes，放宽 431 的触发线——这是调松安全阈值，需显式开启'),
  runtimeGuard: z.boolean().default(DEFAULT_SETTINGS.runtimeGuard).volatile().description('旧开关（兼容保留）：true = 同时打开 retireStale 与 raiseHeaderBudget'),
  maxHeaderBytes: z.natural().default(DEFAULT_SETTINGS.maxHeaderBytes).volatile().description(`运行期守护的监听器头部预算（夹到 ${GUARD_LIMITS.maxHeaderBytes[0]}–${GUARD_LIMITS.maxHeaderBytes[1]} 字节）`),
  keep: z.natural().default(DEFAULT_SETTINGS.keep).volatile().description(`运行期守护保留的尾部 cookie 条数（夹到 ${GUARD_LIMITS.keep[0]}–${GUARD_LIMITS.keep[1]}；当前端口那条另行保底）`),
  retireAbove: z.natural().default(DEFAULT_SETTINGS.retireAbove).volatile().description(`阈值触发：启动 cookie 条数 > 此值才开始退休（0=不设阈值，每次按 keep 收敛；夹到 ${GUARD_LIMITS.retireAbove[0]}–${GUARD_LIMITS.retireAbove[1]}）`),
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
 * 借句柄快照阶梯是否启用。
 *
 * 只有在宿主进程里才可能找到“真正持有 cookie 库”的兄弟进程：
 * Electron 主进程（`process.type === 'browser'`）或以 Electron 为 node 的宿主子进程
 * （`process.versions.electron` 存在）。独立 node（单测/脚本）扫了也匹配不上，直接关掉。
 * `DSH_COOKIE_LIVE_LADDER=1|on` / `=0|off` 可显式覆盖（运维/定位用）。
 * @param {Record<string,string|undefined>} [env]
 * @param {{type?:string, versions?:Record<string,string|undefined>}} [proc]
 */
export function shouldUseLiveLadder(env = process.env, proc = process) {
  const flag = String(env.DSH_COOKIE_LIVE_LADDER ?? '').trim().toLowerCase()
  if (flag === '0' || flag === 'off') return false
  if (flag === '1' || flag === 'on') return true
  return proc.type === 'browser' || (proc.versions !== undefined && proc.versions.electron !== undefined)
}

/**
 * @param {object} ctx Cordis 上下文。
 * @param {object} [config] patch 行下发的配置。
 */
export function apply(ctx, config = {}) {
  let current = () => readConfig(config)
  /** 水位观测臂（只读）；由 webServer 注入回调装配，未就绪时为 null。 */
  let observer = null

  const log = (message) => {
    try {
      const logger = typeof ctx.logger === 'function' ? ctx.logger(name) : ctx.logger
      ;(logger?.info ?? logger?.log ?? console.log).call(logger ?? console, message)
    } catch {
      console.log(`[${name}]`, message)
    }
  }

  /**
   * cookie 读数（命令面 / 启动播报 / patch 共用）：先普通只读；被 Chromium 独占时
   * 走**和面板同一个内部 API**（`statCookiesLive`：借宿主自己持有的句柄做快照，
   * 内置 5s 节流 + 60s 缓存）——否则运行期只能回“读不到”，面板有水位的命令面却没水位。
   *
   * 阶梯只在宿主进程内启用（见 `shouldUseLiveLadder`）：独立 node（测试/脚本）
   * 镜像名匹配不上持库进程，扫全机句柄表是空转（真机实测会让整个测试文件超时）。
   */
  function readCookieStat(cfg) {
    let stat
    try {
      stat = statCookies({ userDataRoot: cfg.userDataRoot })
    } catch (e) {
      return { stat: { verdict: 'error', message: e && e.message ? e.message : String(e) }, ladder: 'plain-error' }
    }
    if (stat.reason !== 'busy' || !shouldUseLiveLadder()) return { stat, ladder: 'plain' }
    try {
      const live = statCookiesLive({ userDataRoot: cfg.userDataRoot })
      if (live && live.liveUnavailable !== true) return { stat: live, ladder: 'borrowed' }
      return { stat, ladder: `borrowed-unavailable:${(live && live.liveReason) || 'unknown'}` }
    } catch (e) {
      return { stat, ladder: `borrowed-error:${(e && e.message) || String(e)}` }
    }
  }

  /**
   * 水位优先级：**请求头实时观测 > 借句柄快照 > 普通只读**。
   *
   * 观测臂拿到的就是浏览器实际发出的 Cookie 头（内存 jar），也就是真正会撞 431 的那一份；
   * 磁盘读数只当辅证（它只在优雅退出时落盘，强杀后会是旧快照甚至 0 条）。
   * 没观测到启动 cookie（minted ≤ 0）时完全退回磁盘档，不编造数据。
   */
  function cookieWaterLevel(cfg) {
    const disk = readCookieStat(cfg)
    const observed = observer?.latest?.()
    if (observed === undefined || !(observed.minted > 0)) return disk
    const stat = disk.stat ?? {}
    const bytes = Number(observed.headerBytes) || 0
    const count = Number(observed.minted) || 0
    const average = bytes / Math.max(1, Number(observed.total) || count)
    return {
      ladder: 'observed-header',
      observed,
      stat: {
        ...stat,
        verdict: stat.verdict === 'error' ? stat.verdict : 'ok',
        reason: 'observed-header',
        authCookies: count,
        authLive: count,
        authExpired: 0,
        totalCookies: Math.max(Number(stat.totalCookies) || 0, Number(observed.total) || 0),
        header: {
          bytes,
          pct: Math.min(100, Math.round((bytes / MAX_HEADER_BYTES) * 1000) / 10),
          rawPct: Math.round((bytes / MAX_HEADER_BYTES) * 1000) / 10,
          maxHeaderBytes: MAX_HEADER_BYTES,
          basis: 'measured-header',
          threshold: Math.floor(MAX_HEADER_BYTES / Math.max(1, average)),
          remaining: Math.max(0, Math.floor((MAX_HEADER_BYTES - bytes) / Math.max(1, average))),
          over: bytes >= MAX_HEADER_BYTES,
        },
        source: 'request-header',
        snapshot: false,
        observedAt: observed.at,
        diskSource: stat.source,
        diskSnapshot: stat.snapshot === true,
      },
    }
  }

  /** 只读现状 + 处置文案。overrides 可临时换档（`mode:'clean'` 只换措辞，仍不写盘）。 */
  function status(overrides = {}) {
    const cfg = { ...current(), ...overrides }
    // 设置里显式指定则优先，否则按环境探测（探不到落 zh）。
    const lang = normalize(cfg.lang || '')
    setLang(cfg.lang ? lang : detectLang())
    const { stat, ladder, observed } = cookieWaterLevel(cfg)
    const text = cookieCleanerCommandText(stat, { ...cfg, lang: undefined })
    if (ladder === 'observed-header' && observed !== undefined) {
      return {
        stat,
        ladder,
        observed,
        text: `${text}\n  水位     实时（请求头观测）：${observed.minted}/${observed.total} 条，Cookie 头 ${observed.headerBytes} B，观测于 ${new Date(observed.at).toISOString()}`,
      }
    }
    if (ladder === 'borrowed') {
      const bytes = stat && stat.snapshotBytes
      return { stat, ladder, text: `${text}\n  读数     借宿主句柄快照（非实时${bytes ? `，${bytes} B` : ''}）` }
    }
    return { stat, ladder, text }
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

  // ── 运行期守护（薄整合自 dsh-auth-cookie-guard）——与 configEditor 解耦：只需 webServer 就绪 ──
  // v0.7.0：退休与抬预算拆成两个独立开关；且**优先让位给官方清理**（见下方 detectNativeCleanup）。
  // **不直接写 SQLite**，不开 session.cookies，只走 HTTP。
  ctx.inject(['webServer'], (gctx) => {
    const cfg = current()
    const webServer = typeof gctx.get === 'function' ? gctx.get('webServer') : gctx.webServer
    const server = webServer?.server
    if (server === void 0) {
      log('runtime guard 未启用：webServer 无 server 引用（headless/fiber 正常降级）')
      return
    }
    // ① 水位观测臂：**无条件挂**（与退休开关无关）。
    // 431 的真实水位来自浏览器实际发出的 Cookie 头（内存 jar）；磁盘 jar 只在优雅退出时落盘，
    // 强杀/崩溃后会一直是旧快照甚至 0 条——只读磁盘会把“守护关了”误报成“没有 cookie”。
    observer = installCookieObserver(server, {
      onObserve: (info) => { if (info.minted > 0) log(`cookie 水位：${info.minted} 条 dsh-auth-*（Cookie 头 ${info.headerBytes} B）`) },
    })
    gctx.effect(() => () => { observer?.dispose?.(); observer = null }, `${name}: cookie observer`)
    // ② 退休与抬预算：两个独立开关（v0.7.0）。旧字段 runtimeGuard=true 视为两者全开。
    const legacyOn = cfg.runtimeGuard === true
    const budgetOn = legacyOn || cfg.raiseHeaderBudget === true
    // 官方清理优先：宿主外壳自己会删 jar 里的 dsh-auth-*（desktop 0.2.2-rc.2+ 的
    // `removeLegacyHostCookies`，走 Electron `session.cookies.remove`，比我们发 Set-Cookie 更彻底），
    // 此时插件不该再抢着做同一件事——两套清理同时跑只会互相抵消日志、并让水位读数抖动。
    const native = detectNativeCleanup()
    let retireOn = legacyOn || cfg.retireStale === true
    if (retireOn && native.present) {
      retireOn = false
      log(`cookie 退休让位给官方清理（${native.evidence}）：宿主已自带 jar 清理，插件不再下发 Set-Cookie`)
    }
    if (!retireOn && !budgetOn) {
      log('运行期守护未启用：retireStale / raiseHeaderBudget 均为关（水位观测仍在跑）')
      return
    }
    const dispose = installRuntimeGuard(server, {
      maxHeaderBytes: cfg.maxHeaderBytes,
      raiseBudget: budgetOn,
      retire: retireOn,
      keep: cfg.keep,
      retireAbove: cfg.retireAbove,
      webServer,
      onRetire: (info) => log(`cookie 退休：${info.emitted}/${info.stale} 条，保留 ${info.retained}（合计 ${info.total}）`),
    })
    log(
      `运行期守护：retireStale=${String(retireOn)}, raiseHeaderBudget=${String(budgetOn)}`
      + `, budget=${String(cfg.maxHeaderBytes)} B, keep=${String(cfg.keep)}, retireAbove=${String(cfg.retireAbove)}, cap=96/response`,
    )
    gctx.effect(() => () => { dispose(); log('运行期守护已卸载') }, `${name}: runtime guard`)
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
      cookie: () => cookieWaterLevel(current()).stat,
      // 运行期守护面板臂：读当前生效值 / 写白名单四键（都走本插件自己的 configEditor 行）
      getGuard: () => guard.readGuard(),
      setGuard: (patch) => guard.writeGuard(patch),
      // 历史注入残留（v0.7.1）：清理能力以「官方是否已自带 cookie 清理」为准（0.2.2-rc.2+）。
      // 探测每次实时做（外壳可被升级/降级），结果不进缓存——一次 asar 扫描 ~0.7s，
      // 只在用户点开这条时才发生，不拖启动。
      getLegacy: () => guard.readLegacy({ nativeCleanup: detectNativeCleanup().present }),
      cleanLegacy: () => guard.cleanLegacy({ nativeCleanup: detectNativeCleanup().present }),
    })
    if (offs.length === 0) return
    sctx.effect(() => () => offs.forEach((off) => { try { off() } catch { /* 已回收 */ } }), `${name}: patch routes`)
  })

  /**
   * patch 体检里的 cookie 现状：与命令面 / 面板共用同一个阶梯（`readCookieStat`）。
   * 旧版这里故意不借句柄，导致桌面端体检报“读不到”而面板有水位——接线不一致。
   */
  function cookieBriefForCommand() {
    return cookieBrief(() => cookieWaterLevel(current()).stat)
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
    // 同时把运行期守护开关一并带下去，面板与命令面共用 guardOn/guardOff 两档文案（旧行为不受影响）。
    return { text: patchReportText({
      ...guard.check(opts),
      cookie: cookieBriefForCommand(),
      runtimeGuard: cfg.runtimeGuard === true,
      maxHeaderBytes: cfg.maxHeaderBytes,
      keep: cfg.keep,
    }) }
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
        const wantsJson = tokens.includes('--json')
        // 输出契约（dsh-tui notice 单块）：单行 ≤100、总行 ≤40（超出给提示）。
        const clipOut = (text) => {
          const lines = String(text ?? '').split('\n').map((line) => line.replace(/\s+$/, ''))
          const clipped = lines.map((line) => (line.length <= 100 ? line : `${line.slice(0, 99)}…`))
          if (clipped.length <= 40) return clipped.join('\n')
          return [...clipped.slice(0, 39), `… 还有 ${clipped.length - 39} 行`].join('\n')
        }
        const reply = (kind, sub, text, data) => {
          const clipped = clipOut(text)
          if (!wantsJson) return { kind, text: clipped }
          const payload = kind === 'error'
            ? { ok: false, cmd: 'cookie-cleaner', sub, error: { message: clipped.split('\n')[0] ?? clipped } }
            : { ok: true, cmd: 'cookie-cleaner', sub, data: data ?? { text: clipped } }
          return { kind, text: JSON.stringify(payload) }
        }
        // 本命令全宿主接线（Desktop/TUI/CLI 都走真实逻辑）：
        // TUI/CLI 上能读到就报，读不到就报原因 —— 不做「不适用」短路，
        // 否则桌面版的命令面就只剩提示、等于没接线。
        try {
          if (tokens[0] === 'patch') {
            // 没有 `port` 子命令：本插件不写端口（启动行为面不在职责内）。
            const sub = ['check', 'fix', 'revert', 'plan'].includes(tokens[1]) ? tokens[1] : 'check'
            const { text } = await runPatch(sub)
            return reply('success', `patch ${sub}`, text)
          }
          const mode = tokens[0] === 'clean' ? 'clean' : 'status'
          const { text, stat, ladder, observed } = status({ mode })
          // `--json` 把读数来源一并吐出：脚本能区分“实时观测 / 快照 / busy 回档”。
          return reply('success', mode, text, {
            text,
            ladder,
            source: (stat && stat.source) ?? 'plain-open',
            snapshot: (stat && stat.snapshot) === true,
            observed: observed ?? null,
            verdict: stat && stat.verdict,
            authCookies: stat && stat.authCookies,
            totalCookies: stat && stat.totalCookies,
            headerBytes: stat && stat.header && stat.header.bytes,
          })
        } catch (e) {
          return reply('error', tokens[0] ?? 'status', `cookie-cleaner 失败: ${e && e.message ? e.message : String(e)}`)
        }
      },
    })
  } catch (e) {
    if (!/cannot get property "commands" without inject/.test(String(e?.message ?? e))) throw e
    return undefined
  }
}
