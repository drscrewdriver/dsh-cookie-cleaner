/**
 * dsh-cookie-cleaner — 历史注入残留的识别与清理（纯函数面，可单测）。
 *
 * 为什么需要这个模块：
 * 0.2.1 之前，本插件曾在面板/命令面上提供过「应用端口」动作，把 `webserver` 行的
 * `port` 改写成表达式 `ctx.webStartup.port ?? +<用户填的数>`（见 556e37b 及更早）。
 * 2026-11-05 的裁决把端口写入能力整体删除（端口属启动行为面，不在本工具职责内），
 * 但**已经写进用户 profile 的那一行不会自己消失**——它留在 `cordis.patch.yml` 里继续生效。
 *
 * 这一行的危害不是"插件又写端口了"，而是：
 *   1. 用户以为本工具已经不碰端口，实际 profile 里还钉着当年填的数；
 *   2. 该表达式与 bundle 层原值可能已经不同（用户后来改过启动参数/升级过宿主），
 *      表现为「启动层没传 --port 时落在旧数字上」这种难以归因的行为；
 *   3. 卸载插件后残留仍在，用户找不到是谁写的。
 *
 * 清理原则（为什么只在 0.2.2-rc.2+ 执行）：
 *   - 0.2.2-rc.2 起桌面外壳自带 `removeLegacyHostCookies`，cookie 侧的历史包袱由官方接管，
 *     插件不再需要用"钉端口"这条侧路去压 cookie 增长；此时回收旧注入是纯收益。
 *   - 更早的宿主上，钉端口仍是上游 discussions 给的可选缓解之一，贸然回收可能让用户
 *     重新落回"每次启动随机端口 → cookie 累积"的老路，所以那一段只**报告不清理**。
 *
 * 安全边界（这条最重要）：**只删本插件自己写过的那一种形态**。
 * 判定必须同时满足：值是指向 `webStartup.port` 的 `!!js` 表达式。用户自己手写的
 * 字面量端口（P8 报的那类）、用户自己写的别的表达式，一律不碰——"看到但不替你改"。
 */
import { isExpression } from './patch-model.js'

/** 本插件历史版本写过的端口表达式形态：`ctx.webStartup.port ?? <fallback>`。 */
const LEGACY_PORT_EXPRESSION = /^\s*ctx\.webStartup\.port\s*\?\?\s*(\+?\s*\d+)\s*$/

/**
 * 判断一个 `!!js` 表达式值是否为本插件历史注入的端口表达式。
 * @param {unknown} value 运行态配置里的值（表达式已被内核转成 `{__jsExpr}`）
 * @returns {{ legacy: boolean, fallback?: number, expression?: string }}
 */
export function classifyLegacyPort(value) {
  if (!isExpression(value)) return { legacy: false }
  const expression = value.__jsExpr
  const hit = LEGACY_PORT_EXPRESSION.exec(expression)
  if (hit === null) return { legacy: false, expression }
  const fallback = Number(hit[1].replace(/[+\s]/g, ''))
  return {
    legacy: true,
    fallback: Number.isInteger(fallback) ? fallback : undefined,
    expression,
  }
}

/**
 * 扫描一行 config，找出本插件历史注入的残留。
 *
 * @param {{rowId?: string, current?: Record<string, unknown>, inherited?: Record<string, unknown>}} input
 *   `current` = 运行时组合后的配置；`inherited` = bundle 层原值（用于给出「还原成什么」）
 * @returns {{ found: boolean, rowId: string, key: string, expression?: string, fallback?: number, restoreTo?: unknown }}
 */
export function findLegacyInjection(input = {}) {
  const rowId = String(input.rowId ?? 'webserver')
  const current = input.current ?? {}
  const inherited = input.inherited ?? {}
  const classified = classifyLegacyPort(current.port)
  if (!classified.legacy) {
    return { found: false, rowId, key: 'port' }
  }
  const bundleValue = inherited.port
  return {
    found: true,
    rowId,
    key: 'port',
    expression: classified.expression,
    fallback: classified.fallback,
    // 还原目标：bundle 层原值（通常是另一个表达式，也可能是字面量）。
    // 拿不到 bundle 值时给 undefined，调用方据此只删覆盖行、不猜值。
    restoreTo: isExpression(bundleValue) || typeof bundleValue === 'number' ? bundleValue : undefined,
  }
}

/**
 * 产出去掉历史注入后的 config。
 *
 * 语义选择：**删除该键**而不是写回 bundle 原值。
 * 理由：覆盖行里少一个键 = 该键回落到 bundle 层默认，这正是"清理掉插件写的东西"该有的结果；
 * 把 bundle 表达式抄进 profile 反而把上游实现细节固化进了用户配置（上游一改就脱节）。
 *
 * @param {{current: Record<string, unknown>, key?: string}} input
 * @returns {{ next: Record<string, unknown>, changed: string[] }}
 */
export function withoutLegacyInjection(input) {
  const current = input.current ?? {}
  const key = String(input.key ?? 'port')
  if (!(key in current)) return { next: { ...current }, changed: [] }
  const next = { ...current }
  delete next[key]
  return { next, changed: [key] }
}

/**
 * 清理是否可执行 —— **以官方清理能力为准**，而不是版本号字符串。
 *
 * 为什么不判版本号：宿主 `ctx` 并不暴露版本（已核对 cordis/core 的 ctx 面），
 * 插件能拿到的只有"外壳里有没有 `removeLegacyHostCookies`"这个**事实**。
 * 而它恰好就是 0.2.2-rc.2 那条线的分界——官方接管了 cookie 清理，
 * 插件才不需要再用钉端口去压 cookie 增长，回收旧注入才是纯收益。
 *
 * @param {{nativeCleanup?: boolean}} input
 * @returns {boolean}
 */
export function canCleanLegacy(input = {}) {
  return input.nativeCleanup === true
}

/**
 * 宿主版本是否达到「可以安全回收旧注入」的线（0.2.2-rc.2+）。
 *
 * 不引入 semver 依赖：本插件只判这一条线，手写比较足够，且规则显式可测。
 * 版本串形态（上游实际发布）：`0.2.2-rc.2` / `0.2.2` / `0.2.1-rc.5`。
 *
 * @param {string} version 宿主版本（如 `0.2.2-rc.3`）
 * @returns {boolean}
 */
export function supportsLegacyCleanup(version) {
  const parsed = parseVersion(version)
  if (parsed === undefined) return false
  const [major, minor, patch, rc] = parsed
  if (major !== 0) return major > 0
  if (minor !== 2) return minor > 2
  if (patch !== 2) return patch > 2
  // 0.2.2 线：正式版（rc === null）或 rc >= 2 都可以；rc.0/rc.1 不行。
  return rc === null || rc >= 2
}

/** 解析 `x.y.z[-rc.n]`；解析不了返回 undefined（调用方按「不支持」处理，fail-safe）。 */
function parseVersion(version) {
  if (typeof version !== 'string') return undefined
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version.trim())
  if (m === null) return undefined
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? null : Number(m[4])]
}
