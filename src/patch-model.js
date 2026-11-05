/**
 * dsh-cookie-cleaner — patch 结构判定内核（纯函数，零 IO）。
 *
 * 存在的理由：profile 的 `cordis.patch.yml` 是**补丁层**而不是条目列表，它的语义有三个
 * 反直觉的坑（全部有源码依据，见 `.agents/plans/cookie-patch-guard/findings.md`）：
 *
 * 1. patch 行按**顶层键浅赋值**（`cordis-plugin-include/src/index.ts:120-123`），所以
 *    `config:` 是整块替换而非深合并——漏写的键落回该插件的 **schema 默认**，不是落回
 *    bundle 层的值（`webserver.compression` 默认就是 `none`）；
 * 2. `name` 与宿主 bundle 行不一致时**整行静默跳过**，只在启动日志留一行 warn；
 * 3. 层顺序是 bundle layers → profile → **home** → `--patch` overlay，home 里同 id 行会把
 *    profile 的写盖掉（官方 `configEditor` 写前检查的正是这一条）。
 *
 * 本模块只吃数据、只出结构化判定（code/level/params），**不碰文件系统、不取宿主服务、
 * 不出文案**：文案由 `report.js` 经 i18n 字典渲染，IO 由 `patch-guard.js`（宿主半）与
 * `cli.js`（只读行解析）各自负责。这样宿主半与 CLI 共用一份判定，不可能各说一套。
 */

/** @typedef {'ok'|'warn'|'fail'|'skipped'} Level */

/** 受管行：`writable` = 「修复」按钮可动（**只给 cookie 寿命**）；webserver 行只参与只读判定，本插件不写它。 */
export const MANAGED_ROWS = Object.freeze({
  connection: Object.freeze({
    id: 'connection',
    name: '@deepseek-ai/dsh-client-connection',
    writable: true,
    /** cookie 寿命的唯一杠杆（`connection/src/index.ts:113` 为 `natural().min(1).default(30)`）。 */
    key: 'cookieMaxAgeDays',
    minimum: 1,
  }),
  webserver: Object.freeze({
    id: 'webserver',
    name: '@deepseek-ai/dsh-host-webserver',
    writable: false,
    key: 'port',
  }),
})

/**
 * 本插件**不写端口**（用户裁决 2026-11-05）：防 431 真正有效的是 cookie 寿命注入，
 * 端口只是上游给的另一条可选缓解。原先的 `PORT_WRITE` / `isValidPort` /
 * `portExpressionFor` / `nextPortConfig` 已全部删除；`webserver` 行仍参与只读判定（P8）。
 */

/** 档位优先级：聚合时取最高；`skipped` 中性，永不冒充异常。 */
const LEVEL_RANK = Object.freeze({ fail: 3, warn: 2, ok: 1, skipped: 0 })

/** `!!js` 表达式在 configEditor 往返里的表示形态（VERIFIED@0.2.1-rc.5）。 */
export function isExpression(value) {
  return value !== null && typeof value === 'object' && typeof value.__jsExpr === 'string' && Object.keys(value).length === 1
}

function nonNegativeInt(value) {
  return typeof value === 'number' && Number.isInteger(value)
}

/** 结构比较（值都是 JSON 安全形态：标量/数组/对象/`{__jsExpr}`）。 */
function sameValue(a, b) {
  if (a === b) return true
  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
}

/**
 * 值是否“有料”：空对象/空数组/空串/false/0 都视为默认形态（拿不出行为差异）。
 * 真机教训：`webserver.tls` 在 bundle 层与运行态之间只是 `{}` 与缺省形态的区别，
 * 却被告知「有偏差」——两边都空就没什么可报的。
 */
function isMaterial(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value !== false && value !== 0 && value !== ''
  if (Array.isArray(value)) return value.length > 0 && value.some(isMaterial)
  if (typeof value === 'object') return Object.values(value).some(isMaterial)
  return true
}

/**
 * 非表达式键：只有「运行态与 bundle 层不同值、且至少一边真有内容」才算**可证明的丢**。
 * 真机噪声源：`webserver.tls` 这类 schema 默认键——浅赋值下它没写进覆盖行，
 * 但两边都只有默认形态（`{}` vs 缺省），行为上什么都没变，却被报成「有偏差」。
 * 运行态根本没有这个键 → 无从判定，中性，不编造结论。
 */
function isProvenLoss(key, inheritedValue, effective) {
  if (!(key in effective)) return false
  if (sameValue(inheritedValue, effective[key])) return false
  return isMaterial(inheritedValue) || isMaterial(effective[key])
}

/**
 * 判定单行。参数全部是**已经读好的数据**：
 * @param {{
 *   rowId: 'connection'|'webserver',
 *   entryFound: boolean,               // 宿主树里是否存在该 id 的可寻址条目
 *   overrideRow?: {name?:string, config?:Record<string,unknown>},  // profile 层的那一行
 *   inherited?: Record<string, unknown>,   // bundle 层配置（可能含 {__jsExpr}）
 *   effective?: Record<string, unknown>,   // 运行时组合后的配置
 *   targetDays?: number,                 // connection 的目标寿命；webserver 忽略
 *   shadowedBy?: 'home'|'overlay'|null,
 *   fileParse?: {ok: boolean, reason?: string},
 * }} input
 * @returns {{rowId:string, writable:boolean, level:Level, findings:Array<{code:string, level:Level, params:object}>}}
 */
export function assessRow(input) {
  const spec = MANAGED_ROWS[input.rowId]
  const findings = []
  const push = (code, level, params = {}) => findings.push({ code, level, params })
  const out = { rowId: input.rowId, writable: spec !== undefined && spec.writable === true, level: 'ok', findings, exprFrozen: [] }

  if (spec === undefined) {
    push('P00', 'skipped', { rowId: String(input.rowId) })
    return aggregate(out)
  }

  // P11：整层 YAML 非法（典型成因是模板根 `[]` 后面又追了分块行）——所有覆盖一起失效
  if (input.fileParse !== undefined && input.fileParse.ok === false) {
    push('P11', 'fail', { reason: input.fileParse.reason ?? 'invalid yaml' })
    return aggregate(out)
  }

  const { overrideRow, inherited = {}, effective = {} } = input
  const shadow = input.shadowedBy ?? null

  // P6：home 层或命令行 overlay 含同 id 行 → profile 的写会被盖掉（configEditor 也会拒写）
  if (shadow !== null) {
    push('P6', 'fail', { shadow, rowId: spec.id })
  }

  // P10：该 id 在当前宿主树里不存在 → 裸覆盖行静默跳过（`patch: entry "x" not found`）
  if (input.entryFound === false) {
    push('P10', 'fail', { rowId: spec.id, name: String(overrideRow?.name ?? spec.name) })
    return aggregate(out)
  }

  if (overrideRow === undefined) {
    // P1：没有覆盖行，且运行值确实不在目标档
    if (spec.id === 'connection') {
      const live = effective[spec.key]
      if (live !== input.targetDays) push('P1', 'warn', { current: live ?? '默认 30', target: input.targetDays })
    }
    return aggregate(out)
  }

  // P2：name 不一致 → 整行被静默跳过，配置实际未生效（最阴的一类：用户以为配上了）
  if (overrideRow.name !== undefined && overrideRow.name !== spec.name) {
    push('P2', 'fail', { got: String(overrideRow.name), expected: spec.name })
    return aggregate(out)
  }

  const config = overrideRow.config ?? {}

  if (spec.id === 'connection') {
    const value = config[spec.key]
    // P4：非法值（<1 / 非整数）。schema 会在落盘前挡住，所以这里是「别去试写」的硬闸
    if (value !== undefined && (!nonNegativeInt(value) || value < spec.minimum)) {
      push('P4', 'fail', { key: spec.key, got: String(value), minimum: spec.minimum })
    }
    // P3：合法但偏档
    else if (typeof value === 'number' && input.targetDays !== undefined && value > input.targetDays) {
      push('P3', 'warn', { key: spec.key, current: value, target: input.targetDays })
    }
  }

  // P5：只报**可证明的丢**（运行态与 bundle 层不同值且至少一边有内容）。键名清单不是证据。
  const dropped = Object.keys(inherited).filter((key) => !(key in config))
  const lostExpr = dropped.filter((key) => isExpression(inherited[key]))
  const provenLost = dropped.filter((key) => !isExpression(inherited[key]) && isProvenLoss(key, inherited[key], effective))
  if (provenLost.length > 0) {
    push('P5', 'warn', { rowId: spec.id, dropped: provenLost })
  }

  // P7：文件里的值与运行时组合值不一致 → 上层覆盖或热应用未跟上
  if (spec.id === 'connection' && config[spec.key] !== undefined && effective[spec.key] !== undefined
    && config[spec.key] !== effective[spec.key] && shadow === null) {
    push('P7', 'fail', { file: config[spec.key], effective: effective[spec.key] })
  }

  if (spec.id === 'webserver') {
    // P8：port 写成字面量会夺走 `--port` 旗标权（cmdline 文档原话「a flag beats the value written beside it」）
    const port = config[spec.key]
    if (port !== undefined && !isExpression(port)) {
      push('P8', 'warn', { port })
    }
  }

  // P9（表达式没保住形态）**不再进体检结论**：我们无权求值那个表达式，拿不出“现状有变化”的证据。
  // 两种形态都在这里：`frozen`（覆盖层抄成了字面量）与 `lostExpr`（根本没写，表达式整块被打掉）。
  // 数据留在 row.exprFrozen，由 plan/粘贴块那里说（那里同时能给回跟随形态的写法）。
  const frozen = Object.keys(inherited).filter((key) => isExpression(inherited[key]) && key in config && !isExpression(config[key]))
  const exprGone = [...frozen, ...lostExpr].sort()
  if (exprGone.length > 0) out.exprFrozen = exprGone

  return aggregate(out)
}

/** 聚合档位（fail > warn > ok；全为 skipped 才是 skipped，中性结论不得被当成 ok 或异常）。 */
export function aggregate(result) {
  const meaningful = result.findings.filter((f) => f.level !== 'skipped')
  if (result.findings.length === 0) result.level = 'ok'
  else if (meaningful.length === 0) result.level = 'skipped'
  else {
    const levels = meaningful.map((f) => f.level)
    result.level = levels.reduce((acc, level) => (LEVEL_RANK[level] > LEVEL_RANK[acc] ? level : acc), levels[0])
  }
  // 可动作 =  writable 且有非中性结论，且没有「写了也没用」的硬因：
  // P2 name 不对（要改的是文件里的字）、P4 非法值（schema 会拒）、P6 上层影子（盖不住）、
  // P10 id 不存在（写了也白写）、P11 整层非法（先修 YAML）。
  const blocked = ['P2', 'P4', 'P6', 'P10', 'P11']
  result.blocked = meaningful.some((f) => blocked.includes(f.code))
  result.actionable = result.writable === true
    && (result.level === 'warn' || result.level === 'fail')
    && !result.blocked
  return result
}

/** 整体聚合：任一 fail 即 fail；全 ok 才 ok。 */
export function aggregateAll(rows) {
  const usable = rows.filter((row) => row.level !== 'skipped')
  if (usable.length === 0) return { level: 'skipped', rows }
  const level = usable.some((row) => row.level === 'fail') ? 'fail' : usable.some((row) => row.level === 'warn') ? 'warn' : 'ok'
  return { level, rows }
}

/**
 * 产出写意图。**关键性质（VERIFIED@0.2.1-rc.5）**：`current` 来自运行时组合配置，
 * 其中表达式键已是 `{__jsExpr}` 形态，所以展开即保留——用户改过的 port、既有的表达式
 * 都不会被刷掉；我们只动要求的那一键。
 * @param {{current:Record<string,unknown>, targetDays?:number, guardMode?:'literal'|'expression', inherited?:Record<string,unknown>}} input
 * @returns {{next:Record<string,unknown>, changed:string[]}}
 */
export function nextConfigFor(input) {
  const current = input.current ?? {}
  const next = { ...current }
  const changed = []

  if (input.targetDays !== undefined && next.cookieMaxAgeDays !== input.targetDays) {
    next.cookieMaxAgeDays = input.targetDays
    changed.push('cookieMaxAgeDays')
  }
  // 表达式档：把 bundle 层本来就是表达式的键还原成 `{__jsExpr}`（表达式串取自 inherited，绝不硬编码）
  if (input.guardMode === 'expression' && input.inherited !== undefined) {
    for (const [key, value] of Object.entries(input.inherited)) {
      if (isExpression(value) && !isExpression(next[key])) {
        next[key] = value
        changed.push(key)
      }
    }
  }
  return { next, changed }
}

/**
 * 生成可直接粘贴的 patch 块（用于只读面：webserver 行、以及 CLI 无法写时的处方）。
 * 输出块序列形态，并提示 flow `[]` 根的坑（P11）。
 * @param {{rowId:'connection'|'webserver', inherited:Record<string,unknown>, current?:Record<string,unknown>, targetDays?:number, guardMode?:'literal'|'expression'}} input
 */
export function renderPlanBlock(input) {
  const spec = MANAGED_ROWS[input.rowId]
  const source = { ...(input.inherited ?? {}), ...(input.current ?? {}) }
  // 目标值在合成时就写进表里，避开「生成后再正则回改」这条脆路
  if (spec.id === 'connection' && input.targetDays !== undefined) source[spec.key] = input.targetDays
  const lines = [`- id: ${spec.id}`, `  name: '${spec.name}'`, '  config:']
  for (const [key, value] of Object.entries(source)) {
    if (isExpression(value)) {
      lines.push(`    ${key}: !!js ${value.__jsExpr}`)
    }
    else if (value === undefined) continue
    else if (Array.isArray(value)) lines.push(`    ${key}: ${value.length === 0 ? '[]' : JSON.stringify(value)}`)
    else if (typeof value === 'string') lines.push(`    ${key}: '${value}'`)
    else lines.push(`    ${key}: ${value}`)
  }
  return lines.join('\n')
}
