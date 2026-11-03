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
import { cookieCleanerCommandText, cleanCookies, statCookies } from './report.js'
import { installSettingsWaist } from './settings-waist.js'

/** Cordis 插件名（与 cordis.patch.yml 的 id 一致）。 */
export const name = 'cookie-cleaner'
export const inject = []

/** 默认配置（设置服务不可用时即用此值）。 */
export const DEFAULT_SETTINGS = Object.freeze({
  userDataRoot: '', // 覆盖 Electron userData 根（多实例/非默认安装位置用）
  expiredOnly: false, // 保守档：命令与脚本默认只把「已过期」当作可清理对象
})

export const Config = z.object({
  userDataRoot: z.string().default(DEFAULT_SETTINGS.userDataRoot).volatile().description('覆盖 Electron userData 根目录（默认按平台惯例自动定位）'),
  expiredOnly: z.boolean().default(DEFAULT_SETTINGS.expiredOnly).volatile().description('保守档：只统计/只提示已过期的 dsh-auth cookie'),
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
    let stat
    try {
      stat = statCookies({ userDataRoot: cfg.userDataRoot })
    } catch (e) {
      stat = { verdict: 'error', message: e && e.message ? e.message : String(e) }
    }
    return { stat, text: cookieCleanerCommandText(stat, cfg) }
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

  // ── /cookie-cleaner 命令（fail-open：commands 服务缺失只降级不 fatal）──
  ctx.effect(() => registerCookieCleanerCommand(ctx, status), `${name}: command register`)

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

  return { status, clean: cleanCookies }
}

/**
 * 注册 `/cookie-cleaner`。`commands` 服务只在 web/desktop 装配面存在，headless
 * fiber 上读 `ctx.commands` 本身即 throw 且会被启动审计判失败，所以用 `ctx.get()`
 * 探测（缺失返回 undefined、永不 throw），外罩窄域 try/catch 只吞代理拒绝文案。
 */
function registerCookieCleanerCommand(ctx, status) {
  try {
    const commands = typeof ctx.get === 'function' ? ctx.get('commands') : undefined
    if (typeof commands?.register !== 'function') return undefined
    return commands.register({
      name: 'cookie-cleaner',
      description: '查看 DSH 客户端 cookie 库里的本地登录凭据（dsh-auth-*）并给出清理命令。参数: status（默认）| clean（同样只读，只把措辞换成可直接执行的命令）',
      input: { hint: '[status|clean]' },
      handler: (invocation) => {
        const mode = String(invocation?.rawInput ?? '').trim().split(/\s+/)[0] === 'clean' ? 'clean' : 'status'
        try {
          const { text } = status({ mode })
          return { kind: 'text', text }
        } catch (e) {
          return { kind: 'error', text: `cookie-cleaner 失败: ${e.message}` }
        }
      },
    })
  } catch (e) {
    if (!/cannot get property "commands" without inject/.test(String(e?.message ?? e))) throw e
    return undefined
  }
}
