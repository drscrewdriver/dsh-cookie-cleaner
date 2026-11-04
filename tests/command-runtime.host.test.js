/**
 * 真宿主命令运行时集成测试（**非桩**）。
 *
 * 由来：`/cookie-cleaner patch check|fix|revert` 的可用性此前只有自写桩在验——
 * 而 0.1.x 的事故恰恰是「桩不校契约」（宿主 `normalizeResult` 只认
 * `success|error`，`{kind:'text'}` 每次调用都抛）。这里不再抄规则：直接 mount
 * 宿主**已发布**的 `@deepseek-ai/dsh-commands`（`CommandRuntime`），让宿主自己的
 * `parseCommand` / 作用域视图 / 生命周期 append / `normalizeResult` 全部真跑，
 * 再用最小 agent 替身（`agent.session.append`，宿主仅这一处依赖 agent）执行命令行。
 *
 * 两个分层：
 * - A 裸宿主（只有 commands）＝无 config-editor 老线的真实命令面：
 *   插件必须仍装载、命令必须仍可用、patch 面必须**静默降级**而不是抛；
 * - B 再提供 configEditor + webServer 两个真服务位（内容由假 editor 供给）＝
 *   写路径穿过真命令面：`patch fix` 真改临时 profile 文件、`patch revert` 真回滚，
 *   快照落在 `DSH_HOME` 临时格，绝不碰用户 `~/.dsh`。
 *
 * 代际差异由**能力探测**吸收（`registerFileReceiptResolver` 在不在→ execute 要不要
 * 传 attachments），所以同一份测试能在多条宿主线上当真跑；已实跑：
 * Windows 全局 `@deepseek-ai/dsh` 0.2.1-rc.5 与 WSL 全局 0.1.0-rc.6。
 *
 * 本机没有全局 `@deepseek-ai/dsh` 时整个文件跳过（不是失败）：这是宿主可用性的
 * 条件验证，CI/异机不该因缺宿主而变红。要强制指定宿主安装位（异机/WSL 读挂载的
 * Windows 全局树）用 `DSH_HOST_MODULES=<含 @deepseek-ai 的 node_modules 目录>`；
 * 要直接钉入口（源码仓已构建 lib，逐线验证）用 `DSH_COMMANDS_ENTRY` + `DSH_CORDIS_ENTRY`。
 */
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import * as plugin from '../src/index.js'
import { snapshotFile } from '../src/patch-guard.js'

/** 宿主安装位候选：显式 env > node 同级/系统前缀的全局 node_modules（不算 npm）。 */
function quickRoots() {
  const explicit = String(process.env.DSH_HOST_MODULES ?? '').trim()
  return [explicit, path.join(path.dirname(process.execPath), 'node_modules'), path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules')]
    .filter((root) => root !== '')
}

/** 候选包入口集（顶层或 `dsh` 的嵌套 node_modules）。 */
const entryCandidates = (pkg, root) => [
  path.join(root, '@deepseek-ai', pkg, 'lib', 'index.js'),
  path.join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', pkg, 'lib', 'index.js'),
]

/** 在候选安装位里找入口；快速候选全数不中才走 `npm root -g`（固定字面量，无外部输入）。 */
function findHostRootFor(pkg) {
  // 显式钉入口：用于拿源码仓的已构建 lib 验另一条线（如 0.1.5-rc.2 工作树），
  // 避开「npm 形态的该线宿主自身起不来」这个与方法无关的坑。
  const envKey = pkg === 'cordis' ? 'DSH_CORDIS_ENTRY' : 'DSH_COMMANDS_ENTRY'
  const explicit = String(process.env[envKey] ?? '').trim()
  if (explicit !== '') return fs.existsSync(explicit) ? explicit : undefined
  for (const root of quickRoots()) {
    const found = entryCandidates(pkg, root).find((file) => fs.existsSync(file))
    if (found !== undefined) return found
  }
  try {
    // 兜底：node 可能不是从宿主根启动的（nvm / 版本管理器）。
    const out = String(execSync('npm root -g', { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] })).trim()
    if (out === '') return undefined
    return entryCandidates(pkg, out).find((file) => fs.existsSync(file))
  } catch {
    return undefined
  }
}

const HOST = { cordis: findHostRootFor('cordis'), commands: findHostRootFor('dsh-commands') }
const SKIP = HOST.cordis === undefined || HOST.commands === undefined
  ? `宿主命令运行时不可解析（需全局安装 @deepseek-ai/dsh）：cordis=${HOST.cordis ?? '∅'} commands=${HOST.commands ?? '∅'}`
  : false

/** 宿主包版本（只用于日志报“验的是哪条线”，断言一律走能力探测，禁读版本号分派）。 */
function hostVersionOf(entry) {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(path.dirname(entry), '..', 'package.json'), 'utf8')).version)
  } catch {
    return '未知'
  }
}

const PROFILE_STALE = `- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  config:
    host: 127.0.0.1
    port: 34567
    compression: gzip
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    cookieMaxAgeDays: 30
    trustedHosts: []
    maxRequestBodyBytes: 314572800
`

const LINES = [
  '/cookie-cleaner',
  '/cookie-cleaner status',
  '/cookie-cleaner clean',
  '/cookie-cleaner patch check',
  '/cookie-cleaner patch plan',
  '/cookie-cleaner patch fix',
  '/cookie-cleaner patch port 4300',
  '/cookie-cleaner patch revert',
  '/cookie-cleaner 打地鼠',
]

async function mountHostCommands(t) {
  const cordis = await import(pathToFileURL(HOST.cordis).href)
  const cmds = await import(pathToFileURL(HOST.commands).href)
  const ctx = new cordis.Context()
  const CommandRuntime = cmds.default ?? cmds.CommandRuntime
  assert.ok(typeof CommandRuntime === 'function', '宿主必须导出 CommandRuntime 插件')
  await ctx.plugin(CommandRuntime, {})
  const svc = ctx.get('commands')
  assert.ok(svc !== undefined && typeof svc.execute === 'function' && typeof svc.register === 'function',
    '宿主 commands 服务必须带 register/execute')
  const exec = detectExecShape(svc, t)
  t.after(async () => {
    try { await ctx.stop?.() } catch { /* 回收失败不影响断言 */ }
  })
  return { ctx, cordis, svc, exec }
}

/**
 * 行执行入口的代际差异：用**行为探针**，不用结构探针。
 *
 * 真因（均为实测）：`execute` 形参在老线之间就不一样——
 * 0.1.0-rc.6 是 `(agent, line, signal)`；0.1.2-rc.1 已经是 `(agent, line, images, signal)`
 * 但**没有** `registerFileReceiptResolver`。所以拿「该方法在否」当代理信号会把 0.1.2 线误判成 3 形参。
 * 真探针只能看行为：先按 4 形参跑一条无害探针命令；若宿主把 signal 读到了 attachments 槽上
 * （即它只接 3 形参），会抛 `... of undefined (reading 'aborted')`，据此退回 3 形参调用。
 */
function detectExecShape(svc, t) {
  const call = (agent, line, signal, withAttachments) => (withAttachments
    ? svc.execute(agent, line, [], signal)
    : svc.execute(agent, line, signal))
  let withAttachments = null
  const run = async (agent, line) => {
    const signal = new AbortController().signal
    if (withAttachments === null) {
      const disposer = svc.register({ name: 'dcc-arity-probe', description: '形参探针', handler: () => ({ kind: 'success', text: 'ok' }) })
      try {
        await call(agent, '/dcc-arity-probe', signal, true)
        withAttachments = true
      } catch (e) {
        if (!/aborted/.test(String(e && e.message))) throw e
        withAttachments = false
        await call(agent, '/dcc-arity-probe', signal, false)
      } finally {
        try { disposer() } catch { /* 老线 disposer 可选 */ }
      }
      t.diagnostic(`宿主 dsh-commands=${hostVersionOf(HOST.commands)}，execute 形参=${withAttachments ? '带 attachments' : '不带 attachments'}`)
    }
    return call(agent, line, signal, withAttachments)
  }
  return run
}

/** 宿主 execute 只依赖 agent 的这两处（`appendLifecycle`）；其余一律不碰。 */
function makeAgent() {
  const appends = []
  const session = { append: (type, data) => { appends.push({ type, data }) } }
  // 行为探针需要一个能解析命令名的 agent（部分老线会先读 agent.id 做作用域键）。
  return { appends, agent: { id: 'dcc-test-agent', session } }
}

test('A 裸宿主命令面：插件仍装载、命令仍可用、patch 面静默降级（真 normalizeResult 校验）', { skip: SKIP }, async (t) => {
  const { ctx, svc, exec } = await mountHostCommands(t)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-host-cmd-a-'))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-host-home-a-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    process.env.DSH_HOME = prevHome
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  })

  // 真装载：无 configEditor / webServer / settings 服务，等价于 0.1.5 那类老线的装配面。
  // lang 钉住：断言的是中文文案，不能让 detectLang 跟着机器 locale 飘。
  await ctx.plugin(plugin, { ...plugin.DEFAULT_SETTINGS, userDataRoot: dir, lang: 'zh' })

  const { agent, appends } = makeAgent()
  const listed = svc.list(agent).map((d) => d.name)
  assert.ok(listed.includes('cookie-cleaner'), `宿主命令表必须含 cookie-cleaner，实得 ${JSON.stringify(listed)}`)

  for (const line of LINES) {
    const settled = await exec(agent, line)
    assert.ok(settled !== undefined, `${line} 必须被宿主解析成命令`)
    // kind 由宿主 normalizeResult 判定：能返回就说明我们的返回体合契约（0.1.x 在这一步必抛）。
    assert.equal(settled.result.kind, 'success', `${line} 应 success，实得 ${JSON.stringify(settled.result)}`)
    assert.ok(typeof settled.result.text === 'string' && settled.result.text.trim().length > 0, `${line} 必须有正文`)
  }

  // 无 config-editor：patch 面要「说清楚不可用」而不是隐掉或抛。
  const degraded = await exec(agent, '/cookie-cleaner patch fix')
  assert.match(degraded.result.text, /config-editor|configEditor|老线|无法在线/, '缺席必须可说明')

  // 生命周期由宿主写进会话日志：run/done 成对，且 done 的 kind 与结果一致。
  // 只算本插件的命令（形参探针也会往同一日志里落一条）。
  const runs = appends.filter((e) => e.type === 'command/run' && e.data.name === 'cookie-cleaner')
  const dones = appends.filter((e) => e.type === 'command/done' && runs.some((r) => r.data.commandId === e.data.commandId))
  assert.equal(runs.length, LINES.length + 1, '每条 cookie-cleaner 命令都应有一条 command/run')
  assert.equal(dones.length, runs.length, '每条 command/run 都应 settle')
  assert.equal(dones.at(-1).data.kind, 'success')
  assert.ok(runs.at(-1).data.args !== undefined, 'command/run 默认记录原始参数')

  // 无参行为与 0.1.x 一致：说的仍是 cookie 库现状（定位到就报条数，定位不到就报候选路径），
  // 而且不得误跳到 patch 面。
  const bare = await exec(agent, '/cookie-cleaner')
  assert.match(bare.result.text, /dsh-auth|cookie 库|候选路径/, '无参仍是 cookie 现状播报（0.1.x 语义）')
  assert.doesNotMatch(bare.result.text, /patch/, '无参不得误入 patch 面')
})

test('A2 宿主校验确实生效：返回 {kind:"text"} 的真命令必须被宿主拒掉（0.1.x 回归哨兵）', { skip: SKIP }, async (t) => {
  const { svc, exec } = await mountHostCommands(t)
  const { agent } = makeAgent()
  svc.register({ name: 'dcc-regression-probe', description: '故意返回旧词表', handler: () => ({ kind: 'text', text: 'x' }) })
  await assert.rejects(
    () => exec(agent, '/dcc-regression-probe'),
    /unknown result kind/,
    '宿主必须对未知 kind 抛——否则本文件的 success 断言毫无意义',
  )
})

test('B 写路径穿过真命令面：patch fix 真改临时 profile、revert 真回滚（真 register/execute + 真服务位）', { skip: SKIP }, async (t) => {
  const { ctx, cordis, exec } = await mountHostCommands(t)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-host-cmd-b-'))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-host-home-b-'))
  const profileFile = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(profileFile, PROFILE_STALE, 'utf8')
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    process.env.DSH_HOME = prevHome
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  })

  // 假内容、真服务位：configEditor / webServer 都经 cordis 依赖图投递，
  // 插件的 ctx.inject(['configEditor','webServer']) 回调必须真的被宿主 fire。
  const entry = { options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection', config: { cookieMaxAgeDays: 30, trustedHosts: [], maxRequestBodyBytes: 314572800 } } }
  const web = { options: { id: 'webserver', name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 34567, compression: 'gzip' } } }
  let injected = 0
  class FakeConfigEditor extends cordis.Service {
    constructor(ownCtx) { super(ownCtx, 'configEditor') }
    get documentPath() { return profileFile }
    entries() { return [entry, web] }
    configuration() {
      return [
        { entry, inherited: {}, override: { cookieMaxAgeDays: 30, trustedHosts: [], maxRequestBodyBytes: 314572800 } },
        { entry: web, inherited: { host: { __jsExpr: "ctx.webStartup.host ?? '127.0.0.1'" }, port: { __jsExpr: 'ctx.webStartup.port ?? 3080' } }, override: { host: '127.0.0.1', port: 34567, compression: 'gzip' } },
      ]
    }
    async edit(_target, change) {
      injected += 1
      const next = change(structuredClone(entry.options.config))
      if (!Number.isInteger(next.cookieMaxAgeDays) || next.cookieMaxAgeDays < 1) throw new Error('invalid config: $.cookieMaxAgeDays expected number >= 1')
      entry.options.config = next
      fs.writeFileSync(profileFile, String(fs.readFileSync(profileFile, 'utf8')).replace(/cookieMaxAgeDays: \d+/, `cookieMaxAgeDays: ${next.cookieMaxAgeDays}`), 'utf8')
    }
  }
  class FakeWebServer extends cordis.Service {
    constructor(ownCtx) { super(ownCtx, 'webServer') }
    register() { return () => undefined }
  }
  await ctx.plugin(FakeConfigEditor, {})
  await ctx.plugin(FakeWebServer, {})

  await ctx.plugin(plugin, { ...plugin.DEFAULT_SETTINGS, userDataRoot: dir, lang: 'zh', guardDays: 1 })
  assert.equal(injected, 0, '装载期不该已经写过配置')

  const { agent } = makeAgent()
  const fixed = await exec(agent, '/cookie-cleaner patch fix')
  assert.equal(fixed.result.kind, 'success')
  assert.equal(entry.options.config.cookieMaxAgeDays, 1, 'fix 必须真落到运行态')
  assert.match(String(fs.readFileSync(profileFile, 'utf8')), /cookieMaxAgeDays: 1/, 'fix 必须真落到 profile 文件')
  // 写后回传的是**写后**体检（曾经同屏出现「已写入」+「有偏差」的自相矛盾）。
  const after = await exec(agent, '/cookie-cleaner patch check')
  assert.equal(after.result.kind, 'success')
  assert.doesNotMatch(after.result.text, /P1|缺行/, '写完再体检不该还报缺行')

  const back = await exec(agent, '/cookie-cleaner patch revert')
  assert.equal(back.result.kind, 'success')
  assert.doesNotMatch(back.result.text, /失败|error/i, 'revert 文案不该自报失败')
  // 快照必须按 profile 隔离（旧形态是全局单文件，真机串台过），且只能落在 DSH_HOME 临时格。
  const snapshot = snapshotFile(home, profileFile)
  assert.ok(fs.existsSync(snapshot), '快照必须落在 DSH_HOME 临时格（绝不写用户 ~/.dsh）')
  assert.match(snapshot, /patch-snapshot--/, '快照名必须带 profile 身份')
  assert.ok(back.result.text.length > 0)
})
