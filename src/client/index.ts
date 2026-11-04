/**
 * dsh-cookie-cleaner — 浏览器半。
 *
 * 装载契约（三条都是事故换来的）：
 * - bundle id 必须 = **npm 包名**（`client/modules/src/index.ts:1040` 用 `graphRow(packageName,…)`），
 *   注册 id 与宿主图不一致时 client 半从不加载；
 * - 注册必须发生在 apply 顶层：关在任何 inject 回调里的注册两代都会静默失活；
 * - 每个面单独 `safe()`：未知槽名在个别宿主线上同步抛错，而 cordis 会吞掉 inject 回调的
 *   异常，一个面失败会带走同一回调里的其它面。
 *
 * `configForms`（0.1.7+）/`settingsScope`（≤0.1.5）是代际互斥服务，绝不写进插件级 inject——
 * 那会让整个 client fiber 在另一代上停在 pending。这里只依赖 `slots` + `locale`（三代齐）。
 */
import { dictionaries, NS, UI_KEYS } from './locales'
import { PatchCard } from './card'

/** 宿主 locale 服务的最小面（不引宿主类型包：client bundle 只按运行时形状用）。 */
interface LocaleService {
  register(ns: string, dicts: Record<string, Record<string, string>>): unknown
  bind?(ns: string): (key: string) => string
  on?(event: string, listener: () => void): unknown
}

interface SlotEntry {
  name: string
  id?: string
  /** keyed 槽必填（`ui-slots/src/index.ts:1222`：缺 key 直接 throw）。 */
  key?: string
  order?: number
  label?: () => string
  locale?: string
  inject?: () => Record<string, unknown>
}

interface SlotsService {
  inject(name: string, factory: () => Generator<unknown, void, unknown>): unknown
  register(entry: SlotEntry, component: unknown): unknown
}

interface ClientContext {
  get?(name: string): unknown
  inject(deps: readonly string[], fn: (ctx: ClientContext) => void): unknown
  effect(fn: () => unknown, label?: string): unknown
  slots?: SlotsService
  locale?: LocaleService
}

/** 插件级 inject 只声明三代都存在的服务。 */
export const inject = ['slots', 'locale'] as const

/** 当前语言的取词函数（注册后由 locale 服务提供；拿不到 bind 时回落 zh 字典）。 */
let currentT: (key: string) => string = (key) => {
  const zh = (dictionaries as Record<string, Record<string, string>>).zh
  return zh[key] ?? key
}

/** 每个面的独立 try/catch：一面抛错不带走其它面。 */
function safe(ctx: ClientContext, tag: string, fn: () => void): void {
  try {
    fn()
  } catch (error) {
    // 农场/真机拿不到 console 时也要留痕：失败面写进 window，供探针直接读取。
    const surface = ((globalThis as Record<string, unknown>).__dccSurf ??= []) as string[]
    surface.push(`${tag}: ${String((error as Error)?.message ?? error)}`)
    const logger = typeof ctx.get === 'function' ? ctx.get('logger') as { warn?(msg: string): void } : undefined
    if (typeof logger?.warn === 'function') logger.warn(`[dsh-cookie-cleaner] ${tag} failed: ${String((error as Error)?.message ?? error)}`)
  }
}

/**
 * 浏览器半入口。
 * @param ctx client context。
 */
export function apply(ctx: ClientContext): void {
  // 字典注册：一次调用带 9 语（map 式注册要求宿主 locale 服务接受任意语言码）。
  safe(ctx, 'locale.register', () => {
    if (typeof ctx.locale?.register !== 'function') throw new Error('locale service unavailable')
    ctx.locale.register(NS, dictionaries)
    const bind = ctx.locale.bind?.(NS)
    if (typeof bind === 'function') {
      // bind 是活的取值器：换语言后重渲染即跟上新值，卡片不自存语言副本。
      currentT = (key: string) => bind(key)
    }
  })

  // 席位 A：设置页顶级独立节（范式 A，不参与家族 tab 选举）。
  safe(ctx, 'settings.section', () => {
    const slots = ctx.slots
    if (slots?.inject === undefined || slots.register === undefined) throw new Error('slots service unavailable')
    slots.inject('settings.section', function* () {
      yield slots.register({
        name: 'settings.section',
        id: NS,
        order: 45,
        label: () => currentT('section.title'),
        locale: NS,
        inject: () => ({ t: (key: string) => currentT(key) }),
      }, PatchCard)
    })
  })

  // 席位 B：插件页配置卡（0.2.x 上「导出 Config 自动出表单」不成立，必须显式挂）。
  // 这个槽是 **keyed** 形态，key = bundle 的包名（真机报错：keyed slot requires options.key）。
  safe(ctx, 'plugins.bundle.config', () => {
    const slots = ctx.slots
    if (slots?.inject === undefined || slots.register === undefined) throw new Error('slots service unavailable')
    slots.inject('plugins.bundle.config', function* () {
      yield slots.register({
        name: 'plugins.bundle.config',
        key: NS,
        order: 45,
        label: () => currentT('section.title'),
        locale: NS,
        inject: () => ({ t: (key: string) => currentT(key) }),
      }, PatchCard)
    })
  })

  // 装载自检：键集没注册全就是构建坏了，立刻留痕而不是等用户点开空卡。
  safe(ctx, 'dictionary sanity', () => {
    const langs = Object.keys(dictionaries)
    if (langs.length !== 9) throw new Error(`expected 9 languages, got ${String(langs.length)}`)
    const missing = langs.filter((lang) => {
      const dict = (dictionaries as Record<string, Record<string, string>>)[lang]
      return UI_KEYS.some((key) => typeof dict[key] !== 'string' || dict[key] === '')
    })
    if (missing.length > 0) throw new Error(`empty keys for ${missing.join(', ')}`)
  })
}
