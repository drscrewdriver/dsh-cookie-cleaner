/**
 * CommandResult 契约测试。
 *
 * 由来：宿主在命令注册边界硬校验返回值（`interaction/commands/src/index.ts:228-255`）——
 * `kind` 只认 `'success' | 'error'`，别的值一律 `throw unknown result kind`。
 * 0.1.x 的命令返回 `{kind:'text'}`，在真宿主里**每次调用都抛**，而旧桩只记录了返回值、
 * 从未校契约，所以全绿——典型的「桩测循环验证」。这里把宿主规则原样搬进测试，钉死不再回归。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import * as plugin from '../src/index.js'
import { setLang } from '../src/core.js'

// 断言的是中文文案，语言必须钉住（否则在 LANG=C.UTF-8 的机器上测的是宿主 locale）
setLang('zh')

/** 宿主 normalizeResult 的等价规则（照抄 0.2.1 的判定顺序与文案要点）。 */
function assertCommandResult(command, value) {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    throw new TypeError(`command "${command}" handler must return a CommandResult`)
  }
  if (value.kind === 'success') {
    assert.ok(value.text === undefined || typeof value.text === 'string', 'success text 必须是字符串')
    return
  }
  if (value.kind === 'error') {
    assert.ok(typeof value.text === 'string' && value.text.trim().length > 0, 'error text 必须非空')
    return
  }
  assert.fail(`command "${command}" returned unknown result kind "${String(value.kind)}"`)
}

/** 假 configEditor（与 patch-guard 测试同形，够 fix / applyPort 用）。 */
function fakeEditor(profileText) {
  const entry = { options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection', config: { cookieMaxAgeDays: 30, trustedHosts: [], maxRequestBodyBytes: 314572800 } } }
  const web = { options: { id: 'webserver', name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 34567 } } }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-cmd-'))
  const patchFile = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(patchFile, profileText, 'utf8')
  return {
    dir,
    patchFile,
    entries: () => [entry, web],
    configuration: () => ([
      { entry, inherited: {}, override: { cookieMaxAgeDays: 30, trustedHosts: [], maxRequestBodyBytes: 314572800 } },
      { entry: web, inherited: {}, override: {} },
    ]),
    documentPath: patchFile,
    // 桩必须**按传入的 entry 写**：以前无条件写 connection，port 路径会把产品测成假失败
    //（桩失真当成产品 bug，这个坑本轮第二次踩）。
    edit: async (target, change) => {
      const next = change(structuredClone(target.options.config))
      if (target.options.id === 'connection' && (!Number.isInteger(next.cookieMaxAgeDays) || next.cookieMaxAgeDays < 1)) throw new Error('invalid config')
      if (target.options.id === 'webserver') {
        const value = next.port
        const ok = typeof value === 'number'
          ? Number.isInteger(value) && value >= 1 && value <= 65535
          : value !== null && typeof value === 'object' && typeof value.__jsExpr === 'string'
        if (!ok) throw new Error('invalid config: port')
      }
      target.options.config = next
    },
  }
}

function makeCtx({ editor, withCommands = true } = {}) {
  const commands = []
  const services = withCommands ? { commands: { register: (def) => { commands.push(def); return () => undefined } } } : {}
  return {
    commands,
    get(name) {
      if (name === 'configEditor') return editor
      return services[name]
    },
    // settings 走记录不触发（waist 自带降级）；configEditor 必须真回调，否则 guard 永远不存在
    inject(deps, fn) {
      if (deps.includes('configEditor')) {
        fn({ get: (name) => (name === 'configEditor' ? editor : undefined) })
        return
      }
      this.injected = { deps, fn }
    },
    effect(fn) { fn() },
    logger: () => ({ info() {} }),
  }
}

const PROFILE = `- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    cookieMaxAgeDays: 30
    trustedHosts: []
    maxRequestBodyBytes: 314572800
`

async function invoke(ctx, rawInput) {
  const def = ctx.commands[0]
  assert.ok(def, '命令必须已注册')
  const result = await def.handler({ rawInput, commandId: 'c1', agent: {}, attachments: [], signal: new AbortController().signal })
  assertCommandResult(def.name, result)
  return result
}

test('status / clean 两条路径都返回合法 CommandResult', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-cmd-empty-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const ctx = makeCtx({ editor: undefined })
  plugin.apply(ctx, { ...plugin.DEFAULT_SETTINGS, userDataRoot: dir })
  for (const line of ['', 'status', 'clean', 'whatever']) {
    const result = await invoke(ctx, line)
    assert.equal(result.kind, 'success', `「${line}」应 success`)
    assert.ok(typeof result.text === 'string' && result.text.length > 0)
  }
})

test('patch check / plan / fix / revert 全部走契约（带 editor 的真路径）', async (t) => {
  const editor = fakeEditor(PROFILE)
  t.after(() => fs.rmSync(editor.dir, { recursive: true, force: true }))
  const ctx = makeCtx({ editor })
  plugin.apply(ctx, { ...plugin.DEFAULT_SETTINGS, guardDays: 1 })

  const check = await invoke(ctx, 'patch check')
  assert.equal(check.kind, 'success')
  assert.match(check.text, /cookieMaxAgeDays/, '体检要说出具体值')

  const plan = await invoke(ctx, 'patch plan')
  assert.equal(plan.kind, 'success')

  const fixed = await invoke(ctx, 'patch fix')
  assert.equal(fixed.kind, 'success')
  assert.equal(editor.entries()[0].options.config.cookieMaxAgeDays, 1, 'fix 必须真的落到运行态')

  const back = await invoke(ctx, 'patch revert')
  assert.equal(back.kind, 'success')
})

// (removed port tests: applyPort no longer part of the command surface)

test('patch 的未知子命令回落 check，绝不抛（用户敲错字不是错误路径）', async (t) => {
  const editor = fakeEditor(PROFILE)
  t.after(() => fs.rmSync(editor.dir, { recursive: true, force: true }))
  const ctx = makeCtx({ editor })
  plugin.apply(ctx, plugin.DEFAULT_SETTINGS)
  const result = await invoke(ctx, 'patch 打地鼠')
  assert.equal(result.kind, 'success')
})

test('老线没有 configEditor → patch 面只报不可用，仍是合法 CommandResult', async () => {
  const ctx = makeCtx({ editor: undefined })
  plugin.apply(ctx, plugin.DEFAULT_SETTINGS)
  const result = await invoke(ctx, 'patch fix')
  assert.equal(result.kind, 'success', '缺席是可说明的状态，不是错误路径')
  assert.match(result.text, /config-editor|老线|无法在线/)
})

test('commands 服务缺席时静默降级（headless 线不得 fatal）', () => {
  const ctx = makeCtx({ withCommands: false, editor: undefined })
  assert.doesNotThrow(() => plugin.apply(ctx, plugin.DEFAULT_SETTINGS))
  assert.equal(ctx.commands.length, 0)
})

// 水位接线的两段事故：
// ① 面板接了借句柄快照、命令面只走普通只读 → 桌面运行期面板有水位、命令面只报“读不到”。
// ② 观测 Cookie 头的代码跟 `runtimeGuard` 一起被关掉 → 守护关闭时水位归零（磁盘 jar
//    只在优雅退出时落盘，强杀后是旧快照甚至 0 条），把“没落盘”误报成“没有 cookie”。
// 现在：观测臂无条件挂，水位优先级 = 请求头观测 > 借句柄快照 > 普通只读。
test('水位接线：观测臂无条件挂，命令面/面板与它同源', () => {
  const src = (name) => fs.readFileSync(path.join(import.meta.dirname, '..', 'src', name), 'utf8')
  const index = src('index.js')
  const cli = src('cli.js')
  const observerAt = index.indexOf('observer = installCookieObserver(server')
  // v0.7.0：退休与抬预算拆成两个开关，短路条件随之变化（不再有单一的 runtimeGuard 短路）。
  const guardGateAt = index.indexOf('if (!retireOn && !budgetOn)')
  assert.ok(observerAt >= 0, '水位观测臂必须存在')
  assert.ok(guardGateAt >= 0, '守护短路闸仍在')
  assert.ok(observerAt < guardGateAt, '观测臂必须在守护短路之前挂上')
  assert.match(index, /const \{ stat, ladder, observed \} = cookieWaterLevel\(cfg\)/, '命令面应走统一水位')
  assert.match(index, /cookie: \(\) => cookieWaterLevel\(current\(\)\)\.stat/, '面板应走统一水位')
  assert.match(index, /cookieBrief\(\(\) => cookieWaterLevel\(current\(\)\)\.stat\)/, 'patch 体检应走统一水位')
  assert.match(index, /statCookiesLive\(\{ userDataRoot: cfg\.userDataRoot \}\)/, '无观测时应回落借句柄快照')
  assert.match(index, /observed\.minted > 0/, '没观测到启动 cookie 时不得编造水位')
  assert.doesNotMatch(cli, /statCookiesLive/, 'CLI 不许做句柄扫描')
})


