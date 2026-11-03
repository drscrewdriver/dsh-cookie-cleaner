/**
 * core.js 的真库行为测试：用 node:sqlite 造一份 Chromium 形状的 cookie 库，
 * 覆盖统计/删除/备份/降级四条路径（红绿都必须在这份临时库上跑出）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { CookieBusyError, buildDeleteStatement, cleanCookies, describeStat, openDatabase, resolveCookieDbs, statCookies } from '../src/core.js'

const EPOCH_OFFSET = 11_644_473_600_000_000
const MICRO = (ms) => ms * 1000 + EPOCH_OFFSET
const AUTH = (suffix) => `dsh-auth-${suffix}`

function tempDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cookie-cleaner-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return path.join(dir, 'Cookies')
}

/** 建一张与 Chromium 同形的 cookies 表并灌入给定行（`expiresUtcMicro` 直接给原始微秒）。 */
function makeCookieDb(file, rows) {
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE cookies (
    creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL,
    name TEXT NOT NULL, value TEXT NOT NULL, path TEXT NOT NULL, expires_utc INTEGER NOT NULL,
    is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL, last_access_utc INTEGER NOT NULL,
    has_expires INTEGER NOT NULL DEFAULT 1, is_persistent INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 1, source_scheme INTEGER NOT NULL DEFAULT 0,
    source_port INTEGER NOT NULL DEFAULT -1, is_same_site INTEGER NOT NULL DEFAULT 1
  )`)
  const insert = db.prepare('INSERT INTO cookies (creation_utc, host_key, top_frame_site_key, name, value, path, expires_utc, is_secure, is_httponly, last_access_utc) VALUES (?,?,?,?,?,?,?,?,?,?)')
  for (const row of rows) {
    const microseconds = row.expiresUtcMicro ?? MICRO(row.expiresMs)
    insert.run(BigInt(MICRO(1_700_000_000_000)), row.host_key, '', row.name, 'v', row.path ?? '/', BigInt(microseconds), 0, 1, BigInt(MICRO(1_700_000_000_000)))
  }
  db.close()
  return file
}

const STALE_ROWS = [
  { host_key: '127.0.0.1', name: AUTH('aaa'), expiresMs: Date.now() + 86_400_000 },
  { host_key: '127.0.0.1', name: AUTH('bbb'), expiresMs: Date.now() + 2 * 86_400_000 },
  { host_key: 'localhost', name: AUTH('ccc'), expiresMs: Date.now() - 86_400_000 },
  { host_key: '127.0.0.1', name: 'some-plugin-cookie', expiresMs: Date.now() + 86_400_000 },
  { host_key: 'evil.example.com', name: AUTH('ddd'), expiresMs: Date.now() + 86_400_000 },
]

function countAll(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try { return Number(db.prepare('SELECT COUNT(*) AS c FROM cookies').get().c) } finally { db.close() }
}
function namesOf(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try { return db.prepare('SELECT name FROM cookies ORDER BY name').all().map((r) => String(r.name)) } finally { db.close() }
}

test('statCookies 报告条数/过期数/host_key 分布', (t) => {
  const file = makeCookieDb(tempDb(t), STALE_ROWS)
  const stat = statCookies({ explicitPath: file })
  assert.equal(stat.verdict, 'warn')
  assert.equal(stat.reason, 'has-stale-entries')
  assert.equal(stat.totalCookies, 5)
  assert.equal(stat.authCookies, 4, '含非回环域的那条也计入观察，删除时另有 host_key 白名单')
  assert.equal(stat.authExpired, 1)
  assert.equal(stat.authLive, 3)
  assert.deepEqual(stat.byHost.map((row) => row.hostKey).sort(), ['127.0.0.1', 'evil.example.com', 'localhost'])
  assert.match(describeStat(stat), /发现 4 条 dsh-auth-\*/)
})

test('真实量级的 Chromium 时间戳（>2^53 微秒）不得抛 ERR_OUT_OF_RANGE', (t) => {
  // 13438387633175000 = 2026-11-05 的 chromium 原始微秒值：>2^53（默认按 Number 读会直接抛）
  // 但 <2^63（int64 可绑定）——两个边界都得踩到才算真验过。
  const file = makeCookieDb(tempDb(t), [
    { host_key: '127.0.0.1', name: AUTH('big'), expiresUtcMicro: 13_438_387_633_175_000 },
  ])
  const stat = statCookies({ explicitPath: file })
  assert.equal(stat.authCookies, 1)
  assert.equal(stat.authExpired, 0, '13438387633175000 落在 2026-11-05（当下之后），归入未过期')
  assert.equal(stat.authLive, 1)
  assert.equal(stat.newestExpiry, '2026-11-05 21:27 UTC')
})

test('statCookies 空库判定为 ok，不把「没什么可删」报成异常', (t) => {
  const file = makeCookieDb(tempDb(t), [{ host_key: '127.0.0.1', name: 'x', expiresMs: Date.now() + 86_400_000 }])
  const stat = statCookies({ explicitPath: file })
  assert.equal(stat.verdict, 'ok')
  assert.match(describeStat(stat), /干净/)
})

test('statCookies 找不到库 → skipped（中性，不入聚合异常）', () => {
  const stat = statCookies({ userDataRoot: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'empty-')), 'nope') })
  assert.equal(stat.verdict, 'skipped')
  assert.match(describeStat(stat), /未定位到 cookie 库/)
})

test('cleanCookies --dry-run 不改盘', (t) => {
  const file = makeCookieDb(tempDb(t), STALE_ROWS)
  const result = cleanCookies({ explicitPath: file, dryRun: true })
  assert.equal(result.ok, true)
  assert.equal(result.wouldDelete, 3, '只数回环域下的 dsh-auth-*')
  assert.equal(countAll(file), 5)
  assert.equal(fs.existsSync(`${file}.bak-stamp`), false)
})

test('cleanCookies 默认档删全部回环 dsh-auth-*，保留其它 cookie 与非回环域行，并落备份', (t) => {
  const file = makeCookieDb(tempDb(t), STALE_ROWS)
  const result = cleanCookies({ explicitPath: file, timestamp: () => 'stamp' })
  assert.equal(result.ok, true)
  assert.equal(result.deleted, 3)
  assert.deepEqual(namesOf(file).sort(), [AUTH('ddd'), 'some-plugin-cookie'])
  assert.ok(fs.existsSync(`${file}.bak-stamp`), '写盘前必须有 .bak 副本')
  assert.equal(countAll(`${file}.bak-stamp`), 5, '备份必须是删除前的完整状态')
})

test('cleanCookies --expired-only 只删过期条目', (t) => {
  const file = makeCookieDb(tempDb(t), STALE_ROWS)
  const result = cleanCookies({ explicitPath: file, expiredOnly: true, timestamp: () => 'stamp' })
  assert.equal(result.deleted, 1)
  assert.deepEqual(namesOf(file).sort(), [AUTH('aaa'), AUTH('bbb'), AUTH('ddd'), 'some-plugin-cookie'])
})

test('cleanCookies 无匹配即 no-op（deleted=0，仍留备份无害）', (t) => {
  const file = makeCookieDb(tempDb(t), [{ host_key: '127.0.0.1', name: 'plain', expiresMs: Date.now() + 86_400_000 }])
  const result = cleanCookies({ explicitPath: file, timestamp: () => 'stamp' })
  assert.equal(result.deleted, 0)
  assert.equal(countAll(file), 1)
})

test('非 cookie 库一律拒绝写入，且不留备份', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrong-db-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'Cookies')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE something_else (id INTEGER)')
  db.close()
  assert.throws(() => statCookies({ explicitPath: file }), /没有 cookies 表|缺少/)
  assert.throws(() => cleanCookies({ explicitPath: file, timestamp: () => 'stamp' }), /没有 cookies 表|缺少/)
  assert.equal(fs.existsSync(`${file}.bak-stamp`), false)
})

test('显式指定的库不存在 → CookieBusyError（带处置文案，不静默 no-op）', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gone-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.throws(
    () => cleanCookies({ explicitPath: path.join(root, 'Cookies'), timestamp: () => 'stamp' }),
    (e) => e instanceof CookieBusyError && /完全退出 DSH 客户端/.test(e.message),
  )
  assert.equal(fs.existsSync(path.join(root, 'Cookies.bak-stamp')), false)
})

test('openDatabase 打不开时包成 CookieBusyError（带处置文案）', (t) => {
  const file = tempDb(t)
  assert.throws(() => openDatabase(file, { write: true }), (e) => e instanceof CookieBusyError && /完全退出 DSH 客户端/.test(e.message))
})

test('resolveCookieDbs 只认存在的文件，忽略目录', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ud-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'Network'), { recursive: true })
  assert.deepEqual(resolveCookieDbs({ userDataRoot: root }), [], '目录不算库')
  const file = makeCookieDb(path.join(root, 'Network', 'Cookies'), STALE_ROWS)
  const found = resolveCookieDbs({ userDataRoot: root })
  assert.equal(found.length, 1)
  assert.equal(found[0].path, file)
  assert.ok(found[0].bytes > 0)
})

test('删除语句与统计口径一致：LIKE 前缀 + host_key 白名单', () => {
  const { sql, values } = buildDeleteStatement({})
  assert.match(sql, /name LIKE \?/)
  assert.equal(values[0], 'dsh-auth-%')
})
