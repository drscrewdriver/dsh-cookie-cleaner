/**
 * 装载面与纪律测试：不依赖真宿主，用最小 ctx 桩验证
 * 「宿主半只读、绝不写盘」这条核心纪律是**机械**成立的。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import * as plugin from '../src/index.js'
import { statCookies, setLang } from '../src/core.js'
import { cookieCleanerCommandText } from '../src/report.js'
import { HOSTS, orRange } from '../scripts/hosts.mjs'

// 钉住输出语言：这些断言校的是中文文案，靠探测会在 LANG=C.UTF-8 的机器（如 WSL）上翻英文。
// 语言本身的差异另有 cli.test.js 的 --lang 专项覆盖。
setLang('zh')

const ROOT = path.resolve(import.meta.dirname, '..')

/** 最小 cordis 桩：inject/effect/get 都按需记录，缺 services 时静默降级。 */
function makeCtx({ withCommands = true } = {}) {
  const commands = []
  const effects = []
  const disposers = []
  const services = withCommands ? { commands: { register: (def) => { commands.push(def); return () => {} } } } : {}
  const ctx = {
    get(name) { return services[name] },
    inject(_deps, fn) { this._injected = fn },
    effect(fn, label) {
      effects.push({ fn, label })
      // cordis 的 effect 工厂注册即执行；不跳这一步就等于把“装载即工作”跳过了。
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
    effects,
    commands,
    dispose() { for (const d of disposers) { try { d() } catch { /* 已回收 */ } } },
  }
  return ctx
}

test('插件导出面：name/inject/Config/apply 齐备，inject 为空数组（不卡 PENDING）', () => {
  assert.equal(plugin.name, 'cookie-cleaner')
  assert.deepEqual(plugin.inject, [])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(typeof plugin.Config, 'function', 'schemastery 的 schema 是可调用对象')
  for (const key of ['userDataRoot', 'expiredOnly']) assert.ok(key in plugin.DEFAULT_SETTINGS, `缺默认键 ${key}`)
})

test('cordis.patch.yml 的 id 与导出 name 同串，name 与包名同串', () => {
  const patch = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, new RegExp(`- id: ${plugin.name}\\b`))
  assert.match(patch, /name: "dsh-cookie-cleaner"/)
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-cookie-cleaner')
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'dsh.plugin.json'), 'utf8')).main, './' + pkg.main)
})

test('装载身份：manifest.id 必须是包名，@deepseek-ai/dsh* peer 必须在（兼容性闸门只读它）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'dsh.plugin.json'), 'utf8'))
  // VD-017-020-06：bundle 挂载 id ≠ 包名 → client 半从不加载
  assert.equal(manifest.id, pkg.name, 'dsh.plugin.json#id 必须等于包名')
  // 核心定论 §1：宿主只读 @deepseek-ai/dsh | dsh-* 前缀的 peer；一个都没有 = 对所有线恒判兼容
  const dshPeers = Object.keys(pkg.peerDependencies ?? {}).filter((k) => /^@deepseek-ai\/dsh(-|$)/.test(k))
  assert.ok(dshPeers.length > 0, 'peerDependencies 缺少 @deepseek-ai/dsh* 项，闸门将失去拒载能力')
  // 包核验器 V3：dsh.client.inject 里的每个包都得有同串 optional peer（单一真源=inject）
  const injected = pkg.dsh?.client?.inject ?? []
  assert.ok(injected.length > 0, '声明了 client 半就必须列出 inject 包')
  for (const name of injected) {
    assert.equal(pkg.peerDependencies[name], manifest.engines.dsh, `${name} 的 peer 必须与 engines.dsh 逐串相同（hosts.mjs 单源）`)
    assert.equal(pkg.peerDependenciesMeta?.[name]?.optional, true, `${name} 得标 optional（宿主提供，不是 npm 安装物）`)
  }
  // 不得给没引用的包占 peer（旧版占过 renderer，它与 client.inject 无对应关系）
  for (const name of dshPeers) {
    assert.ok(injected.includes(name), `peer ${name} 不在 dsh.client.inject 里，属于无据声明`)
  }
})

test('双清单一致：engines.dsh 三处逐串相等', () => {
  const range = orRange(HOSTS)
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'dsh.plugin.json'), 'utf8'))
  assert.equal(pkg.engines.dsh, range)
  assert.equal(manifest.engines.dsh, range)
  assert.deepEqual(Object.keys(pkg.dsh.compatibility.dshReleases), HOSTS)
  assert.match(pkg.engines.node, /22\.19/, 'node:sqlite 需要 Node ≥22.5，下限必须钉到 22.19')
})

test('宿主半只读：对可写的真库执行只读统计，一条 DELETE/UPDATE/INSERT 都不发', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-discipline-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'Cookies')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, path TEXT, expires_utc INTEGER)')
  db.prepare('INSERT INTO cookies (host_key, name, value, path, expires_utc) VALUES (?,?,?,?,?)')
    .run('127.0.0.1', 'dsh-auth-xxx', 'v', '/', BigInt(9_000_000_000_000_000))
  db.close()

  const statements = []
  const spy = { DatabaseSync: class extends DatabaseSync {
    prepare(sql) { statements.push(String(sql)); return super.prepare(sql) }
    exec(sql) { statements.push(String(sql)); return super.exec(sql) }
  } }
  const stat = statCookies({ explicitPath: file, sqlite: spy })
  assert.equal(stat.authCookies, 1)
  assert.ok(statements.every((sql) => !/^\s*(DELETE|UPDATE|INSERT|DROP|VACUUM)/i.test(sql)), `出现写语句：${statements.join(' | ')}`)
})

test('apply() 只注册命令与设置，命令输出不含写盘动作', async (t) => {
  // 把定位根指到临时 fixture：单测绝不碰开发者真实 cookie 库。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-fixture-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const network = path.join(dir, 'Network')
  fs.mkdirSync(network, { recursive: true })
  const file = path.join(network, 'Cookies')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, path TEXT, expires_utc INTEGER)')
  db.prepare('INSERT INTO cookies (host_key, name, value, path, expires_utc) VALUES (?,?,?,?,?)')
    .run('127.0.0.1', 'dsh-auth-xxx', 'v', '/', BigInt(9_000_000_000_000_000))
  db.close()
  process.env.DSH_USER_DATA = dir

  const ctx = makeCtx()
  const ret = plugin.apply(ctx, { ...plugin.DEFAULT_SETTINGS, lang: 'zh' })
  t.after(() => ctx.dispose())
  assert.equal(ctx.commands.length, 1)
  const def = ctx.commands[0]
  assert.equal(def.name, 'cookie-cleaner')
  assert.match(def.description, /只读|给出清理命令/)
  assert.equal(typeof ret.status, 'function')
  assert.equal(typeof ret.clean, 'function', 'clean 仅作为库函数导出，命令面不调用')

  // handler 现在是 async（patch 子命令要 await configEditor），并且返回体必须用
  // 宿主认可的 kind：'success' | 'error'（旧写法 'text' 会在注册边界直接抛）。
  const result = await def.handler({ rawInput: 'clean' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /先完全退出 DSH 客户端|清理命令/, '输出必须把「关闭客户端」的前置条件说在前面')
  assert.match(result.text, /1 条 dsh-auth-\*/, 'fixture 里的条数要如实上报')
  assert.equal(dbSnapshot(file), 1, '跑完命令后库里的行一条不少')
})

test('commands 服务缺席（headless 线）时只降级，不 fatal', () => {
  const ctx = makeCtx({ withCommands: false })
  assert.doesNotThrow(() => plugin.apply(ctx, { ...plugin.DEFAULT_SETTINGS, lang: 'zh' }))
  assert.equal(ctx.commands.length, 0)
  ctx.dispose()
})

function dbSnapshot(file) {
  const handle = new DatabaseSync(file, { readOnly: true })
  try { return Number(handle.prepare('SELECT COUNT(*) AS c FROM cookies').get().c) } finally { handle.close() }
}

test('busy/skipped 两档降级文案都自带下一步，不把人推回 AI', () => {
  const busy = cookieCleanerCommandText({ verdict: 'warn', reason: 'busy', path: 'X/Cookies' }, { lang: 'zh' })
  assert.match(busy, /完全退出 DSH 客户端/)
  assert.match(busy, /--clean/)
  const skipped = cookieCleanerCommandText({ verdict: 'skipped', candidates: ['A', 'B'] }, { lang: 'zh' })
  assert.match(skipped, /Web 版|无需清理/)
  assert.match(skipped, /候选路径/)
})

test('降级文案跟平台走：mac/linux 不会出现「托盘」这种不存在的东西', () => {
  const busy = (platform) => cookieCleanerCommandText({ verdict: 'warn', reason: 'busy', path: 'X/Cookies' }, { platform, lang: 'zh' })
  assert.match(busy('win32'), /托盘/)
  assert.match(busy('darwin'), /Cmd\+Q|Quit/)
  assert.ok(!busy('darwin').includes('托盘'))
  assert.ok(!busy('linux').includes('托盘'))
  assert.ok(!busy('linux').includes('Cmd+Q'))
  assert.match(busy('linux'), /--clean/, '三平台都得给出可执行命令')

  const denied = cookieCleanerCommandText({ verdict: 'warn', reason: 'permission', path: '/home/u/.config/x/Network/Cookies' }, { platform: 'linux', lang: 'zh' })
  assert.match(denied, /权限/)
  assert.match(denied, /--db=/, '权限档要给出可直接粘贴的另一种入口')
  assert.ok(!denied.includes('托盘'))
})

test('cli.js 带 shebang 且已登记为 npm bin', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'src', 'cli.js'), 'utf8')
  assert.ok(cli.startsWith('#!/usr/bin/env node'), 'bin 脚本必须以 shebang 开头')
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.bin['dsh-cookie-cleaner'], 'src/cli.js')
})
