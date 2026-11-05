/**
 * patch-model 内核判定测试：每条规则都要有「命中」与「不误伤」两面。
 * 这些规则的成因全部来自真机/源码（见 findings §1/§11/§12），不是凭空设定。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  MANAGED_ROWS, aggregateAll, assessRow, isExpression, nextConfigFor, renderPlanBlock,
} from '../src/patch-model.js'

const SRC = path.resolve(import.meta.dirname, '..', 'src')

const CONNECTION = {
  entryFound: true,
  overrideRow: { name: MANAGED_ROWS.connection.name, config: { cookieMaxAgeDays: 1, trustedHosts: [], maxRequestBodyBytes: 314572800 } },
  // 健康态底本：bundle 层不给表达式，P5/P9 由各自用例显式注入
  inherited: {},
  effective: { cookieMaxAgeDays: 1, trustedHosts: [], maxRequestBodyBytes: 314572800 },
  targetDays: 1,
  shadowedBy: null,
  rowId: 'connection',
}

/** bundle 层带表达式、覆盖层给字面量的形态（P5/P9 的靶子）。 */
const WITH_EXPR = {
  ...CONNECTION,
  inherited: { trustedHosts: { __jsExpr: 'ctx.webStartup.trustedHosts' } },
}

const codes = (result) => result.findings.map((f) => f.code)

test('健康态：覆盖行完整且等于目标 → ok，不产出任何 finding', () => {
  const result = assessRow(CONNECTION)
  assert.deepEqual(result.findings, [])
  assert.equal(result.level, 'ok')
  assert.equal(result.actionable, false)
})

test('P1：缺覆盖行且运行值不在目标档 → warn 且可动作', () => {
  const result = assessRow({ ...CONNECTION, overrideRow: undefined, effective: { cookieMaxAgeDays: 30 } })
  assert.deepEqual(codes(result), ['P1'])
  assert.equal(result.level, 'warn')
  assert.equal(result.actionable, true, '缺行是面板应该一键补上的典型场景')
})

test('P2：name 写错 → fail 且不可动作（整行被静默跳过，写也无意义）', () => {
  const result = assessRow({ ...CONNECTION, overrideRow: { name: '@deepseek-ai/dsh-client-conection', config: { cookieMaxAgeDays: 1 } } })
  assert.deepEqual(codes(result), ['P2'])
  assert.equal(result.level, 'fail')
  assert.equal(result.actionable, false)
})

test('P3：合法但偏档（30 > 目标 1）→ warn 且可动作', () => {
  const result = assessRow({ ...CONNECTION, overrideRow: { ...CONNECTION.overrideRow, config: { ...CONNECTION.overrideRow.config, cookieMaxAgeDays: 30 } }, effective: { ...CONNECTION.effective, cookieMaxAgeDays: 30 } })
  assert.deepEqual(codes(result), ['P3'])
  assert.equal(result.level, 'warn')
  assert.equal(result.actionable, true)
})

test('P4：0 或小数是非法值 → fail 且禁止试写（schema 会挡，别去撞）', () => {
  for (const bad of [0, -1, 1.5, '3']) {
    const result = assessRow({ ...CONNECTION, overrideRow: { ...CONNECTION.overrideRow, config: { ...CONNECTION.overrideRow.config, cookieMaxAgeDays: bad } }, effective: { ...CONNECTION.effective, cookieMaxAgeDays: bad } })
    assert.ok(codes(result).includes('P4'), `${String(bad)} 应判 P4`)
    assert.equal(result.actionable, false, `${String(bad)} 绝不能进入写路径`)
  }
})

// 与 P9 同理：bundle 层是表达式而覆盖行没写这个键时，我们只能看到“表达式不再参与求值”，
// 看不到运行态因此变了什么——无据就是无据，不拿它刷偏差，只交给处方。
test('P5：丢掉 bundle 层的表达式键 → 不报偏差，进 exprFrozen（处方会把它补回来）', () => {
  const result = assessRow({
    ...WITH_EXPR,
    overrideRow: { name: MANAGED_ROWS.connection.name, config: { cookieMaxAgeDays: 1 } },
    effective: { cookieMaxAgeDays: 1 },
  })
  assert.equal(result.findings.find((f) => f.code === 'P5'), undefined, '无法证明现状变化就不进结论')
  assert.deepEqual(result.exprFrozen, ['trustedHosts'], '但数据不能丢：粘贴块要把表达式形态还回去')
  assert.equal(result.level, 'ok')
})

// 真机噪声回归（2026-11-04）：desktop 的覆盖行没写 `tls`，而该键在运行态里与 bundle 层同值
// （它本来就只有 schema 默认值）——浅赋值什么都没丢，却被告知「有偏差」。
// 丢没丢必须拿数据对拍，不能看键名清单。
test('P5：丢掉的键在运行态里值没变 → 不算丢（完全按规范写的配置必须是「注入正常」）', () => {
  const result = assessRow({
    rowId: 'webserver',
    entryFound: true,
    overrideRow: {
      name: MANAGED_ROWS.webserver.name,
      config: {
        host: { __jsExpr: "ctx.webStartup.host ?? '127.0.0.1'" },
        port: { __jsExpr: 'ctx.webStartup.port > 0 ? ctx.webStartup.port : 34567' },
        compression: 'gzip',
        compressionLevel: 1,
        compressionThresholdBytes: 1024,
      },
    },
    inherited: { compression: 'none', compressionLevel: 1, compressionThresholdBytes: 1024, tls: {} },
    effective: { compression: 'gzip', compressionLevel: 1, compressionThresholdBytes: 1024, tls: {} },
  })
  assert.deepEqual(result.findings, [], '默认键的缺席与键集齐全都不该产出任何结论')
  assert.equal(result.level, 'ok')
})

test('P5：丢掉的键在运行态里确实变了 → 仍报（不能反过来把规则废了）', () => {
  const result = assessRow({
    rowId: 'webserver',
    entryFound: true,
    overrideRow: { name: MANAGED_ROWS.webserver.name, config: { port: 34567 } },
    inherited: { compression: 'gzip' },
    effective: { port: 34567, compression: 'none' },
  })
  const p5 = result.findings.find((f) => f.code === 'P5')
  assert.ok(p5, 'bundle 层 gzip、运行态落成 none → 真丢了')
  assert.deepEqual(p5.params.dropped, ['compression'])
})

test('P6：home 层影子 → fail 且不可动作（写了也不生效）', () => {
  const result = assessRow({ ...CONNECTION, shadowedBy: 'home' })
  assert.deepEqual(codes(result), ['P6'])
  assert.equal(result.actionable, false)
})

test('P7：文件值与运行值不一致 → fail（未热生效或被上层盖）', () => {
  const result = assessRow({ ...CONNECTION, effective: { ...CONNECTION.effective, cookieMaxAgeDays: 30 } })
  assert.deepEqual(codes(result), ['P7'])
  assert.equal(result.level, 'fail')
})

test('P8：webserver 的 port 写成字面量 → warn（会夺走 --port 旗标权）', () => {
  const literal = assessRow({ rowId: 'webserver', entryFound: true, overrideRow: { name: MANAGED_ROWS.webserver.name, config: { host: '127.0.0.1', port: 34567 } }, inherited: { host: { __jsExpr: "ctx.webStartup.host ?? '127.0.0.1'" }, port: { __jsExpr: 'ctx.webStartup.port ?? 3080' } }, effective: {} })
  assert.ok(codes(literal).includes('P8'))
  assert.equal(literal.writable, false, 'webserver 只报不写')

  const expr = assessRow({ rowId: 'webserver', entryFound: true, overrideRow: { name: MANAGED_ROWS.webserver.name, config: { port: { __jsExpr: 'ctx.webStartup.port > 0 ? ctx.webStartup.port : 34567' } } }, inherited: {}, effective: {} })
  assert.equal(codes(expr).includes('P8'), false, '表达式形态不该被报')
})

test('P9：表达式被抄成字面量 → 不进体检结论，只住在 exprFrozen（处方那里才提）', () => {
  const result = assessRow(WITH_EXPR)
  assert.deepEqual(result.findings, [], '我们无权求值那个表达式，拿不出“现状有变化”的证据就不进结论')
  assert.deepEqual(result.exprFrozen, ['trustedHosts'], '数据必须留着，否则 patch plan 无法提示哪几个键该回到表达式形态')
  assert.equal(result.level, 'ok', '只有形态降级时整体仍是「注入正常」')
  assert.equal(result.actionable, false, '不为假想后果把修复按钮打开')

  const same = assessRow({ ...WITH_EXPR, overrideRow: { name: MANAGED_ROWS.connection.name, config: { cookieMaxAgeDays: 1, trustedHosts: { __jsExpr: 'ctx.webStartup.trustedHosts' } } } })
  assert.deepEqual(same.exprFrozen, [], '形态一致时不该记——它正是「用户改过就不刷」的根据')
})

test('P5：两边都没内容（默认键的形式差异）→ 不算丢', () => {
  const result = assessRow({
    rowId: 'webserver',
    entryFound: true,
    overrideRow: { name: MANAGED_ROWS.webserver.name, config: { port: { __jsExpr: 'ctx.webStartup.port > 0 ? ctx.webStartup.port : 34567' } } },
    inherited: { tls: {} },
    effective: { port: 34567, tls: { cert: '', key: '' } },
  })
  assert.equal(result.findings.find((f) => f.code === 'P5'), undefined, '`{}` vs 空字段：两边都没料，拿不出行为差异')
})

test('P5：丢掉的是真有内容的键（证书材料）→ 仍报', () => {
  const result = assessRow({
    rowId: 'webserver',
    entryFound: true,
    overrideRow: { name: MANAGED_ROWS.webserver.name, config: { port: 34567 } },
    inherited: { tls: { cert: '/etc/dsh/crt.pem', key: '/etc/dsh/key.pem' } },
    effective: { port: 34567, tls: {} },
  })
  const p5 = result.findings.find((f) => f.code === 'P5')
  assert.ok(p5, 'bundle 层给了证书材料、运行态被替成空 → 真丢了')
  assert.deepEqual(p5.params.dropped, ['tls'])
})

test('P10：该 id 在宿主树里不存在 → fail（裸覆盖行被静默跳过）', () => {
  const result = assessRow({ ...CONNECTION, entryFound: false })
  assert.deepEqual(codes(result), ['P10'])
  assert.equal(result.actionable, false)
})

test('P11：整层 YAML 非法 → fail 并短路（此时一切判定都无意义）', () => {
  const result = assessRow({ ...CONNECTION, fileParse: { ok: false, reason: 'root flow [] 后追加分块行' } })
  assert.deepEqual(codes(result), ['P11'])
  assert.equal(result.level, 'fail')
})

test('未知 rowId → skipped，绝不冒充异常', () => {
  const result = assessRow({ rowId: 'nope', entryFound: true })
  assert.equal(result.level, 'skipped')
})

test('聚合优先级：fail > warn > ok，skipped 不参与', () => {
  assert.equal(aggregateAll([{ level: 'ok' }, { level: 'warn' }]).level, 'warn')
  assert.equal(aggregateAll([{ level: 'warn' }, { level: 'fail' }]).level, 'fail')
  assert.equal(aggregateAll([{ level: 'skipped' }, { level: 'ok' }]).level, 'ok')
  assert.equal(aggregateAll([{ level: 'skipped' }]).level, 'skipped')
})

test('nextConfigFor：只动要求的那一键，其余键与表达式形态原样保留', () => {
  const current = { cookieMaxAgeDays: 30, trustedHosts: [], maxRequestBodyBytes: 314572800 }
  const literal = nextConfigFor({ current, targetDays: 1 })
  assert.deepEqual(literal.next, { cookieMaxAgeDays: 1, trustedHosts: [], maxRequestBodyBytes: 314572800 })
  assert.deepEqual(literal.changed, ['cookieMaxAgeDays'])

  // 端口被用户改过 → 我们绝不刷
  const custom = nextConfigFor({ current: { ...current, cookieMaxAgeDays: 1 }, targetDays: 1 })
  assert.deepEqual(custom.changed, [], '已在目标档就不产生任何写入意图')
})

test('nextConfigFor 表达式档：从 inherited 取现成表达式，不硬编码串', () => {
  const inherited = { trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' } }
  const out = nextConfigFor({ current: { cookieMaxAgeDays: 1, trustedHosts: [] }, targetDays: 1, guardMode: 'expression', inherited })
  assert.deepEqual(out.next.trustedHosts, { __jsExpr: 'ctx.webRuntime.trustedHosts' })
  assert.deepEqual(out.changed, ['trustedHosts'])
})

test('renderPlanBlock：输出块序列 + !!js 形态 + 目标值已就位', () => {
  const text = renderPlanBlock({
    rowId: 'webserver',
    inherited: { host: { __jsExpr: "ctx.webStartup.host ?? '127.0.0.1'" }, port: { __jsExpr: 'ctx.webStartup.port > 0 ? ctx.webStartup.port : 34567' }, compression: 'gzip' },
  })
  assert.match(text, /^- id: webserver\n {2}name: '@deepseek-ai\/dsh-host-webserver'\n {2}config:/)
  assert.ok(text.includes('!!js ctx.webStartup.port'), '表达式必须按 !!js 输出')
  assert.ok(!text.includes('__jsExpr'), '不得把内部形态泄漏给用户')
  assert.ok(text.includes("compression: 'gzip'"))

  const conn = renderPlanBlock({ rowId: 'connection', inherited: { trustedHosts: [] }, current: { cookieMaxAgeDays: 30 }, targetDays: 1 })
  assert.ok(conn.includes('cookieMaxAgeDays: 1'), '目标值要在合成时就落位')
})

test('isExpression 只认单键 __jsExpr，别的对象一律按字面量处理', () => {
  assert.equal(isExpression({ __jsExpr: 'x' }), true)
  assert.equal(isExpression({ __jsExpr: 'x', other: 1 }), false)
  assert.equal(isExpression({ other: 1 }), false)
  assert.equal(isExpression('__jsExpr'), false)
  assert.equal(isExpression(null), false)
})

test('端口写入门面已从内核删除（只剩只读判定 P8）', () => {
  // 用户裁决 2026-11-05：本插件只改配置里的 cookie 有效期。
  // 钉「导出不存在」而不是钉行为：行为测试会随实现一起被删，导出面才能拦住“顺手加回来”。
  const source = fs.readFileSync(path.join(SRC, 'patch-model.js'), 'utf8')
  for (const name of ['PORT_WRITE', 'isValidPort', 'portExpressionFor', 'nextPortConfig']) {
    assert.doesNotMatch(source, new RegExp(`export (?:const|function) ${name}\\b`), `${name} 应已删除`)
  }
})

// 用户口径（2026-11-04）：“也不固定 34567 吧”。拿机械扫描钉住这句话：
// 代码里不得出现任何被当成默认值的端口常量，端口只能来自用户输入或宿主已有的表达式。
test('src 里不得出现具体默认端口常量', () => {
  const files = []
  for (const dir of [SRC, path.join(SRC, 'client')]) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      if (fs.statSync(full).isDirectory()) continue
      files.push(full)
    }
  }
  const hit = files.filter((f) => /34567|3080|8080/.test(fs.readFileSync(f, 'utf8')))
  assert.deepEqual(hit.map((f) => path.basename(f)), [], 'src 里出现了端口常量')
})
