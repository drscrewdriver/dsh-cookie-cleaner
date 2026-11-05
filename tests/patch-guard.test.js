/**
 * patch-guard 宿主适配层测试。
 *
 * 关注点不是「能不能跑」，而是三条纪律机械成立：
 * - 判定不可动作时 **一次都不碰 edit()**（P2/P4/P6/P10/P11）；
 * - 写成功必须回读 effective 才算 fixed（不谎报）；
 * - `HMR transactions cannot be nested` 只重试一次并如实标注，不硬失败。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPatchGuard } from '../src/patch-guard.js'
import { patchReportText } from '../src/report.js'

// 路盘符必须用**本平台**分隔符拼：守卫里用的是 path.join，测试给 POSIX 风格 key
// 会在 Windows 上对不上（`/h/cordis.patch.yml` ≠ `/h\cordis.patch.yml`），把真代码误判成 bug。
const HOME = path.join(os.tmpdir(), 'dcc-fake-home')
const HOME_PATCH = path.join(HOME, 'cordis.patch.yml')
// 快照按 profile 隔离（假 editor 的 documentPath 是 `profiles/desktop/…`，所以文件名带 desktop）。
// 旧形态是全局单文件 `patch-snapshot.json`，真机串台过：一个格的修复历史会被另一个格看到。
const SNAPSHOT = path.join(HOME, 'cookie-cleaner', 'patch-snapshot--desktop.json')

const PROFILE_GOOD = `- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    cookieMaxAgeDays: 1
    trustedHosts: []
    maxRequestBodyBytes: 314572800
`
const PROFILE_STALE = PROFILE_GOOD.replace('cookieMaxAgeDays: 1', 'cookieMaxAgeDays: 30')
const PROFILE_BAD_NAME = PROFILE_GOOD.replace('dsh-client-connection', 'dsh-client-conection')
const PROFILE_BAD_VALUE = PROFILE_GOOD.replace('cookieMaxAgeDays: 1', 'cookieMaxAgeDays: 0')
const HOME_SHADOW = `- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    cookieMaxAgeDays: 30
`

/** 两行都在的 profile（webserver 用字面量 port）——P8 / plan 块的靶子。
 * 没有 webserver 行时 P8 本来就不该命中（端口来自 bundle 表达式），这是正确行为。 */
const PROFILE_BOTH = `- id: webserver
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

/** 假 configEditor：只实现被测面用到的东西。 */
function fakeEditor(options = {}) {
  const state = {
    connectionConfig: options.connectionConfig ?? { cookieMaxAgeDays: 30, trustedHosts: [], maxRequestBodyBytes: 314572800 },
    edits: [],
  }
  const entry = { options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection', config: state.connectionConfig } }
  const webserverEntry = { options: { id: 'webserver', name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 34567, compression: 'gzip' } } }
  return {
    state,
    documentPath: '/fake/profiles/desktop/cordis.patch.yml',
    entries: () => (options.noEntries ? [] : [entry, webserverEntry]),
    configuration: () => ([
      { entry, inherited: options.inherited ?? {}, override: overrideOf(options.profileText ?? PROFILE_STALE, 'connection') },
      { entry: webserverEntry, inherited: options.webInherited ?? { host: { __jsExpr: "ctx.webStartup.host ?? '127.0.0.1'" }, port: { __jsExpr: 'ctx.webStartup.port ?? 3080' }, tls: { __jsExpr: 'ctx.webStartup.tls' } }, override: overrideOf(options.profileText ?? PROFILE_STALE, 'webserver') },
    ]),
    edit: async (_entry, change) => {
      if (options.throwNestedOnce && !state.nestedRetried) {
        state.nestedRetried = true
        throw new Error('HMR transactions cannot be nested')
      }
      const next = change(state.connectionConfig)
      state.edits.push(JSON.parse(JSON.stringify(next)))
      // 模拟宿主的 schema 校验：非法值不落盘（与 configEditor 的 resolveConfig 同语义）
      if (!Number.isInteger(next.cookieMaxAgeDays) || next.cookieMaxAgeDays < 1) throw new Error('invalid config: $.cookieMaxAgeDays expected number >= 1')
      state.connectionConfig = next
      // 真宿主在 reconcile 后会把新配置同步回 entry.options.config（Gate 0 实测 effective 立即变），
      // 桩不跟着做就会把「写完回读」这条真实路径测成假失败。
      entry.options.config = next
      // 并且**真的改文件**：否则写完再体检时，文件层还是旧值，测不出「写后 result」的真实语义。
      if (options.fsModule !== undefined && typeof options.profilePath === 'string') {
        options.fsModule.writeFileSync(options.profilePath,
          options.fsModule.readFileSync(options.profilePath).replace(/cookieMaxAgeDays: \d+/, `cookieMaxAgeDays: ${next.cookieMaxAgeDays}`))
      }
      if (typeof options.afterEdit === 'function') options.afterEdit(next)
    },
  }
}

function overrideOf(text, id) {
  const block = text.split(/\r?\n/).reduce((acc, line) => {
    if (/^- id: (\S+)/.test(line)) acc.current = line.match(/^- id: (\S+)/)[1]
    else if (acc.current === id && /^ {4}(\w+):\s*(.*)$/.test(line)) {
      const [, key, raw] = line.match(/^ {4}(\w+):\s*(.*)$/)
      acc.out[key] = raw === '[]' ? [] : (/^[-+]?\d+$/.test(raw) ? Number(raw) : raw.replace(/^'|'$/g, ''))
    }
    return acc
  }, { out: {} })
  return block.out
}

/** 假 fs：内存文件表。 */
function fakeFs(files) {
  const written = new Map()
  return {
    written,
    readFileSync: (file) => {
      if (written.has(file)) return written.get(file)
      if (file in files) return files[file]
      const e = new Error(`ENOENT: no such file, open '${file}'`)
      e.code = 'ENOENT'
      throw e
    },
    mkdirSync: () => undefined,
    writeFileSync: (file, data) => { written.set(file, data) },
  }
}
test('修复结果带审计信息，且下次 check 仍能看到 lastFix（面板重开不丢审计）', async () => {
  const fsModule = fakeFs({ '/fake/profiles/desktop/cordis.patch.yml': PROFILE_STALE })
  const editor = fakeEditor({ profileText: PROFILE_STALE, fsModule, profilePath: '/fake/profiles/desktop/cordis.patch.yml' })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fsModule, homeDir: HOME, now: () => 1700000000000 })

  assert.equal(guard.check({ targetDays: 1 }).lastFix, undefined, '没修过就不该有审计行')

  const fixed = await guard.fix({ targetDays: 1 })
  assert.equal(fixed.kind, 'fixed')
  assert.equal(fixed.beforeValue, 30, '修复前的值要交给面板显示')
  assert.equal(fixed.snapshotAt, new Date(1700000000000).toISOString())
  // 回传的体检必须是**写之后**的状态：否则面板会同时显示“已写入”和“缺行・有偏差”
  const conn = fixed.result.rows.find((r) => r.rowId === 'connection')
  assert.equal(conn.level, 'ok', `fix 回传的 result 应为写后状态，实际 findings=${JSON.stringify(conn.findings.map((f) => f.code))}`)
  assert.deepEqual(conn.findings, [])

  // 重新建一个守卫（相当于面板重开/进程复用同一快照文件），lastFix 仍从快照读回
  const reopened = createPatchGuard({ getEditor: () => editor, fs: fsModule, homeDir: HOME }).check({ targetDays: 1 })
  assert.equal(reopened.lastFix.beforeDays, 30)
  assert.equal(reopened.lastFix.targetDays, 1)
  assert.ok(typeof reopened.lastFix.at === 'string')
})

test('服务缺席（老线/未装配）→ skipped，且不碰任何 IO', () => {
  const guard = createPatchGuard({ getEditor: () => undefined, homeDir: HOME })
  const result = guard.check()
  assert.equal(result.level, 'skipped')
  assert.equal(result.reason, 'no-config-editor')
})

test('已在目标档 → ok，无 finding', () => {
  const editor = fakeEditor({ profileText: PROFILE_GOOD, connectionConfig: { cookieMaxAgeDays: 1, trustedHosts: [], maxRequestBodyBytes: 314572800 } })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fakeFs({ [editor.documentPath]: PROFILE_GOOD }), homeDir: HOME })
  const result = guard.check({ targetDays: 1 })
  const conn = result.rows.find((r) => r.rowId === 'connection')
  assert.equal(conn.level, 'ok')
  assert.deepEqual(conn.findings, [])
})

test('偏档（30 → 目标 1）→ warn 且 actionable', () => {
  const editor = fakeEditor({ profileText: PROFILE_STALE })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fakeFs({ [editor.documentPath]: PROFILE_STALE }), homeDir: HOME })
  const conn = guard.check({ targetDays: 1 }).rows.find((r) => r.rowId === 'connection')
  assert.ok(conn.findings.some((f) => f.code === 'P3'))
  assert.equal(conn.actionable, true)
})

test('name 写错 → P2 fail 且 edit 一次都不被调用', async () => {
  const editor = fakeEditor({ profileText: PROFILE_BAD_NAME })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fakeFs({ [editor.documentPath]: PROFILE_BAD_NAME }), homeDir: HOME })
  const outcome = await guard.fix({ targetDays: 1 })
  assert.equal(outcome.kind, 'blocked')
  assert.deepEqual(outcome.codes, ['P2'])
  assert.equal(editor.state.edits.length, 0, '不可动作就必须零写入')
})

test('非法值 → P4 fail 且零写入（不去撞宿主 schema）', async () => {
  const editor = fakeEditor({ profileText: PROFILE_BAD_VALUE })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fakeFs({ [editor.documentPath]: PROFILE_BAD_VALUE }), homeDir: HOME })
  const outcome = await guard.fix({ targetDays: 1 })
  assert.equal(outcome.kind, 'blocked')
  assert.ok(outcome.codes.includes('P4'))
  assert.equal(editor.state.edits.length, 0)
})

test('home 层影子 → P6 fail 且零写入，并指到 home 文件', async () => {
  const editor = fakeEditor({ profileText: PROFILE_STALE })
  const guard = createPatchGuard({
    getEditor: () => editor,
    fs: fakeFs({ [editor.documentPath]: PROFILE_STALE, [HOME_PATCH]: HOME_SHADOW }),
    homeDir: HOME,
  })
  const conn = guard.check({ targetDays: 1 }).rows.find((r) => r.rowId === 'connection')
  assert.ok(conn.findings.some((f) => f.code === 'P6'))
  assert.equal(conn.actionable, false)
  const outcome = await guard.fix({ targetDays: 1 })
  assert.equal(outcome.kind, 'blocked')
  assert.equal(editor.state.edits.length, 0)
})

test('修复成功：写入 + 回读 effective + 留快照', async () => {
  const editor = fakeEditor({ profileText: PROFILE_STALE })
  const fsModule = fakeFs({ [editor.documentPath]: PROFILE_STALE })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fsModule, homeDir: HOME, now: () => 1700000000000 })
  const outcome = await guard.fix({ targetDays: 1 })
  assert.equal(outcome.kind, 'fixed')
  assert.deepEqual(outcome.changed, ['cookieMaxAgeDays'])
  assert.equal(outcome.effective, 1)
  assert.equal(outcome.applied, true)
  // 其余键必须原样带上（浅赋值整块替换，漏键=落回默认）
  assert.equal(editor.state.edits[0].trustedHosts.length, 0)
  assert.equal(editor.state.edits[0].maxRequestBodyBytes, 314572800)
  const snap = JSON.parse(fsModule.written.get(SNAPSHOT))
  // 快照 v2：按行存放（cookie 寿命与端口各自回到各自的前值）
  assert.equal(snap.rows.connection.config.cookieMaxAgeDays, 30, '快照存的是修复前的值')
  assert.equal(snap.rows.connection.targetDays, 1, '目标档也要进快照')
  assert.equal(snap.generatedAt, new Date(1700000000000).toISOString(), '落盘缓存必须露出生成时间')
})

test('嵌套事务错误：退避重试一次后成功，并如实标 retried', async () => {
  const editor = fakeEditor({ profileText: PROFILE_STALE, throwNestedOnce: true })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fakeFs({ [editor.documentPath]: PROFILE_STALE }), homeDir: HOME, wait: async () => undefined })
  const outcome = await guard.fix({ targetDays: 1 })
  assert.equal(outcome.kind, 'fixed')
  assert.equal(outcome.retried, true)
})

test('重试仍失败 → kind:failed 且 nested=true，绝不报成成功', async () => {
  const editor = fakeEditor({ profileText: PROFILE_STALE })
  editor.edit = async () => { throw new Error('HMR transactions cannot be nested') }
  const guard = createPatchGuard({ getEditor: () => editor, fs: fakeFs({ [editor.documentPath]: PROFILE_STALE }), homeDir: HOME, wait: async () => undefined })
  const outcome = await guard.fix({ targetDays: 1 })
  assert.equal(outcome.kind, 'failed')
  assert.equal(outcome.nested, true)
})

test('回滚：按快照写回；没有快照就明说', async () => {
  const editor = fakeEditor({ profileText: PROFILE_STALE })
  const fsModule = fakeFs({ [editor.documentPath]: PROFILE_STALE })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fsModule, homeDir: HOME })
  assert.equal((await guard.revert()).kind, 'no-snapshot', '没修过就没有可回滚的东西')

  await guard.fix({ targetDays: 1 })
  const back = await guard.revert()
  assert.equal(back.kind, 'reverted')
  assert.equal(back.effective, 30)
})

test('webserver 行永远不可动作（只体检不自动写）', async () => {
  const editor = fakeEditor({ profileText: PROFILE_BOTH })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fakeFs({ [editor.documentPath]: PROFILE_BOTH }), homeDir: HOME })
  const web = guard.check({ targetDays: 1 }).rows.find((r) => r.rowId === 'webserver')
  assert.equal(web.writable, false)
  assert.equal(web.actionable, false)
  assert.ok(web.findings.some((f) => f.code === 'P8'), 'port 字面量要被抓到')
})

test('没有 webserver 覆盖行时不报 P8（端口来自 bundle 表达式，本来就没钉死）', () => {
  const editor = fakeEditor({ profileText: PROFILE_STALE })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fakeFs({ [editor.documentPath]: PROFILE_STALE }), homeDir: HOME })
  const web = guard.check({ targetDays: 1 }).rows.find((r) => r.rowId === 'webserver')
  assert.deepEqual(web.findings, [])
  assert.equal(web.level, 'ok')
})

test('表达式档：把 bundle 层的表达式还原进写入意图，串取自 inherited 不硬编码', async () => {
  const editor = fakeEditor({
    profileText: PROFILE_STALE,
    inherited: { trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' } },
  })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fakeFs({ [editor.documentPath]: PROFILE_STALE }), homeDir: HOME })
  const outcome = await guard.fix({ targetDays: 1, guardMode: 'expression' })
  assert.equal(outcome.kind, 'fixed')
  assert.deepEqual(editor.state.edits[0].trustedHosts, { __jsExpr: 'ctx.webRuntime.trustedHosts' })
  assert.ok(outcome.changed.includes('trustedHosts'))
})

test('plan 输出的粘贴块带 !!js 与目标值', () => {
  const editor = fakeEditor({
    profileText: PROFILE_BOTH,
    webInherited: { host: { __jsExpr: "ctx.webStartup.host ?? '127.0.0.1'" }, port: { __jsExpr: 'ctx.webStartup.port > 0 ? ctx.webStartup.port : 34567' } },
  })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fakeFs({ [editor.documentPath]: PROFILE_BOTH }), homeDir: HOME })
  const result = guard.plan({ targetDays: 1, guardMode: 'expression' })
  const web = result.blocks.find((b) => b.rowId === 'webserver')
  assert.ok(web.block.includes('!!js ctx.webStartup.port > 0'), '块里要能直接粘表达式形态')
  assert.ok(!web.block.includes('__jsExpr'))
  const conn = result.blocks.find((b) => b.rowId === 'connection')
  assert.ok(conn.block.includes('cookieMaxAgeDays: 1'))
})

// 用户口径（2026-11-04）：「表达式被抄成字面量」不在体检里刷屏，但处方必须能提出来。
test('体检 ok 但存在表达式被抄成字面量：不报偏差，plan 仍输出该行的粘贴块与 exprFrozen', () => {
  const HEALTHY = `- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    cookieMaxAgeDays: 1
    trustedHosts: []
    maxRequestBodyBytes: 314572800
`
  const editor = fakeEditor({
    profileText: HEALTHY,
    connectionConfig: { cookieMaxAgeDays: 1, trustedHosts: [], maxRequestBodyBytes: 314572800 },
    inherited: { trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' }, maxRequestBodyBytes: 314572800 },
    webInherited: {},
  })
  const guard = createPatchGuard({ getEditor: () => editor, fs: fakeFs({ [editor.documentPath]: HEALTHY }), homeDir: HOME })
  const checked = guard.check({ targetDays: 1 })
  assert.equal(checked.level, 'ok', '拿不出“现状有变化”的证据就不能刷偏差')
  assert.deepEqual(checked.rows.find((row) => row.rowId === 'connection').findings, [])
  assert.deepEqual(checked.rows.find((row) => row.rowId === 'connection').exprFrozen, ['trustedHosts'])

  const planned = guard.plan({ targetDays: 1 })
  const conn = planned.blocks.find((b) => b.rowId === 'connection')
  assert.ok(conn, '无偏差但存在冻结表达式时，该行仍要有可粘贴的块')
  assert.deepEqual(conn.exprFrozen, ['trustedHosts'])
  const text = patchReportText(planned, { lang: 'zh' })
  assert.match(text, /注入正常/, '体检绿态要给肯定结论')
  assert.match(text, /不再跟进/, 'P9 只在处方里出现')
  assert.match(text, /guardMode/, '要同时给“拿回跟随形态”的动作')
})

// 端口写入能力（applyPort / PORT_WRITE / 占用探针）已于 2026-11-05 整体删除：
// 本插件只改配置里的 cookie 有效期。不保留端口行为测试，只在 patch-model.test.js 钉“导出不存在”。

// 真机串台回归（2026-11-04）：快照曾是全局单文件，于是
// ① 隔离格那次 fix 的「上次修复」出现在了用户真实 profile 的卡片上，
// ② 更糟的是用户在另一个 profile 点「回滚」会把**别的 profile** 的旧 config 写进来。
// 两个都必须钉住：不同 profile 的快照文件不同名，且互不可见。
test('快照按 profile 隔离：别的 profile 的修复历史不得进入本 profile 的体检与回滚', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-iso-home-'))
  const profilesRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-iso-')), 'profiles')
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(path.dirname(profilesRoot), { recursive: true, force: true })
  })

  const fileFor = (name, days) => {
    const dir = path.join(profilesRoot, name)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'cordis.patch.yml')
    fs.writeFileSync(file, PROFILE_STALE.replace('cookieMaxAgeDays: 30', `cookieMaxAgeDays: ${String(days)}`), 'utf8')
    return file
  }
  /** 真改文件的极简 editor（每个 profile 一份，documentPath 决定快照归属）。 */
  const editorFor = (file, days) => {
    const entry = { options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection', config: { cookieMaxAgeDays: days, trustedHosts: [], maxRequestBodyBytes: 314572800 } } }
    return {
      documentPath: file,
      entries: () => [entry],
      configuration: () => [{ entry, inherited: {}, override: entry.options.config }],
      async edit(_e, change) {
        const next = change(structuredClone(entry.options.config))
        entry.options.config = next
        fs.writeFileSync(file, String(fs.readFileSync(file, 'utf8')).replace(/cookieMaxAgeDays: \d+/, `cookieMaxAgeDays: ${next.cookieMaxAgeDays}`), 'utf8')
      },
    }
  }
  const alphaFile = fileFor('alpha', 30)
  const betaFile = fileFor('beta', 7)
  // editor 必须**跨调用同一个实例**：写成 `getEditor: () => editorFor(...)` 会每次新建一个 entry，
  // 守卫改完就被丢弃，回读永远看不到新值（桩失真会把真代码误判成 bug）。
  const alphaEditor = editorFor(alphaFile, 30)
  const alpha = createPatchGuard({ getEditor: () => alphaEditor, fs, homeDir: home })
  const betaEditor = editorFor(betaFile, 7)
  const beta = createPatchGuard({ getEditor: () => betaEditor, fs, homeDir: home })

  const fixed = await alpha.fix({ targetDays: 1 })
  assert.equal(fixed.kind, 'fixed', 'alpha 格应真能修')
  assert.notEqual(fixed.snapshotFile, path.join(home, 'cookie-cleaner', 'patch-snapshot.json'), '不得再写全局单文件快照')
  assert.match(fixed.snapshotFile, /patch-snapshot--alpha\.json$/, '快照名必须带 profile 身份')

  assert.equal(beta.check({ targetDays: 1 }).lastFix, undefined, 'beta 不得看到 alpha 的修复历史')
  const rev = await beta.revert()
  assert.equal(rev.kind, 'no-snapshot', 'beta 无自己的快照就不能回滚（绝不能拿别人的旧值写）')
  assert.equal(betaEditor.entries()[0].options.config.cookieMaxAgeDays, 7, 'beta 的运行态不得被 alpha 的快照污染')
  assert.match(String(fs.readFileSync(betaFile, 'utf8')), /cookieMaxAgeDays: 7/, 'beta 的文件必须原样不动')
})
