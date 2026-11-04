/**
 * dsh-cookie-cleaner — profile patch 的**只读**解析器。
 *
 * 为什么手写而不引 YAML 库：插件要能在客户端关闭、宿主不存在的时候裸跑（npm bin），
 * 引第三方 YAML 会把「多一个依赖就多一次装机风险」搬进一个清理工具。
 * 代价被诚实地框住：这里只认 profile patch 层的**实际语法子集**——
 *   顶层块序列 `- ` 在第 0 列；`- id:` 覆盖行 / `- insert:` 新增行；
 *   条目字段 `id|name|config` 缩进 2；config 键缩进 4（靠「比 config: 更深」判定）；
 *   值形态只认 数字 / 布尔 / `'quoted'` / `[a, b]` / `[]` / `!!js 表达式`；行尾 ` #` 注释可剥。
 * 遇到子集外的构造（多文档、锚点、行内 flow 映射、游离缩进）一律 `ok:false` + 原因，
 * 由内核报 P11/skipped——**猜错的判定比不判定更坏**。
 *
 * 本模块只做数据，不判档、不写盘。
 */
import fs from 'node:fs'

/** 行的字段/值识别（行首 `- ` 与深度都直接在本层处理，不另存正则）。 */
const KEY_VALUE = /^(\w+):\s*(.*)$/

/** 解析一个 YAML 标量（够用子集）。`!!js` 前缀转成内核认识的 {__jsExpr}。 */
function parseScalar(raw) {
  const text = String(raw ?? '').trim()
  if (text === '' || text === '~' || text === 'null') return undefined
  if (text.startsWith('!!js ')) return { __jsExpr: text.slice(5).trim() }
  if (text === '[]') return []
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((part) => stripQuotes(part.trim()))
  }
  if (/^[-+]?\d+$/.test(text)) return Number(text)
  if (/^[-+]?\d*\.\d+$/.test(text)) return Number(text)
  if (text === 'true' || text === 'false') return text === 'true'
  return stripQuotes(text)
}

function stripQuotes(text) {
  if (text.length >= 2 && ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"')))) {
    return text.slice(1, -1)
  }
  return text
}

/** 剥行尾注释（` #` 才算，行首 `#` 是整行注释，交给调用方跳过）。 */
function stripComment(line) {
  const idx = line.indexOf(' #')
  return idx === -1 ? line : line.slice(0, idx)
}

function indentOf(line) {
  return line.match(/^\s*/)[0].length
}

function applyField(entry, key, raw) {
  if (key === 'id') entry.id = String(parseScalar(raw) ?? '')
  else if (key === 'name') entry.name = parseScalar(raw)
  else if (key === 'config') entry.config = entry.config ?? {}
  else entry[key] = parseScalar(raw)
}

/**
 * 解析 patch 文本。
 *
 * 只读**本层需要看到的深度**：顶层行（indent 0）与它的 `id|name|config`（indent 2）、
 * config 键（indent 4）；insert 块的新增条目（indent 4 及其字段 indent 6）。
 * **更深的嵌套（如 `providers:` 里的模型列表）直接跳过而不是判错**——真实 profile
 * 大量存在这种结构，把它们当语法错误会误报“整层失效”（真机踩到）。
 * @param {string} text
 * @returns {{ok: boolean, reason?: string, rows: Array<object>, hadFlowRoot: boolean, skippedDeep: number}}
 */
export function parsePatchText(text) {
  const rows = []
  let current = null   // 当前顶层行
  let entry = null     // 当前正在填字段的条目（顶层行本身，或 insert 的子条目）
  let fieldsIndent = 2 // 当前条目字段的缩进（顶层行 2；insert 子条目 6）
  let inConfig = false
  let configIndent = -1
  let hadFlowRoot = false
  let blockAfterFlowRoot = false
  let skippedDeep = 0
  const fail = (reason) => ({ ok: false, reason, rows, hadFlowRoot, skippedDeep })

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = stripComment(rawLine)
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    if (/^\[\]\s*$/.test(line)) { hadFlowRoot = true; continue }
    if (/^---/.test(line) || /^[^#]*&\w+/.test(line)) return fail('unsupported yaml construct')

    const indent = indentOf(line)
    const item = /^\s*-\s+(.*)$/.exec(line)

    if (item !== null && indent === 0) {
      if (hadFlowRoot) blockAfterFlowRoot = true
      inConfig = false
      configIndent = -1
      fieldsIndent = 2
      const content = item[1].trim()
      current = { insert: /^insert:\s*$/.test(content), bareId: !/^id:/.test(content) }
      rows.push(current)
      entry = current
      if (current.insert) continue
      const kv = content.match(KEY_VALUE)
      if (kv === null) return fail(`unparsable row header: ${content.slice(0, 40)}`)
      if (kv[1] === 'config') {
        if (/^\{.*\}$/.test(kv[2].trim())) return fail('inline flow map')
        configIndent = fieldsIndent
        inConfig = true
        applyField(entry, 'config', kv[2])
      }
      else applyField(entry, kv[1], kv[2])
      continue
    }

    if (item !== null && indent > 0) {
      // insert 块的新增条目（indent 4）；再深就是 config 里的嵌套列表 → 跳过不判
      if (current !== null && current.insert === true && indent === 4) {
        inConfig = false
        configIndent = -1
        fieldsIndent = indent + 2
        entry = { insert: false, bareId: false }
        current.entries = current.entries ?? []
        current.entries.push(entry)
        const kv = item[1].trim().match(KEY_VALUE)
        if (kv !== null) applyField(entry, kv[1], kv[2])
        continue
      }
      skippedDeep += 1
      continue
    }

    const kv = line.trim().match(KEY_VALUE)
    if (kv === null) { skippedDeep += 1; continue }
    if (entry === null) return fail('unexpected top-level indentation')

    // config 的键：深度必须恰好比 `config:` 本身多 2；更深的值是嵌套结构，不属于本次判定
    if (inConfig && indent === configIndent + 2) {
      if (/^\{.*\}$/.test(kv[2].trim())) return fail('inline flow map')
      entry.config = entry.config ?? {}
      entry.config[kv[1]] = parseScalar(kv[2])
      continue
    }
    if (inConfig && indent > configIndent + 2) { skippedDeep += 1; continue }
    inConfig = false
    if (indent !== fieldsIndent) { skippedDeep += 1; continue }
    if (kv[1] === 'config') {
      if (/^\{.*\}$/.test(kv[2].trim())) return fail('inline flow map')
      configIndent = indent
      inConfig = kv[2].trim() === ''
      applyField(entry, 'config', kv[2])
      continue
    }
    applyField(entry, kv[1], kv[2])
  }

  if (hadFlowRoot && (blockAfterFlowRoot || rows.length > 0)) {
    // P11 的真实成因：模板根 `[]` 是 flow 序列，其后再接分块行会让**整层**失效
    return fail('flow root `[]` followed by block rows')
  }
  return { ok: true, rows, hadFlowRoot, skippedDeep }
}

/** insert 块新增的条目 id（覆盖行的判定用不到，留给报告「本层新增了哪些行」）。 */
export function insertedIds(rows) {
  const out = []
  for (const row of rows ?? []) {
    if (row.insert !== true) continue
    for (const item of row.entries ?? []) if (item.id) out.push(item.id)
  }
  return out
}

/**
 * 读文件并解析。不存在 = `exists:false`（不算失败，交 P1 判缺）；解析不了 = `ok:false`。
 * @param {string} file
 * @returns {{path:string, exists:boolean, text:string, parsed:ReturnType<typeof parsePatchText>}}
 */
export function readPatchFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    return { path: file, exists: true, text, parsed: parsePatchText(text) }
  } catch (e) {
    const code = e && e.code
    if (code === 'ENOENT') return { path: file, exists: false, text: '', parsed: { ok: true, rows: [], hadFlowRoot: false } }
    return { path: file, exists: false, text: '', parsed: { ok: false, reason: String(code || (e && e.message)), rows: [], hadFlowRoot: false } }
  }
}

/** 取某个 id 的覆盖行（后写的赢——与 applyEntryPatches 的顺序语义一致）。 */
export function findOverrideRow(parsed, id) {
  if (!parsed || !Array.isArray(parsed.rows)) return undefined
  const hits = parsed.rows.filter((row) => row.insert === false && row.id === id)
  return hits.length === 0 ? undefined : hits[hits.length - 1]
}

/** 该 id 在本层是否被提到（覆盖行或 insert 的新条目）。 */
export function mentionsId(parsed, id) {
  if (!parsed || !Array.isArray(parsed.rows)) return false
  return parsed.rows.some((row) => (row.insert === false && row.id === id) || (row.insert === true && (row.entries ?? []).some((item) => item.id === id)))
}
