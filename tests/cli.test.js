/**
 * CLI 端到端冒烟：造一份 fixture 库 → status / --dry-run / --clean 三条路径，
 * 全部通过 `node src/cli.js` 子进程跑（覆盖 shebang、参数解析、退出码、备份落盘）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(import.meta.dirname, '..')
const CLI = path.join(ROOT, 'src', 'cli.js')

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-e2e-'))
  const network = path.join(dir, 'Network')
  fs.mkdirSync(network, { recursive: true })
  const file = path.join(network, 'Cookies')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, path TEXT, expires_utc INTEGER)')
  const ins = db.prepare('INSERT INTO cookies VALUES (?,?,?,?,?)')
  // 真量级：(ms + epoch差) * 1000，保证落在 int64 内且 >2^53（与 Chromium 写入的形态一致）
  const MICRO = (ms) => BigInt((ms + 11_644_473_600_000) * 1000)
  ins.run('127.0.0.1', 'dsh-auth-aaa', 'v', '/', MICRO(Date.now() + 86_400_000))
  ins.run('localhost', 'dsh-auth-bbb', 'v', '/', MICRO(Date.now() - 86_400_000))
  ins.run('127.0.0.1', 'keep-me', 'v', '/', MICRO(Date.now() + 86_400_000))
  db.close()
  return { dir, file }
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, DSH_USER_DATA: '', DSH_COOKIE_DB: '', ...env } })
}

test('CLI status：只给现状与下一步，不写盘', (t) => {
  const { dir, file } = fixture()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const res = run([], { DSH_USER_DATA: dir })
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /2 条 dsh-auth-\*/)
  assert.match(res.stdout, /--clean/)
  assert.equal(fs.existsSync(file), true)
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes('.bak')).length, 0)
})

test('CLI --clean --dry-run：报条数但不产出备份', (t) => {
  const { dir } = fixture()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const res = run(['--clean', '--dry-run'], { DSH_USER_DATA: dir })
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /dry-run.*将删除 2/)
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes('.bak')).length, 0)
})

test('CLI --clean：删两条 dsh-auth、留下别的 cookie，并落 .bak', (t) => {
  const { dir, file } = fixture()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const res = run(['--clean'], { DSH_USER_DATA: dir })
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /已删除 2 条/)
  const db = new DatabaseSync(file, { readOnly: true })
  const names = db.prepare('SELECT name FROM cookies').all().map((r) => String(r.name))
  db.close()
  assert.deepEqual(names, ['keep-me'])
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.startsWith('Cookies.bak-')), '备份必须落在库文件同目录')
})

test('CLI --clean --expired-only：只删过期的那一条', (t) => {
  const { dir, file } = fixture()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const res = run(['--clean', '--expired-only'], { DSH_USER_DATA: dir })
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /已删除 1 条/)
  const db = new DatabaseSync(file, { readOnly: true })
  const names = db.prepare('SELECT name FROM cookies ORDER BY name').all().map((r) => String(r.name))
  db.close()
  assert.deepEqual(names, ['dsh-auth-aaa', 'keep-me'])
})

test('CLI 打不到库时退出码为 1 并说清原因（绝不静默成功）', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-empty-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const missing = path.join(dir, 'Network', 'Cookies')
  const status = run(['--db=' + missing])
  assert.equal(status.status, 1)
  assert.match(status.stdout + status.stderr, /无法打开|完全退出/)
  const clean = run(['--clean', '--db=' + missing])
  assert.equal(clean.status, 1)
})

test('CLI --help 与未知参数', () => {
  const help = run(['--help'])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /退出 DSH 客户端/)
  const bad = run(['--nope'])
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /未知参数/)
})
