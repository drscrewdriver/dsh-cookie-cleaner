/**
 * dsh-cookie-cleaner — 三代宿主设置 waist（特性检测分派，禁止读版本号）。
 *
 * 检测点互斥、只用 settings 服务自身的方法：
 * - 0.1.2-rc.1 / 0.1.5-rc.x：实例带 `installSection`（注册 ns + 原生表单挂账 +
 *   `setSource` 换绑配置源；base 必须传 resolveConfig 解包后的普通值，活引用直传
 *   会 ValidationError 且 cordis 静默吞掉 inject 回调异常）；
 * - 0.1.0-rc.x / 0.1.1-rc.x：只有 `register/update/mutate/describe`（壳没有设置页，
 *   注册 ns 即拿到持久化与桥读写，非缺陷）；
 * - 0.1.7-rc.1+ / 0.2.x：两个注册 API 都已移除，volatile Config 由 loader 托管
 *   存储，本插件没有 client 卡，设置面即宿主自动表单。
 * 任何线缺方法都只降级（走 patch 配置 + 默认值），绝不 fatal。
 */
export function installSettingsWaist(ctx, { ns, Config, base, onSource }) {
  ctx.inject(['settings'], (sctx) => {
    const svc = sctx.settings
    if (typeof svc.installSection === 'function') {
      try {
        svc.installSection(ctx, ns, Config, base(), {
          setSource: (source) => onSource(source),
          onChange: () => {},
        })
        console.warn(`${ns}: settings via installSection (0.1.2/0.1.5 line)`)
      } catch (e) {
        console.warn(`${ns}: installSection FAILED:`, e?.stack ?? e)
      }
    } else if (typeof svc.register === 'function') {
      try {
        svc.register(ns, Config, { base: base() })
        console.warn(`${ns}: settings via register (0.1.0/0.1.1 line)`)
      } catch (e) {
        console.warn(`${ns}: register FAILED:`, e?.stack ?? e)
      }
    }
    // 其余代际：无需动作。
  })
}
