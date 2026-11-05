/**
 * dsh-cookie-cleaner — 借「已经打开这个文件的句柄」读被独占锁定的 cookie 库（Windows）。
 *
 * 为什么需要它：桌面端 Chromium 打开 `Network/Cookies` 时不给共享读，普通只读打开、
 * 复制到临时库、`?immutable=1` 全部失败（本机实测：`EBUSY` / `ERR_SQLITE_ERROR`）。
 * 但目标进程自己手里就有一个可用句柄 —— 把它 `DuplicateHandle` 过来就能读到字节。
 *
 * 本机（Windows 11 26H2 + Node 22 + 宿主自带 koffi）实测到的四条硬事实，全部写在这里而不是散在调用处：
 * 1. `NtQuerySystemInformation(SystemExtendedHandleInformation=64)` 一次约 27 万条，扫完约 9ms；
 * 2. x64 条目布局：`stride=40`，`Object@0 / UniqueProcessId@8 / HandleValue@16 / GrantedAccess@24 / ObjectTypeIndex@30`，表头 16 字节；
 * 3. `OpenProcess` 必须带 **PROCESS_QUERY_INFORMATION(0x40)**；只给 PROCESS_DUP_HANDLE(0x20) 或
 *    PROCESS_QUERY_LIMITED_INFORMATION(0x1000) 会被 `ERROR_ACCESS_DENIED(5)` 拒；`0x400|0x1000` 互斥混传也失败；
 * 4. 非可复制类型的句柄返回 err 50（ERROR_NOT_SUPPORTED），属正常，跳过即可。
 *
 * 纪律：整模块是**可选增强**。koffi 找不到、平台不是 win32、没匹配到句柄、读出来打不开
 * —— 一律返回 `{ok:false, reason}`，由调用方退回「读不到」档。**绝不猜数**。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'

export const EXTENDED_HANDLE_CLASS = 64
export const HANDLE_STRIDE = 40
export const HANDLE_TABLE_BASE = 16
export const PID_FIELD_OFFSET = 8
export const HANDLE_FIELD_OFFSET = 16
/** 唯一实测可用的 OpenProcess 权限位（见文件头第 3 条）。 */
export const PROCESS_QUERY_INFORMATION = 0x0040
export const DUPLICATE_SAME_ACCESS = 0x0002
export const TH32CS_SNAPPROCESS = 0x00000002
/** 进程条目：PROCESSENTRY32W 的 x64 布局（dwSize@0，th32ProcessID@8，szExeFile@44）。 */
export const PROCESS_ENTRY_SIZE = 568
export const PROCESS_ENTRY_PID_OFFSET = 8
export const PROCESS_ENTRY_NAME_OFFSET = 44
export const PROCESS_ENTRY_NAME_BYTES = 520
/** 单次快照读取上限：cookie 库实测 20–53 KB，给足余量但绝不无界。 */
export const MAX_SNAPSHOT_BYTES = 32 << 20
/** 分块读的大小：一次读到底比重复调用系统调用便宜。 */
const READ_CHUNK_BYTES = 1 << 20

/**
 * koffi 的候选位置。它**不在** profile 的依赖树里，只能扫宿主自己的安装位置；
 * 顺序即优先级，`DSH_KOFFI_PATH` 给运维留一个显式入口。
 * @param {{platform?:string, execPath?:string, env?:Record<string,string|undefined>, homedir?:string, exists?:(p:string)=>boolean}} [input]
 * @returns {string[]}
 */
export function koffiCandidates(input = {}) {
  const {
    platform = process.platform,
    execPath = process.execPath,
    env = process.env,
    homedir = os.homedir(),
    exists = (p) => { try { return fs.existsSync(p) } catch { return false } },
  } = input
  if (platform !== 'win32') return []
  const appDir = path.dirname(execPath)
  const candidates = [
    // Electron 桌面端：原生模块解包在 app.asar.unpacked 下
    path.join(appDir, 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', 'koffi'),
    path.join(appDir, 'resources', 'app.asar.unpacked', 'node_modules', 'koffi'),
    path.join(appDir, 'node_modules', 'koffi'),
    // CLI 全局安装树：宿主包自己的嵌套依赖
    path.join(path.dirname(appDir), 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', 'koffi'),
    path.join(appDir, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', 'koffi'),
    // 用户级 DSH home（非标准安装/便携版）
    path.join(homedir, '.dsh', 'vendor', 'koffi'),
  ]
  const explicit = String(env.DSH_KOFFI_PATH ?? '').trim()
  const list = explicit === '' ? candidates : [explicit, ...candidates]
  return list.filter((p) => exists(p))
}

/**
 * 解析出可用的 koffi。任何异常都吞掉返回 undefined —— 调用方据此退回「读不到」。
 * @param {string[]} candidates
 * @param {(spec:string)=>any} [requireImpl]
 */
export function loadKoffi(candidates, requireImpl = createRequire(import.meta.url)) {
  for (const spec of candidates) {
    try {
      const mod = requireImpl(spec)
      // 注意：`func` 是 `koffi.load(...)` 返回的库句柄上的方法，koffi 顶层只有 `load`——
      // 拿 `func` 当顶层形状条件会把可用的 koffi 误判成没有（真机踩到）。
      const shape = (value) => value !== null && typeof value === 'object' && typeof value.load === 'function'
      const koffi = shape(mod) ? mod : shape(mod?.default) ? mod.default : undefined
      if (koffi !== undefined) return koffi
    } catch { /* 下一个候选 */ }
  }
  return undefined
}

/** 绑定需要的 Win32 入口。失败返回 undefined（不抛）。 */
export function openApi(koffi) {
  if (koffi === undefined) return undefined
  try {
    const k32 = koffi.load('kernel32.dll')
    const ntdll = koffi.load('ntdll.dll')
    return {
      koffi,
      NtQuerySystemInformation: ntdll.func('int32_t NtQuerySystemInformation(uint32_t, void *, uint32_t, uint32_t *)'),
      CreateToolhelp32Snapshot: k32.func('void *CreateToolhelp32Snapshot(uint32_t, uint32_t)'),
      Process32FirstW: k32.func('int32_t Process32FirstW(void *, void *)'),
      Process32NextW: k32.func('int32_t Process32NextW(void *, void *)'),
      OpenProcess: k32.func('void *OpenProcess(uint32_t, int32_t, uint32_t)'),
      GetCurrentProcess: k32.func('void *GetCurrentProcess()'),
      DuplicateHandle: k32.func('int32_t DuplicateHandle(void *, void *, void *, void *, uint32_t, int32_t, uint32_t)'),
      GetFinalPathNameByHandleW: k32.func('uint32_t GetFinalPathNameByHandleW(void *, void *, uint32_t, uint32_t)'),
      SetFilePointerEx: k32.func('int32_t SetFilePointerEx(void *, int64_t, void *, uint32_t)'),
      GetFileSizeEx: k32.func('int32_t GetFileSizeEx(void *, void *)'),
      ReadFile: k32.func('int32_t ReadFile(void *, void *, uint32_t, void *, void *)'),
      CloseHandle: k32.func('int32_t CloseHandle(void *)'),
    }
  } catch {
    return undefined
  }
}

/**
 * 从进程条目里取 PID 与可执行文件名（纯函数，便于脱离 FFI 单测）。
 * @param {Buffer} entry PROCESSENTRY32W 缓冲区
 */
export function readProcessEntry(entry) {
  if (entry === undefined || entry.length < PROCESS_ENTRY_SIZE) return undefined
  const pid = entry.readUInt32LE(PROCESS_ENTRY_PID_OFFSET)
  const raw = entry.toString('utf16le', PROCESS_ENTRY_NAME_OFFSET, PROCESS_ENTRY_NAME_OFFSET + PROCESS_ENTRY_NAME_BYTES)
  const exe = raw.split('\u0000')[0] ?? ''
  return { pid, exe }
}

/**
 * 目标进程判定：**同一镜像名**或**父进程**，不写死品牌名。
 *
 * 真机坑：`PROCESSENTRY32W.szExeFile` 只是**映像基名**（`node.exe`、`DeepSeek Harness.exe`），
 * 不是完整路径 —— 拿它去比目录会永远不匹配（集成测试当场拓出来的）。
 * 桌面端主进程/渲染进程/GPU/工具子进程共用同一个镜像名，正好就是我们要找的那批。
 * @param {{pid:number, exe:string}} processEntry
 * @param {{selfPid:number, selfExe:string, ppid?:number}} scope
 */
export function isTargetProcess(processEntry, scope) {
  const { pid, exe } = processEntry
  if (pid === undefined || pid === scope.selfPid) return false
  if (scope.ppid !== undefined && pid === scope.ppid) return true
  const name = String(exe ?? '')
  if (name === '') return false
  return path.basename(name).toLowerCase() === String(scope.selfExe ?? '').toLowerCase()
}

/** 枚举目标 PID（快照失败返回空数组，绝不抛）。 */
export function targetPids(api, scope = {}) {
  const {
    selfPid = process.pid, ppid = process.ppid,
    selfExe = path.basename(process.execPath),
  } = scope
  const found = new Set()
  if (typeof ppid === 'number' && ppid > 0 && ppid !== selfPid) found.add(ppid)
  let snapshot
  try {
    snapshot = api.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if (snapshot === null || snapshot === undefined || snapshot === 0n) return [...found]
    const entry = Buffer.alloc(PROCESS_ENTRY_SIZE)
    entry.writeUInt32LE(PROCESS_ENTRY_SIZE, 0)
    let more = api.Process32FirstW(snapshot, entry)
    let guard = 0
    while (more === 1 && guard < 65536) {
      const info = readProcessEntry(entry)
      if (info !== undefined && isTargetProcess(info, { selfPid, ppid, selfExe })) found.add(info.pid)
      more = api.Process32NextW(snapshot, entry)
      guard += 1
    }
    api.CloseHandle(snapshot)
  } catch {
    /* 快照不可用就只靠 ppid，仍然可能借到 */
  }
  return [...found]
}

/**
 * 解析句柄表，取目标进程持有的句柄值（纯函数：给定 Buffer 就能测）。
 * @param {Buffer} table NtQuerySystemInformation 的原始输出
 * @param {Iterable<number>} pids 目标 PID 集合
 * @param {{limit?:number}} [options]
 * @returns {Array<{pid:number, handle:bigint}>}
 */
export function handleEntriesFor(table, pids, options = {}) {
  const { limit = 2_000_000 } = options
  const wanted = new Set(pids)
  const out = []
  if (table === undefined || table.length < HANDLE_TABLE_BASE + HANDLE_STRIDE) return out
  const total = Number(table.readBigUInt64LE(0))
  const scan = Math.min(total, limit)
  for (let i = 0; i < scan; i++) {
    const base = HANDLE_TABLE_BASE + i * HANDLE_STRIDE
    if (base + HANDLE_STRIDE > table.length) break
    const pid = Number(table.readBigUInt64LE(base + PID_FIELD_OFFSET))
    if (!wanted.has(pid)) continue
    out.push({ pid, handle: table.readBigUInt64LE(base + HANDLE_FIELD_OFFSET) })
  }
  return out
}

/** `\\?\C:\dir\file` 这类 DOS 设备前缀要去掉再比；大小写不敏感。 */
export function normalizeHandlePath(name) {
  const text = String(name ?? '')
  const stripped = text.startsWith('\\\\?\\') ? text.slice(4) : text
  return stripped.toLowerCase()
}

/** 句柄表查询：容量不足时按返回长度重试。返回 Buffer 或 {error}。 */
function queryHandleTable(api) {
  const needed = Buffer.alloc(4)
  let size = 1 << 22
  for (let attempt = 0; attempt < 5; attempt++) {
    const table = Buffer.alloc(size)
    const status = api.NtQuerySystemInformation(EXTENDED_HANDLE_CLASS, table, size, needed) >>> 0
    if (status === 0) return table
    // STATUS_INFO_LENGTH_MISMATCH：按系统要求的长度再来一次
    if (status === 0xc0000004) {
      size = Math.max(needed.readUInt32LE(0) + (4 << 20), size * 2)
      continue
    }
    return { error: `ntstatus=0x${status.toString(16)}` }
  }
  return { error: 'handle table too large' }
}

/**
 * 借句柄读出文件字节。成功返回 Buffer，失败返回 `{ok:false, reason}`。
 * 只做读：不写、不改共享模式、不关闭别人的句柄（只关自己 dup 出来的那份）。
 *
 * 预算不是装饰：按基名匹配时目标可能是几十个同名进程 × 上百句柄，每次 dup+取路径都是 FFI 调用。
 * 所以：每个 PID 只 `OpenProcess` 一次（不是每句柄一次）、按 pids 给定的优先级逐个试、
 * 命中即返回，并有时间/次数两道上限。超预算就明说 `scan-budget`，不拿“读不到”伪装成偶然。
 * @param {object} api openApi() 的结果
 * @param {{filePath:string, pids:number[], maxBytes?:number, maxAttempts?:number, budgetMs?:number, now?:()=>number}} input
 */
export function borrowBytes(api, input) {
  const { filePath, pids } = input
  const maxBytes = input.maxBytes ?? MAX_SNAPSHOT_BYTES
  const maxAttempts = input.maxAttempts ?? 20000
  const budgetMs = input.budgetMs ?? 1200
  const now = input.now ?? Date.now
  if (api === undefined) return { ok: false, reason: 'no-ffi' }
  if (!Array.isArray(pids) || pids.length === 0) return { ok: false, reason: 'no-target-pids' }
  const table = queryHandleTable(api)
  if (!Buffer.isBuffer(table)) return { ok: false, reason: table.error }
  const wanted = normalizeHandlePath(filePath)
  const self = api.GetCurrentProcess()
  const outHandle = Buffer.alloc(8)
  const nameBuf = Buffer.alloc(4096 * 2)
  const sizeBuf = Buffer.alloc(8)
  const readBuf = Buffer.alloc(4)
  const started = now()
  const order = new Map()
  for (const entry of handleEntriesFor(table, pids)) {
    const list = order.get(entry.pid) ?? []
    list.push(entry.handle)
    order.set(entry.pid, list)
  }
  let attempts = 0
  for (const pid of pids) {
    const handles = order.get(pid)
    if (handles === undefined || handles.length === 0) continue
    const processHandle = api.OpenProcess(PROCESS_QUERY_INFORMATION, 0, pid)
    const opened = processHandle !== null && processHandle !== undefined && processHandle !== 0n
    if (!opened) continue
    for (const handle of handles) {
      attempts += 1
      if (attempts > maxAttempts || now() - started > budgetMs) {
        api.CloseHandle(processHandle)
        return { ok: false, reason: 'scan-budget', attempts }
      }
      let copied
      try {
        copied = api.DuplicateHandle(processHandle, handle, self, outHandle, 0, 0, DUPLICATE_SAME_ACCESS)
      } catch {
        copied = 0
      }
      if (copied !== 1) continue
      const duplicate = outHandle.readBigUInt64LE(0)
      const length = api.GetFinalPathNameByHandleW(duplicate, nameBuf, 4096, 0)
      const name = length > 0 ? normalizeHandlePath(nameBuf.toString('utf16le', 0, Number(length) * 2).split('\u0000')[0]) : ''
      if (name !== wanted || name.includes('partitions')) {
        api.CloseHandle(duplicate)
        continue
      }
      api.CloseHandle(processHandle)
      if (api.GetFileSizeEx(duplicate, sizeBuf) !== 1) { api.CloseHandle(duplicate); return { ok: false, reason: 'size-unknown' } }
      const bytes = Number(sizeBuf.readBigUInt64LE(0))
      if (!Number.isInteger(bytes) || bytes <= 0) { api.CloseHandle(duplicate); return { ok: false, reason: 'size-invalid' } }
      if (bytes > maxBytes) { api.CloseHandle(duplicate); return { ok: false, reason: 'too-large' } }
      if (api.SetFilePointerEx(duplicate, 0, null, 0) !== 1) { api.CloseHandle(duplicate); return { ok: false, reason: 'seek-failed' } }
      const chunks = []
      let done = 0
      let broken = false
      const chunk = Buffer.alloc(Math.min(bytes, READ_CHUNK_BYTES))
      while (done < bytes) {
        const want = Math.min(chunk.length, bytes - done)
        readBuf.writeUInt32LE(0, 0)
        const ok = api.ReadFile(duplicate, chunk, want, readBuf, null)
        const got = readBuf.readUInt32LE(0)
        if (ok !== 1 || got === 0) { broken = true; break }
        chunks.push(Buffer.from(chunk.subarray(0, got)))
        done += got
      }
      api.CloseHandle(duplicate)
      if (broken || done !== bytes) return { ok: false, reason: 'read-incomplete' }
      return { ok: true, buffer: Buffer.concat(chunks, bytes), pid, bytes: done, attempts }
    }
    api.CloseHandle(processHandle)
  }
  return { ok: false, reason: 'handle-not-found', attempts }
}

/**
 * 一站式：解析 koffi → 找目标进程 → 借句柄 → 落临时快照。
 * 只读；临时文件在返回前写完，删除交给调用方（`statCookies` 读完再删）。
 * @param {{filePath:string, candidates?:string[], pids?:number[], requireImpl?:Function, now?:()=>number, tmpDir?:string, exists?:(p:string)=>boolean}} [input]
 * @returns {{ok:boolean, snapshotPath?:string, reason?:string, bytes?:number, source:'borrowed-handle'}}
 */
export function snapshotThroughHandle(input = {}) {
  const {
    filePath,
    requireImpl,
    now = () => Date.now(),
    tmpDir = os.tmpdir(),
  } = input
  const candidates = input.candidates ?? koffiCandidates(input)
  if (candidates.length === 0) return { ok: false, reason: 'koffi-not-found', source: 'borrowed-handle' }
  const koffi = loadKoffi(candidates, requireImpl)
  if (koffi === undefined) return { ok: false, reason: 'koffi-unsupported', source: 'borrowed-handle' }
  const api = openApi(koffi)
  if (api === undefined) return { ok: false, reason: 'ffi-bindings-failed', source: 'borrowed-handle' }
  // 显式 pids 优先（测试与定向排查用）；没给才去扫进程快照，并把父进程排第一位（真实场景里就是宿主本体）
  const pids = Array.isArray(input.pids) && input.pids.length > 0 ? input.pids : prioritizeParent(targetPids(api), process.ppid)
  const borrowed = borrowBytes(api, { filePath, pids, now })
  if (borrowed.ok !== true) return { ok: false, reason: borrowed.reason ?? 'borrow-failed', source: 'borrowed-handle' }
  const snapshotPath = path.join(tmpDir, `dcc-jar-${String(now())}.sqlite`)
  try {
    fs.writeFileSync(snapshotPath, borrowed.buffer)
  } catch (e) {
    return { ok: false, reason: `snapshot-write-${String(e && e.code ? e.code : e.message)}`, source: 'borrowed-handle' }
  }
  return { ok: true, snapshotPath, bytes: borrowed.bytes, source: 'borrowed-handle' }
}

/** 父进程优先：真实场景里 cookie 库就被宿主自己的进程持着，先试它能少扫很多。 */
export function prioritizePids(pids, first) {
  const list = [...new Set(pids.filter((pid) => typeof pid === 'number' && pid > 0))]
  if (typeof first !== 'number' || first <= 0) return list
  return [first, ...list.filter((pid) => pid !== first)]
}

function prioritizeParent(pids, parentPid) {
  return prioritizePids(pids, parentPid)
}
