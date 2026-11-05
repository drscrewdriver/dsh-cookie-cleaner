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
  // 钉住输出语言：否则同一条断言在中文 Windows 上绿、在 LANG=C.UTF-8 的 Linux 上红——
  // 那测的是宿主 locale，不是本工具。--lang 专项另测。
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_USER_DATA: '', DSH_COOKIE_DB: '', DSH_COOKIE_LANG: 'zh', DSH_LANG: '', LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', ...env },
  })
}

test('CLI status：只给现状与下一步，不写盘', (t) => {
  const { dir, file } = fixture()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const res = run([], { DSH_USER_DATA: dir })
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /2 条 dsh-auth-\*/)
  // 占用折算与面板同一句：光报条数用户判不出还剩多少余量
  assert.match(res.stdout, /%/, '必须给出请求头占用百分比')
  assert.match(res.stdout, /431/, '要说清超过上限就是 431')
  assert.match(res.stdout, /16384/, '上限得写出来，不让用户猜')
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

test('CLI 打不到库时退出码为 1 并说清原因（给的是 missing 档，不是“客户端在跑”）', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-empty-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const missing = path.join(dir, 'Network', 'Cookies')
  const status = run(['--db=' + missing], { DSH_COOKIE_LANG: 'en' })
  assert.equal(status.status, 1, '读不到库绝不能退 0（把失败报成成功）')
  assert.match(status.stdout + status.stderr, /不在这里|不在这个位置|not here|No cookie database|无法打开/)
  assert.ok(!/托盘|Cmd\+Q/.test(status.stdout + status.stderr), '指引不得预设某个平台')
  assert.ok(!/完全退出|Quit the DSH/.test(status.stdout + status.stderr), '文件不存在不是“客户端在跑”')
  const clean = run(['--clean', '--db=' + missing])
  assert.equal(clean.status, 1)
  assert.match(clean.stdout + clean.stderr, /--db=/, 'missing 档必须直接给出可用的 --db 形式')
})

test('CLI --lang 显式指定优先于探测；缺省跟系统 locale', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-lang-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const missing = path.join(dir, 'Cookies')
  const de = run(['--db=' + missing, '--lang=de'])
  assert.match(de.stdout + de.stderr, /Keine Cookie-Datenbank|diese Datei existiert nicht/, de.stdout + de.stderr)
  const ru = run(['--db=' + missing, '--lang=ru'])
  assert.match(ru.stdout + ru.stderr, /\u0411\u0430\u0437\u044b cookie/, '俄语档未生效')
  const neutral = run(['--db=' + missing], { LANG: 'C.UTF-8', LC_ALL: '', LC_MESSAGES: '', DSH_LANG: '', DSH_COOKIE_LANG: '' })
  assert.match(neutral.stdout + neutral.stderr, /No cookie database/, 'POSIX 中性 locale 应落英文而非中文')
})

test('CLI --help 与未知参数', () => {
  const help = run(['--help'])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /dsh-cookie-cleaner --clean/)
  assert.match(help.stdout, /macOS|Linux/, '帮助里要能看到各平台的库位置')
  const bad = run(['--nope'])
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /未知参数/)
})

// ── patch 子命令（离线只读；写动作全部不属 CLI）──

function fixturePatch(t, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-patch-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, text, 'utf8')
  return file
}

const GOOD = `- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    cookieMaxAgeDays: 30
    trustedHosts: []
    maxRequestBodyBytes: 314572800
`

test('CLI patch check：偏档是 warn（退出 0）并说出具体值与离线局限', (t) => {
  const file = fixturePatch(t, GOOD)
  const out = run(['patch', 'check', '--patch-file=' + file])
  assert.equal(out.status, 0, out.stdout + out.stderr)
  assert.match(out.stdout, /cookieMaxAgeDays\D+30/)
  assert.match(out.stdout, /离线|offline/, '离线档必须声明自己看不到运行态')
})

// 用户口径（2026-11-04）：“配置和给定结构无差异时只说注入正常，别整那有的没的”。
// 这张底本就是用户给的正确形态：host/port/trustedHosts 都保留 !!js 表达式、cookie 寿命在目标档。
const WELL_FORMED = `- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  config:
    host: !!js ctx.webStartup.host ?? '127.0.0.1'
    port: !!js ctx.webStartup.port > 0 ? ctx.webStartup.port : 34567
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    cookieMaxAgeDays: 1
    trustedHosts: !!js ctx.webRuntime.trustedHosts
    maxRequestBodyBytes: 314572800
`

test('CLI patch check：结构无差异 → 退出 0 且只给一句「注入正常」，不刷逐行档位', (t) => {
  const file = fixturePatch(t, WELL_FORMED)
  const out = run(['patch', 'check', '--patch-file=' + file])
  assert.equal(out.status, 0, out.stdout + out.stderr)
  assert.match(out.stdout, /注入正常|injected as written/, '肯定结论必须说出来（用户要的就是这个判定）')
  assert.doesNotMatch(out.stdout, /有偏差|deviates|会失效|will not take effect/, '无差异时不得出现偏差档字样')
  assert.doesNotMatch(out.stdout, /下一步|next: press/, '没东西可修就不要提示点修复')
})

test('CLI patch check：name 写错 → 退出 1 并说出「静默跳过」', (t) => {
  const file = fixturePatch(t, GOOD.replace('dsh-client-connection', 'dsh-client-conection'))
  const out = run(['patch', '--patch-file=' + file])
  assert.equal(out.status, 1, '结构会失效必须非 0')
  assert.match(out.stdout + out.stderr, /静默|silently/i)
})

test('CLI patch check：模板根 `[]` 后追分块行 → 判整层失效（P11）', (t) => {
  const file = fixturePatch(t, '[]\n' + GOOD)
  const out = run(['patch', 'check', '--patch-file=' + file])
  assert.equal(out.status, 1)
  assert.match(out.stdout + out.stderr, /flow|YAML/, '要给可指认的原因')
})

// 真机踩出来的缺陷（2026-11-04）：`--profile` 敲错名字时，文件读不到被当成「没这一行」，
// 既编出一条误导的「cookie 会一直存活」异常，又因为 warn→0 的映射把「什么都没读到」洗成假绿。
// 无据就是无据：skipped + 非 0，并说清是 profile 不存在。
test('CLI patch check：profile 根本不存在 → 无据 skipped，退出非 0 且不编造偏差', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ghost-home-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const out = run(['patch', 'check', '--profile=ghost-cell'], { DSH_HOME: home })
  assert.equal(out.status, 1, '没真读到内容就不许 0：' + out.stdout + out.stderr)
  assert.match(out.stdout + out.stderr, /不存在|does not exist|n.existe pas|existiert nicht/, '要说是 profile 不存在')
  assert.doesNotMatch(out.stdout + out.stderr, /cookieMaxAgeDays/, '无据时不得编出具体偏差')
})

test('CLI patch check：profile 目录在、只是还没写过 patch → 仍是可修的真偏差（不得过度降级）', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-fresh-home-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  fs.mkdirSync(path.join(home, 'profiles', 'fresh-cell'), { recursive: true })
  const out = run(['patch', 'check', '--profile=fresh-cell'], { DSH_HOME: home })
  assert.match(out.stdout + out.stderr, /cookieMaxAgeDays/, '缺行要说得出具体值')
  assert.match(out.stdout + out.stderr, /静默跳过|修复|fix/i, '这条是能动手的偏差，要给下一步')
})

test('CLI patch plan：输出可直接粘贴的块，目标值已就位', (t) => {
  const file = fixturePatch(t, GOOD)
  const out = run(['patch', 'plan', '--patch-file=' + file, '--target-days=2'])
  assert.equal(out.status, 0, out.stdout + out.stderr)
  assert.match(out.stdout, /^- id: connection/)
  assert.match(out.stdout, /cookieMaxAgeDays: 2/)
  assert.match(out.stdout, /maxRequestBodyBytes: 314572800/, '得把现有键全带上（浅赋值会整块替换）')
})

test('CLI patch 绝不写盘：跑完 check 后 profile 文件逐字节不变', (t) => {
  const file = fixturePatch(t, GOOD)
  const before = fs.readFileSync(file, 'utf8')
  run(['patch', 'check', '--patch-file=' + file])
  run(['patch', 'plan', '--patch-file=' + file])
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'CLI 是只读的，写只属于面板/宿主命令')
})

test('CLI patch --target-days 非法值直接拒，不拿它去判档', () => {
  const out = run(['patch', 'check', '--patch-file=' + path.join(os.tmpdir(), 'definitely-missing.yml'), '--target-days=0'])
  assert.equal(out.status, 1)
  assert.match(out.stderr, /target-days|≥ 1/)
})

test('CLI --help 里能看到 patch 子命令', () => {
  const help = run(['--help'])
  assert.match(help.stdout, /patch \[check\]|patch check/)
})

test('CLI --version 报包名@版本，与 package.json 同号（装机别名与包体的对拍）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const out = run(['--version'])
  assert.equal(out.status, 0, out.stderr)
  assert.equal(out.stdout.trim(), `${pkg.name}@${pkg.version}`)
})
