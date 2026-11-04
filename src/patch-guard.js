/**
 * dsh-cookie-cleaner — patch 体检/修复的宿主半适配层。
 *
 * 职责边界：这里只做「取数 + 调官方 configEditor + 落快照」，判定全在 `patch-model.js`，
 * 文案全在 `report.js` + `locales-patch.js`。写动作**一律走 `configEditor.edit()`**，
 * 不自己拼 YAML——官方通道自带文件锁、目标插件 Config schema 校验、home 影子检查、
 * 原子写与 reconcile 失败回滚（源码依据见 `.agents/plans/cookie-patch-guard/findings.md` §6）。
 *
 * 三条实测约束（0.2.1-rc.5，全部踩过）：
 * 1. 冷启动 `ctx.get('configEditor')` 是 undefined ⇒ 只能靠 scoped inject 的回调时机；
 * 2. 在 apply 执行链上直接 `edit()` 抛 `HMR transactions cannot be nested` ⇒ 写只能发生在
 *    用户触发的请求/命令回调链上，并对该错误做**一次退避重试**（P12），不硬失败；
 * 3. 写后 HMR 会热应用，无需重启；但必须回读 effective 才算「修好了」。
 */
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { MANAGED_ROWS, PORT_WRITE, aggregateAll, assessRow, isValidPort, nextConfigFor, nextPortConfig } from './patch-model.js'
import { findOverrideRow, parsePatchText, readPatchFile } from './patch-read.js'

/** 嵌套事务错误：热重载期间的正常现象，不是配置问题。 */
const NESTED_ERROR = /HMR transactions cannot be nested/i
const SNAPSHOT_DIR = 'cookie-cleaner'

/** DSH home（快照落这里，与 profile 目录解耦，删格不丢回滚能力）。 */
export function dshHome(env = process.env, homedir = os.homedir()) {
  const explicit = String(env.DSH_HOME ?? '').trim()
  return explicit !== '' ? explicit : path.join(homedir, '.dsh')
}

/**
 * 端口占用探针。**只探不占**：用 `connect` 看有人应答就算在用（而不是 bind 一个测试监听
 * 去抢端口）。目的是把“与你代理/科学上网工具常用端口撞车”这句话变成数据而不是猜测。
 * @returns {'busy'|'free'|'unknown'}
 */
export function probePort(port, host = '127.0.0.1', timeoutMs = 700) {
  return new Promise((resolve) => {
    if (!isValidPort(port)) return resolve('unknown')
    let settled = false
    const done = (value) => { if (!settled) { settled = true; resolve(value) } }
    const socket = net.connect({ host, port })
    const timer = setTimeout(() => { socket.destroy(); done('free') }, timeoutMs)
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); done('busy') })
    // 拒连/网络不可达 = 没人听；其余（权限、沙箱限制等）是无据，不假装知道
    socket.once('error', (e) => {
      clearTimeout(timer)
      const code = String(e && e.code)
      done(code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET' ? 'free' : 'unknown')
    })
    socket.once('timeout', () => { socket.destroy(); done('free') })
  })
}

/**
 * 快照的 profile 身份。**必须按 profile 隔离**：
 * 真机串台过一次——在隔离格跑的那次 fix 把快照留在全局单文件里，
 * 另一个 profile 的面板于是显示了别人的「上次修复」，更糟的是点「回滚」
 * 会把**别的 profile** 的旧 config 写进当前 profile。所有一旧的全局快照不再读。
 * 判据取 profile 目录名（`<home>/profiles/<name>/cordis.patch.yml`），推不出就用父目录名。
 */
export function snapshotKey(profileFile = '') {
  const parts = String(profileFile).split(/[\\/]+/).filter(Boolean)
  const at = parts.lastIndexOf('profiles')
  if (at >= 0 && parts[at + 1] !== undefined) return String(parts[at + 1])
  return parts.length > 1 ? String(parts[parts.length - 2]) : 'default'
}

export function snapshotFile(homeDir = dshHome(), profileFile = '') {
  return path.join(homeDir, SNAPSHOT_DIR, `patch-snapshot--${snapshotKey(profileFile)}.json`)
}

/** 深拷贝成 JSON 安全形态（`{__jsExpr}` 是普通对象，能直接过 JSON）。 */
function plain(value) {
  if (value === undefined) return undefined
  try { return JSON.parse(JSON.stringify(value)) } catch { return undefined }
}

function readSnapshot(file, fsModule) {
  try {
    const raw = JSON.parse(fsModule.readFileSync(file, 'utf8'))
    if (raw === null || typeof raw !== 'object') return undefined
    // v2：`{rows: {<rowId>: {config…}}}`；v1（旧形式）：单行 `{rowId, config…}`。
    if (raw.rows !== null && typeof raw.rows === 'object') return raw
    if (raw.config !== null && typeof raw.config === 'object') {
      const rowId = typeof raw.rowId === 'string' ? raw.rowId : 'connection'
      return { version: 2, profile: raw.profile, generatedAt: raw.generatedAt, rows: { [rowId]: raw } }
    }
    return undefined
  } catch { return undefined }
}

/** 把新一次的“写前值”并写入快照（cookie 寿命与端口是两个独立动作，各自回到各自的前值）。 */
function keepSnapshotRow(file, rowId, data, fsModule) {
  const base = readSnapshot(file, fsModule) ?? { version: 2, rows: {} }
  base.rows = { ...base.rows, [rowId]: data }
  base.profile = data.profile ?? base.profile
  base.generatedAt = data.generatedAt ?? base.generatedAt
  writeSnapshot(file, base, fsModule)
}

function writeSnapshot(file, data, fsModule) {
  fsModule.mkdirSync(path.dirname(file), { recursive: true })
  fsModule.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

/**
 * 造一个守卫。所有外部依赖都注入，方便单测与 CLI 侧共用判定。
 * @param {{
 *   getEditor: () => any,
 *   fs?: typeof import('node:fs'),
 *   env?: Record<string,string|undefined>,
 *   homeDir?: string,
 *   targetDays?: number,
 *   guardMode?: 'literal'|'expression',
 *   wait?: (ms:number) => Promise<void>,
 *   now?: () => number,
 * }} deps
 */
export function createPatchGuard(deps) {
  const {
    getEditor,
    fs: fsModule = fs,
    env = process.env,
    homeDir = dshHome(env),
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    probe = (port) => probePort(port),
  } = deps
  /** 可覆盖的目标档位由调用方（命令/路由）每次传入，避免守卫里存状态。 */
  const state = { homeDir }
  /** 快照路径按**当前 profile** 算（documentPath 只有 editor 就绪后才知道，不能构造时定死）。 */
  function snapFile() {
    const ce = getEditor()
    const doc = ce !== undefined && typeof ce.documentPath === 'string' ? ce.documentPath : ''
    return snapshotFile(homeDir, doc)
  }

  /** 组合 configEditor 的运行态与 profile 文件的字面态，喂给内核。 */
  function buildInput(rowId, ce, options) {
    const spec = MANAGED_ROWS[rowId]
    const entry = ce.entries().find((item) => item.options.id === spec.id)
    const configuration = (typeof ce.configuration === 'function' ? ce.configuration() : []).find((row) => row.entry.options.id === spec.id)
    const profileFile = ce.documentPath
    const profileRead = readPatchFileWith(fsModule, profileFile)
    const homeRead = readPatchFileWith(fsModule, path.join(state.homeDir, 'cordis.patch.yml'))

    // 覆盖行以**文件**为准：name 写错的行会被宿主静默跳过，此时 configuration().override 是空的，
    // 只有文件里看得到那行——P2 的价值恰恰在于「把看不见的失效说出来」。
    const fileRow = profileRead.parsed.ok ? findOverrideRow(profileRead.parsed, spec.id) : undefined
    const overrideRow = fileRow !== undefined
      ? { name: fileRow.name, config: fileRow.config ?? {} }
      : (configuration !== undefined && Object.keys(configuration.override ?? {}).length > 0
        ? { name: configuration.entry.options.name, config: configuration.override }
        : undefined)

    return {
      rowId: spec.id,
      entryFound: entry !== undefined,
      overrideRow,
      inherited: configuration?.inherited ?? {},
      effective: entry?.options?.config ?? configuration?.entry?.options?.config ?? {},
      targetDays: spec.id === 'connection' ? options.targetDays : undefined,
      shadowedBy: homeRead.exists && homeRead.parsed.ok && findOverrideRow(homeRead.parsed, spec.id) !== undefined ? 'home' : null,
      // 整层合法性：profile 层解析不了就是 P11；home 层解析不了只是看不见影子（不谎报）
      fileParse: profileRead.exists ? profileRead.parsed : { ok: true, rows: [], hadFlowRoot: false },
    }
  }

  function check(options = {}) {
    const ce = getEditor()
    if (ce === undefined || typeof ce.entries !== 'function') {
      return { level: 'skipped', reason: 'no-config-editor', rows: [], documentPath: '' }
    }
    const opts = { targetDays: options.targetDays ?? 1, ...options }
    const rows = Object.keys(MANAGED_ROWS).map((rowId) => assessRow(buildInput(rowId, ce, opts)))
    const documentPath = typeof ce.documentPath === 'string' ? ce.documentPath : ''
    // 上次修复的可审计信息：面板重开也该看得到，不能只在点完按钮那一瞬存在
    const snap = readSnapshot(snapFile(), fsModule)
    const connSnap = snap?.rows?.connection
    const lastFix = connSnap === undefined ? undefined : {
      at: connSnap.generatedAt ?? null,
      beforeDays: connSnap.config?.cookieMaxAgeDays,
      targetDays: connSnap.targetDays,
    }
    // 端口同理：面板重开也该看得“上次把端口改成了什么、现在听的是哪个”，不能只在点完那一瞬存在。
    const portSnap = snap?.rows?.webserver
    const lastPort = portSnap === undefined ? undefined : {
      at: portSnap.generatedAt ?? null,
      before: portSnap.config?.port,
      port: portSnap.port,
    }
    return { ...aggregateAll(rows), documentPath, rows, lastFix, lastPort, checkedAt: new Date(now()).toISOString() }
  }

  /** 只给用户看的粘贴块（webserver 行、以及 CLI 侧无法写时的处方）。 */
  function plan(options = {}) {
    const result = check(options)
    const ce = getEditor()
    if (ce === undefined) return { ...result, blocks: [] }
    // 有偏差的行要给粘贴块；**表达式被抄成字面量**的行也算（它不改档位，但只有这里能提）。
    const blocks = result.rows
      .filter((row) => row.findings.length > 0 || (row.exprFrozen ?? []).length > 0)
      .map((row) => {
        const spec = MANAGED_ROWS[row.rowId]
        const entry = ce.entries().find((item) => item.options.id === spec.id)
        const configuration = (ce.configuration() ?? []).find((item) => item.entry.options.id === spec.id)
        return {
          rowId: row.rowId,
          writable: spec.writable,
          exprFrozen: row.exprFrozen ?? [],
          block: nextBlockFor(row.rowId, configuration?.inherited ?? {}, entry?.options?.config ?? {}, options),
        }
      })
    return { ...result, documentPath: ce.documentPath ?? '', blocks }
  }

  function nextBlockFor(rowId, inherited, current, options) {
    // 表达式档：把 bundle 层原有的表达式还原回去（表达式串取自 inherited，绝不硬编码）
    const merged = { ...inherited, ...current }
    if (options.guardMode === 'expression') {
      for (const [key, value] of Object.entries(inherited)) {
        if (value !== null && typeof value === 'object' && typeof value.__jsExpr === 'string') merged[key] = value
      }
    }
    if (rowId === 'connection' && options.targetDays !== undefined) merged.cookieMaxAgeDays = options.targetDays
    return renderBlock(rowId, merged)
  }

  async function attemptEdit(entry, next) {
    const ce = getEditor()
    try {
      await ce.edit(entry, () => next)
      return { ok: true, nested: false }
    } catch (e) {
      const message = String(e && e.message ? e.message : e)
      if (!NESTED_ERROR.test(message)) return { ok: false, message, nested: false }
      // P12：热重载正在进行，退避一次再试；仍失败就如实报「稍后再点」，不谎报成功
      await wait(400)
      try {
        await ce.edit(ce.entries().find((row) => row.options.id === entry.options.id), () => next)
        return { ok: true, nested: true, retried: true }
      } catch (e2) {
        return { ok: false, message: String(e2 && e2.message ? e2.message : e2), nested: true }
      }
    }
  }

  /**
   * 修复：把 connection 行的 cookieMaxAgeDays 拉到目标档，其余键按运行态原样保留。
   * 判定为不可动作（P2/P4/P6/P10/P11）时**一次都不写**。
   */
  async function fix(options = {}) {
    const result = check(options)
    const target = result.rows.find((row) => row.rowId === MANAGED_ROWS.connection.id)
    if (target === undefined) return { kind: 'blocked', reason: 'no-connection-row', result }
    if (!target.actionable) {
      return { kind: 'blocked', codes: target.findings.map((f) => f.code), level: target.level, result }
    }
    const ce = getEditor()
    const entry = ce.entries().find((row) => row.options.id === MANAGED_ROWS.connection.id)
    if (entry === undefined) return { kind: 'blocked', codes: ['P10'], result }

    const before = plain(entry.options.config ?? {})
    const spec = MANAGED_ROWS.connection
    const configuration = (ce.configuration() ?? []).find((row) => row.entry.options.id === spec.id)
    const { next, changed } = nextConfigFor({
      current: entry.options.config ?? {},
      targetDays: options.targetDays ?? 1,
      guardMode: options.guardMode,
      inherited: configuration?.inherited ?? {},
    })
    if (changed.length === 0) return { kind: 'noop', result, before }

    const written = await attemptEdit(entry, next)
    if (!written.ok) return { kind: 'failed', message: written.message, nested: written.nested === true, result }

    try {
      keepSnapshotRow(snapFile(), spec.id, { name: spec.name, profile: snapshotKey(ce.documentPath ?? ''), config: before, at: now(), generatedAt: new Date(now()).toISOString(), targetDays: options.targetDays ?? 1 }, fsModule)
    } catch { /* 快照失败不影响已落盘的修复，只是少了回滚 */ }

    const after = ce.entries().find((row) => row.options.id === spec.id)
    const effective = after?.options?.config?.cookieMaxAgeDays
    const applied = effective === (options.targetDays ?? 1)
    // 写成功后回传**重新体检**的结果：把写前的 `result` 丢给面板会让它显示“已写入”同时
    // 又挂着“缺行・有偏差”（真机看到的就是这个矛盾）。
    const fresh = check(options)
    return { kind: applied ? 'fixed' : 'unverified', changed, before, beforeValue: before?.cookieMaxAgeDays, effective, applied, retried: written.retried === true, snapshotFile: snapFile(), snapshotAt: new Date(now()).toISOString(), result: fresh }
  }

  /**
   * 应用端口：只改 webserver 行的 `port`，且**永远写成表达式**（带数字字面量就是把 P8 自己造出来）。
   * 不并进「修复」：端口属启动行为面，必须用户显式点。目标值不存默认：非法/未给就拒。
   * 写前用探针看目标端口在本机是不是已经被占（与代理工具撞车就是这个场景），占用就不写；
   * 写后“运行中听到的是哪个端口”也用探针回答，不拿配置猜热生效。
   */
  async function applyPort(options = {}) {
    const port = Number(options.port)
    if (!isValidPort(port)) return { kind: 'invalid-port', got: options.port, minimum: PORT_WRITE.minimum, maximum: PORT_WRITE.maximum }
    const result = check(options)
    const row = result.rows.find((item) => item.rowId === PORT_WRITE.rowId)
    if (row === undefined) return { kind: 'blocked', reason: 'no-webserver-row', result }
    if (row.blocked === true) return { kind: 'blocked', codes: row.findings.map((f) => f.code), level: row.level, result }
    const ce = getEditor()
    const entry = ce.entries().find((item) => item.options.id === PORT_WRITE.rowId)
    if (entry === undefined) return { kind: 'blocked', codes: ['P10'], result }

    const configuration = (ce.configuration() ?? []).find((item) => item.entry.options.id === PORT_WRITE.rowId)
    const { next, changed, expr } = nextPortConfig({ current: entry.options.config ?? {}, inherited: configuration?.inherited ?? {}, port })
    if (changed.length === 0) return { kind: 'noop', port, expr, result }

    const state = await probe(port)
    if (state === 'busy') return { kind: 'port-busy', port, expr, probe: state, result }

    const before = plain(entry.options.config ?? {})
    const beforePort = typeof before?.[PORT_WRITE.key] === 'number' ? before[PORT_WRITE.key] : undefined
    const written = await attemptEdit(entry, next)
    if (!written.ok) return { kind: 'failed', message: written.message, nested: written.nested === true, result }

    try {
      keepSnapshotRow(snapFile(), PORT_WRITE.rowId, { name: PORT_WRITE.name, profile: snapshotKey(ce.documentPath ?? ''), config: before, at: now(), generatedAt: new Date(now()).toISOString(), port }, fsModule)
    } catch { /* 同上：快照失败不谎报写入失败 */ }

    const after = ce.entries().find((item) => item.options.id === PORT_WRITE.rowId)
    const live = after?.options?.config?.[PORT_WRITE.key]
    // 热生效与否看监听，不看配置：新端口有人听 = 已切；只有旧端口有人听 = 下次启动生效。
    const nowListening = await probe(port)
    const oldListening = beforePort === undefined ? 'unknown' : await probe(beforePort)
    const hotApplied = nowListening === 'busy' ? true : oldListening === 'busy' ? false : undefined
    return {
      kind: 'port-applied',
      port,
      expr,
      changed,
      before,
      beforePort,
      live,
      hotApplied,
      probeState: state,
      retried: written.retried === true,
      snapshotFile: snapFile(),
      snapshotAt: new Date(now()).toISOString(),
      result: check(options),
    }
  }

  /** 回到写之前的配置（快照按行存，一次回滚把各行各自回前值；缺失就明说，不猜）。 */
  async function revert() {
    const ce = getEditor()
    if (ce === undefined || typeof ce.edit !== 'function') return { kind: 'no-editor' }
    const snapshot = readSnapshot(snapFile(), fsModule)
    if (snapshot === undefined || Object.keys(snapshot.rows ?? {}).length === 0) return { kind: 'no-snapshot', snapshotFile: snapFile() }

    const restored = []
    const failed = []
    let lastChanged = []
    let connEffective
    for (const [rowId, saved] of Object.entries(snapshot.rows)) {
      const entry = ce.entries().find((row) => row.options.id === rowId)
      if (entry === undefined) { failed.push({ rowId, code: 'P10' }); continue }
      const current = plain(entry.options.config ?? {})
      const written = await attemptEdit(entry, saved.config)
      if (!written.ok) { failed.push({ rowId, message: written.message }); continue }
      restored.push(rowId)
      lastChanged = diffKeys(current, saved.config)
      if (rowId === MANAGED_ROWS.connection.id) {
        connEffective = ce.entries().find((row) => row.options.id === rowId)?.options?.config?.cookieMaxAgeDays
      }
    }
    if (restored.length === 0) return { kind: 'failed', message: failed[0]?.message ?? 'nothing restored', failed }
    return {
      kind: 'reverted',
      changed: lastChanged,
      rows: restored,
      failed,
      effective: connEffective,
      restoredFrom: snapshot.generatedAt ?? null,
    }
  }

  return { check, plan, fix, revert, applyPort, state }
}

/**
 * 离线（客户端已关、宿主不存在）只能查**文件层**：运行态与 bundle 层都读不到，
 * 所以 P5/P7/P9 这三类需要 bundle/运行态对比的规则不参与判定。宁缺毋滥：
 * 能定死的是「行在不在、name 对不对、值合不合法、有没有被 home 层盖住、整层语法能不能解」。
 * 与面板共用同一个 `assessRow`，绝不另开一套判定。
 * @param {{profileFile:string, homeFile?:string, targetDays?:number, fs?:typeof import('node:fs')}} options
 */
export function offlineCheck(options) {
  const { profileFile, homeFile = path.join(dshHome(), 'cordis.patch.yml'), targetDays = 1, fs: fsModule = fs } = options
  const profile = readPatchFileWith(fsModule, profileFile)
  // 「profile 根本不在这个位置」与「profile 在、但没这一行」是两回事：前者**无据**（skipped），
  // 后者才是真偏差（P1）。把前者判成缺行会把「用户敲错 profile 名」变成一条误导性的
  // 「cookie 会一直存活」异常，还会让退出码假绿（黑名单纪律：没真读到内容就不许 0）。
  // 目录在、仅文件缺（新建 profile 还没写过 patch）仍走 P1——那是可修的真缺陷。
  if (profile.exists === false && !fsModule.existsSync(path.dirname(profileFile))) {
    return {
      level: 'skipped',
      rows: [],
      actionable: false,
      reason: 'missing-profile',
      documentPath: profileFile,
      homePath: homeFile,
      offline: true,
      checkedAt: new Date().toISOString(),
    }
  }
  const home = readPatchFileWith(fsModule, homeFile)
  const rows = Object.keys(MANAGED_ROWS).map((rowId) => {
    const spec = MANAGED_ROWS[rowId]
    const fileRow = profile.parsed.ok ? findOverrideRow(profile.parsed, spec.id) : undefined
    return assessRow({
      rowId: spec.id,
      overrideRow: fileRow === undefined ? undefined : { name: fileRow.name, config: fileRow.config ?? {} },
      inherited: {},
      effective: {},
      targetDays: spec.id === 'connection' ? targetDays : undefined,
      shadowedBy: home.exists && home.parsed.ok && findOverrideRow(home.parsed, spec.id) !== undefined ? 'home' : null,
      fileParse: profile.exists ? profile.parsed : { ok: true, rows: [], hadFlowRoot: false },
    })
  })
  return { ...aggregateAll(rows), documentPath: profileFile, homePath: homeFile, offline: true, checkedAt: new Date().toISOString() }
}

function diffKeys(a, b) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  return [...keys].filter((key) => JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key]))
}

function readPatchFileWith(fsModule, file) {
  if (typeof file !== 'string' || file === '') {
    return { path: file, exists: false, text: '', parsed: { ok: true, rows: [], hadFlowRoot: false } }
  }
  if (fsModule === fs) return readPatchFile(file)
  // 注入替身（单测/多实例）时走等价路径，**同一份** parsePatchText，不另开一套解析
  let text = ''
  let exists = true
  try {
    text = fsModule.readFileSync(file, 'utf8')
  } catch (e) {
    if (e && e.code === 'ENOENT') { exists = false } else {
      return { path: file, exists: false, text: '', parsed: { ok: false, reason: String((e && e.code) || (e && e.message)), rows: [], hadFlowRoot: false } }
    }
  }
  return { path: file, exists, text, parsed: exists ? parsePatchText(text) : { ok: true, rows: [], hadFlowRoot: false } }
}

/** 把合并后的配置渲染成 YAML 块（与 patch-model 的 renderPlanBlock 同语义，此处避免循环依赖）。 */
function renderBlock(rowId, merged) {
  const spec = MANAGED_ROWS[rowId]
  const lines = [`- id: ${spec.id}`, `  name: '${spec.name}'`, '  config:']
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) continue
    if (value !== null && typeof value === 'object' && typeof value.__jsExpr === 'string') lines.push(`    ${key}: !!js ${value.__jsExpr}`)
    else if (Array.isArray(value)) lines.push(`    ${key}: ${value.length === 0 ? '[]' : JSON.stringify(value)}`)
    else if (typeof value === 'string') lines.push(`    ${key}: '${value}'`)
    else lines.push(`    ${key}: ${value}`)
  }
  return lines.join('\n')
}
