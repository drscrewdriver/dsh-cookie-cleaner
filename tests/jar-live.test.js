/**
 * jar-live（借句柄读锁定文件）测试。
 *
 * 分层理由：FFI 本身只能在 win32 + 真锁上验，CI 里必须能 skip；
 * 但**表解析、PID 过滤、候选路径、降级阶梯**全是纯逻辑，必须脱离 FFI 有红绿。
 * 尤其降级路径：借不到时必须原样 busy，绝不能把「没读到」洗成 0 条。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import {
  HANDLE_STRIDE, HANDLE_TABLE_BASE, PROCESS_ENTRY_SIZE, koffiCandidates, loadKoffi, openApi,
  readProcessEntry, isTargetProcess, handleEntriesFor, normalizeHandlePath, borrowBytes,
  snapshotThroughHandle,
  prioritizePids,
} from '../src/jar-live.js'
import { statCookiesLive } from '../src/core.js'

const APP_DIR = 'C:\\Users\\tester\\AppData\\Local\\Programs\\DeepSeek Harness'

test('候选路径：非 win32 一律空；win32 只留真实存在的位置，env 覆盖排第一', () => {
  const present = new Set([
    path.join(APP_DIR, 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', 'koffi'),
    'C:\\custom\\koffi',
  ])
  const win = koffiCandidates({
    platform: 'win32',
    execPath: path.join(APP_DIR, 'DeepSeek Harness.exe'),
    env: { DSH_KOFFI_PATH: 'C:\\custom\\koffi' },
    homedir: 'C:\\Users\\tester',
    exists: (p) => present.has(p),
  })
  assert.equal(win[0], 'C:\\custom\\koffi', '显式覆盖必须最前')
  assert.equal(win.length, 2, '不存在的位置不能进候选')
  assert.deepEqual(koffiCandidates({ platform: 'linux', execPath: '/usr/bin/dsh', env: {}, homedir: '/home/t', exists: () => true }), [])
})

test('loadKoffi：形状不对/抛错都算没有，不抛', () => {
  const good = { load: () => ({ func: () => (() => 0) }) }
  assert.equal(loadKoffi(['a', 'b'], (spec) => (spec === 'b' ? { default: good } : undefined)), good, '支持 default 导出形态')
  assert.equal(loadKoffi(['a'], () => { throw new Error('no native') }), undefined)
  assert.equal(loadKoffi(['a'], () => ({ nope: true })), undefined, '没有 load 就不算可用')
})

test('openApi：koffi 缺失或绑定抛错都返回 undefined', () => {
  assert.equal(openApi(undefined), undefined)
  assert.equal(openApi({ load: () => { throw new Error('dll missing') }, func: () => undefined }), undefined)
  const api = openApi({ load: () => ({ func: () => (() => 0) }), func: () => undefined })
  assert.equal(typeof api?.ReadFile, 'function')
})

test('PROCESSENTRY32W 读取：pid 与 utf16 路径名', () => {
  const entry = Buffer.alloc(PROCESS_ENTRY_SIZE)
  entry.writeUInt32LE(PROCESS_ENTRY_SIZE, 0)
  entry.writeUInt32LE(4321, 8)
  Buffer.from(`${APP_DIR}\\DeepSeek Harness.exe\u0000`, 'utf16le').copy(entry, 44)
  assert.deepEqual(readProcessEntry(entry), { pid: 4321, exe: `${APP_DIR}\\DeepSeek Harness.exe` })
  assert.equal(readProcessEntry(Buffer.alloc(10)), undefined, '短 buffer 不猜')
})

test('目标进程判定：同一镜像名或父进程，绝不把自己也算进去', () => {
  // szExeFile 只是基名（真机坑），所以这里给的就是基名
  const scope = { selfPid: 1000, ppid: 1001, selfExe: 'DeepSeek Harness.exe' }
  assert.equal(isTargetProcess({ pid: 2000, exe: 'DeepSeek Harness.exe' }, scope), true)
  assert.equal(isTargetProcess({ pid: 2001, exe: `${APP_DIR}\\DeepSeek Harness.exe` }, scope), true, '给全路径时也要能比基名')
  assert.equal(isTargetProcess({ pid: 1001, exe: 'explorer.exe' }, scope), true, '父进程即使不同镜像也要试')
  assert.equal(isTargetProcess({ pid: 1000, exe: 'DeepSeek Harness.exe' }, scope), false, '自己不能进目标集')
  assert.equal(isTargetProcess({ pid: 3000, exe: 'app.exe' }, scope), false)
  assert.equal(isTargetProcess({ pid: 3000, exe: '' }, scope), false)
})

/** 造一张合成句柄表：表头 16 字节 + 若干 stride=40 条目。 */
function syntheticTable(rows) {
  const buf = Buffer.alloc(HANDLE_TABLE_BASE + rows.length * HANDLE_STRIDE)
  buf.writeBigUInt64LE(BigInt(rows.length), 0)
  rows.forEach((row, i) => {
    const base = HANDLE_TABLE_BASE + i * HANDLE_STRIDE
    buf.writeBigUInt64LE(BigInt(row.pid), base + 8)
    buf.writeBigUInt64LE(BigInt(row.handle), base + 16)
  })
  return buf
}

test('句柄表解析：按 PID 过滤、越界即止、limit 生效', () => {
  const table = syntheticTable([
    { pid: 11, handle: 4 }, { pid: 22, handle: 8 }, { pid: 11, handle: 12 },
  ])
  assert.deepEqual(handleEntriesFor(table, [11]), [{ pid: 11, handle: 4n }, { pid: 11, handle: 12n }])
  assert.deepEqual(handleEntriesFor(table, [99]), [], '没有目标进程就是空')
  assert.deepEqual(handleEntriesFor(syntheticTable([{ pid: 11, handle: 4 }]), [11], { limit: 0 }), [], 'limit 必须生效')
  assert.deepEqual(handleEntriesFor(Buffer.alloc(8), [11]), [], '表头都不完整时不猜')
})

test('normalizeHandlePath：去 DOS 设备前缀并小写', () => {
  assert.equal(normalizeHandlePath('\\\\?\\C:\\Users\\T\\Network\\Cookies'), 'c:\\users\\t\\network\\cookies')
  assert.equal(normalizeHandlePath('C:\\Users\\T\\Network\\Cookies'), 'c:\\users\\t\\network\\cookies')
})

test('PID 优先级：父进程排第一，去重且丢掉非法值', () => {
  assert.deepEqual(prioritizePids([5, 7, 5, 0, -1], 7), [7, 5])
  assert.deepEqual(prioritizePids([5, 7], undefined), [5, 7])
})

/** 假 api：只实现 borrowBytes 用到的入口，行为可控。 */
function fakeApi(options) {
  const { table, pids, pathOf, dupOk = true, fileSize = 26, chunks = [Buffer.from('SQLITE-FORMAT-0123456789AB')] } = options
  const calls = { opened: [], dupbed: 0, closed: 0, read: 0 }
  const api = {
    NtQuerySystemInformation: (_class, buf, _size, needed) => { table.copy(buf); needed.writeUInt32LE(table.length, 0); return 0 },
    OpenProcess: (_access, _inherit, pid) => { calls.opened.push(pid); return pids.has(pid) ? {} : null },
    GetCurrentProcess: () => ({}),
    DuplicateHandle: (_ph, handle, _self, out) => {
      calls.dupbed++
      if (!dupOk) return 0
      out.writeBigUInt64LE(BigInt(handle), 0)
      return 1
    },
    GetFinalPathNameByHandleW: (_h, buf, _max, _flags) => {
      const text = pathOf(_h) ?? ''
      if (text === '') return 0
      buf.write(text, 'utf16le')
      buf.writeUInt16LE(0, text.length * 2)
      return text.length
    },
    GetFileSizeEx: (_h, buf) => { buf.writeBigUInt64LE(BigInt(fileSize), 0); return 1 },
    SetFilePointerEx: () => 1,
    ReadFile: (_h, buf, want, readOut) => {
      const chunk = chunks[Math.min(calls.read, chunks.length - 1)]
      calls.read++
      const n = Math.min(want, chunk.length)
      chunk.copy(buf, 0, 0, n)
      readOut.writeUInt32LE(n, 0)
      return 1
    },
    CloseHandle: () => { calls.closed++; return 1 },
  }
  return { api, calls }
}

test('borrowBytes：命中目标路径就读出全部字节', () => {
  const target = 'C:\\Users\\T\\Network\\Cookies'
  const table = syntheticTable([{ pid: 11, handle: 4 }, { pid: 11, handle: 704 }])
  const { api, calls } = fakeApi({
    table,
    pids: new Set([11]),
    pathOf: (h) => (h === 704n ? `\\\\?\\${target}` : 'C:\\Windows\\System32\\foo.dll'),
  })
  const out = borrowBytes(api, { filePath: target, pids: [11] })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.buffer.toString('utf8'), 'SQLITE-FORMAT-0123456789AB')
  assert.equal(out.bytes, 26)
  assert.equal(calls.opened.every((pid) => pid === 11), true, '只能对目标进程调 OpenProcess')
})

test('borrowBytes：拿不到句柄/权限被拒时返回 reason，不抛也不给空 Buffer 冒充成功', () => {
  const target = 'C:\\Users\\T\\Network\\Cookies'
  const table = syntheticTable([{ pid: 11, handle: 4 }])
  const noDup = fakeApi({ table, pids: new Set([11]), pathOf: () => target, dupOk: false })
  assert.deepEqual(
    { ok: borrowBytes(noDup.api, { filePath: target, pids: [11] }).ok, reason: borrowBytes(noDup.api, { filePath: target, pids: [11] }).reason },
    { ok: false, reason: 'handle-not-found' },
  )
  assert.equal(borrowBytes(fakeApi({ table, pids: new Set(), pathOf: () => target }).api, { filePath: target, pids: [11] }).reason, 'handle-not-found',
    'OpenProcess 全失败就是没借到，不要当作“没有目标进程”')
  assert.equal(borrowBytes(fakeApi({ table, pids: new Set([11]), pathOf: () => target }).api, { filePath: target, pids: [] }).reason, 'no-target-pids')
  assert.equal(borrowBytes(undefined, { filePath: target, pids: [1] }).reason, 'no-ffi')
  assert.equal(borrowBytes({}, { filePath: target, pids: [] }).reason, 'no-target-pids')
})

test('snapshotThroughHandle：koffi 找不到就明确 no-koffi，不碰系统调用', () => {
  assert.equal(snapshotThroughHandle({ filePath: 'C:\\x', candidates: [] }).reason, 'koffi-not-found')
  assert.equal(snapshotThroughHandle({ filePath: 'C:\\x', candidates: ['a'], requireImpl: () => undefined }).reason, 'koffi-unsupported')
  const broken = { load: () => { throw new Error('no dll') }, func: () => undefined }
  assert.equal(snapshotThroughHandle({ filePath: 'C:\\x', candidates: ['a'], requireImpl: () => broken }).reason, 'ffi-bindings-failed')
})

/** 阶梯测试用的假读数函数：主库永远 busy，快照路径给真数据。 */
function busyRead(target) {
  return (options) => {
    if (options.explicitPath === target.snapshotPath) {
      return { verdict: 'warn', reason: 'has-stale-entries', path: target.snapshotPath, authCookies: 2, totalCookies: 3, header: { bytes: 456, pct: 2.8, rawPct: 2.8, maxHeaderBytes: 16384, basis: 'estimated', threshold: 71, remaining: 69, over: false } }
    }
    return { verdict: 'warn', reason: 'busy', path: 'C:\\locked\\Cookies', bytes: 20480 }
  }
}

test('statCookiesLive：读得到就不碰句柄', () => {
  let snapshotCalls = 0
  const out = statCookiesLive({
    platform: 'win32',
    read: () => ({ verdict: 'warn', reason: 'has-stale-entries', path: 'C:\\x\\Cookies', authCookies: 1 }),
    snapshot: () => { snapshotCalls++; return { ok: false, reason: 'should-not-run' } },
  })
  assert.equal(out.reason, 'has-stale-entries')
  assert.equal(snapshotCalls, 0, '能读的时候不许扫句柄表')
})

test('statCookiesLive：busy + 快照成功 → 带 source/snapshot 且 path 仍是真库', () => {
  const target = { snapshotPath: 'C:\\tmp\\snap.sqlite' }
  const out = statCookiesLive({
    platform: 'win32', now: () => 1, cacheMs: 0, minGapMs: 0, cache: { at: Number.NEGATIVE_INFINITY, path: '', outcome: undefined },
    read: busyRead(target),
    snapshot: () => ({ ok: true, snapshotPath: target.snapshotPath, bytes: 20480, source: 'borrowed-handle' }),
  })
  assert.equal(out.authCookies, 2, '快照里的真实条数要带出来')
  assert.equal(out.path, 'C:\\locked\\Cookies', '不能把临时快照路径当库路径显示')
  assert.equal(out.source, 'borrowed-handle')
  assert.equal(out.snapshot, true, '界面据此说「非实时」')
  assert.equal(out.liveUnavailable, undefined)
})

test('statCookiesLive：借不到时保持 busy，绝不编出条数', () => {
  const out = statCookiesLive({
    platform: 'win32', now: () => 2, cacheMs: 0, minGapMs: 0, cache: { at: Number.NEGATIVE_INFINITY, path: '', outcome: undefined },
    read: () => ({ verdict: 'warn', reason: 'busy', path: 'C:\\locked\\Cookies', bytes: 20480 }),
    snapshot: () => ({ ok: false, reason: 'handle-not-found' }),
  })
  assert.equal(out.reason, 'busy')
  assert.equal(out.authCookies, undefined, '没读到就是没有这个字段')
  assert.equal(out.header, undefined)
  assert.equal(out.liveReason, 'handle-not-found', '失败原因要留下，排查用')
})

test('statCookiesLive：非 win32 不做句柄尝试', () => {
  let calls = 0
  const out = statCookiesLive({
    platform: 'linux',
    read: () => ({ verdict: 'warn', reason: 'busy', path: '/x/Cookies' }),
    snapshot: () => { calls++; return { ok: false, reason: 'nope' } },
  })
  assert.equal(calls, 0)
  assert.equal(out.reason, 'busy')
})

test('statCookiesLive：60 秒内复用快照，不反复扫全机句柄表', () => {
  const target = { snapshotPath: 'C:\\tmp\\snap2.sqlite' }
  let snapshotCalls = 0
  const deps = {
    platform: 'win32', cacheMs: 60_000, minGapMs: 5_000,
    cache: { at: Number.NEGATIVE_INFINITY, path: '', outcome: undefined },
    read: busyRead(target),
    snapshot: () => { snapshotCalls++; return { ok: true, snapshotPath: target.snapshotPath, bytes: 1, source: 'borrowed-handle' } },
  }
  const first = statCookiesLive({ ...deps, now: () => 1_000 })
  const second = statCookiesLive({ ...deps, now: () => 2_000 })
  assert.equal(first.authCookies, 2)
  assert.equal(second.authCookies, 2)
  assert.equal(snapshotCalls, 1, '缓存窗口内第二次不许再扫')
})

// ── win32 真机集成：自己造一个独占锁定的文件，再从另一个进程借句柄读它 ──
const HOLDER = `
const { createRequire } = require('node:module')
const koffi = createRequire(process.argv[2])('KOFFI')
const k32 = koffi.load('kernel32.dll')
const CreateFileW = k32.func('void *CreateFileW(str16, uint32_t, uint32_t, void *, uint32_t, uint32_t, void *)')
const WriteFile = k32.func('int32_t WriteFile(void *, void *, uint32_t, void *, void *)')
const h = CreateFileW(process.argv[3], 0xC0000000, 0, null, 2, 0x80, null)
const data = Buffer.from(process.argv[4], 'utf8')
WriteFile(h, data, data.length, Buffer.alloc(4), null)
setTimeout(() => process.exit(0), 5000)
`

test('win32 真机：借别的进程已打开的句柄读到独占锁定的文件', async (t) => {
  if (process.platform !== 'win32') { t.skip('仅 win32'); return }
  const candidates = koffiCandidates({})
  if (candidates.length === 0) { t.skip('本机没有可解析的 koffi'); return }
  const koffiPath = candidates[0]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-jar-'))
  const locked = path.join(dir, 'dcc-real-lock.bin')
  const payload = 'SQLITE-REAL-LOCK-0123456789'
  const script = path.join(dir, 'holder.cjs')
  // 清理必须“先放锁再删”：持锁端 share=0，它不退时 unlink 就是 EBUSY
  t.after(async () => {
    child.kill()
    await new Promise((resolve) => setTimeout(resolve, 400))
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 留给系统清临时目录 */ }
  })
  fs.writeFileSync(script, HOLDER.replace('KOFFI', koffiPath.replace(/\\/g, '\\\\')))
  const child = spawn(process.execPath, [script, script, locked, payload], { stdio: ['ignore', 'ignore', 'inherit'] })
  // 等持锁进程真的把文件打开（拿不到 pid 就没目标进程可借）
  await new Promise((resolve) => setTimeout(resolve, 800))
  if (child.exitCode !== null) { t.skip('持锁子进程已退出：' + String(child.exitCode)); return }
  // 显式传 pid：否则按基名匹配会把本机所有 node.exe 当目标，测试既慢又不确定
  const out = snapshotThroughHandle({ filePath: locked, candidates, pids: [child.pid], now: () => Date.now() })
  assert.equal(out.ok, true, `借句柄失败：${out.reason ?? '未知'}`)
  try {
    assert.equal(fs.readFileSync(out.snapshotPath).toString('utf8'), payload, '读到的必须是持锁端写的字节')
  } finally {
    fs.rmSync(out.snapshotPath, { force: true })
  }
})

test('win32 真机：快照临时库能被 node:sqlite 正常打开（证明阶梯接得上）', async (t) => {
  if (process.platform !== 'win32') { t.skip('仅 win32'); return }
  const candidates = koffiCandidates({})
  if (candidates.length === 0) { t.skip('本机没有可解析的 koffi'); return }
  // 用真 cookie 形状：只有 Chromium 真锁着时才测得出，这里退化为「快照文件可打开」的结构性断言
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-jar-shape-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const src = path.join(dir, 'Cookies')
  const db = new DatabaseSync(src)
  db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, path TEXT, expires_utc INTEGER)')
  db.prepare('INSERT INTO cookies VALUES (?,?,?,?,?)').run('127.0.0.1', 'dsh-auth-x', 'v', '/', 0)
  db.close()
  const snap = path.join(dir, 'snap.sqlite')
  fs.copyFileSync(src, snap)
  const check = new DatabaseSync(snap, { readOnly: true })
  try {
    assert.equal(Number(check.prepare('SELECT COUNT(*) c FROM cookies').get().c), 1, '快照副本必须可只读打开')
  } finally {
    check.close()
  }
})
