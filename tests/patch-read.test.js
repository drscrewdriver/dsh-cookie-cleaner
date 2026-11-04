/**
 * patch-read 只读解析器测试：核心是「认得的必须认对，认不出的必须明说」。
 * 猜错的判定比不判定更坏，所以降级路径的用例和命中路径同样重要。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findOverrideRow, insertedIds, mentionsId, parsePatchText } from '../src/patch-read.js'

const REAL = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries.
# ---- dsh-auth-* cookie 累积治理（bundle 层之后应用，故可覆盖官方行 config）----
# 不用 !!js 的原因：见上文说明。
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  config:
    host: 127.0.0.1
    port: 34567
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    cookieMaxAgeDays: 1
    trustedHosts: []
    maxRequestBodyBytes: 314572800   # 与 zod 默认同值，显式写出以防未来加键时被静默抹平
`

test('真实 profile 尾部：两行都解析出来，值形态正确', () => {
  const parsed = parsePatchText(REAL)
  assert.equal(parsed.ok, true, parsed.reason)
  assert.equal(parsed.rows.length, 2)

  const conn = findOverrideRow(parsed, 'connection')
  assert.equal(conn.name, '@deepseek-ai/dsh-client-connection')
  assert.equal(conn.config.cookieMaxAgeDays, 1)
  assert.deepEqual(conn.config.trustedHosts, [])
  assert.equal(conn.config.maxRequestBodyBytes, 314572800)

  const web = findOverrideRow(parsed, 'webserver')
  assert.equal(web.config.port, 34567)
  assert.equal(web.config.compression, 'gzip')
})

test('行尾注释被剥掉，注释里的中文不会污染值', () => {
  const parsed = parsePatchText(REAL)
  const conn = findOverrideRow(parsed, 'connection')
  assert.equal(conn.config.maxRequestBodyBytes, 314572800, '带 `   # 注释` 的行必须落成数字')
  assert.ok(!JSON.stringify(conn.config).includes('zod'))
})

test('!!js 前缀转成 {__jsExpr}，与 configEditor 的往返形态一致', () => {
  const parsed = parsePatchText([
    '- id: connection',
    `  name: '@deepseek-ai/dsh-client-connection'`,
    '  config:',
    '    cookieMaxAgeDays: 1',
    '    trustedHosts: !!js ctx.webRuntime.trustedHosts',
  ].join('\n'))
  assert.equal(parsed.ok, true)
  const conn = findOverrideRow(parsed, 'connection')
  assert.deepEqual(conn.config.trustedHosts, { __jsExpr: 'ctx.webRuntime.trustedHosts' })
})

test('P11 的真实成因：模板根 flow `[]` 后面追分块行 → 直接判不可解析', () => {
  const parsed = parsePatchText('# 说明\n[]\n\n- id: connection\n  name: x\n  config:\n    cookieMaxAgeDays: 1\n')
  assert.equal(parsed.ok, false)
  assert.match(parsed.reason, /flow root/, '要给出可指认的原因，而不是笼统的 parse error')
})

test('insert 形态合法：子条目被记为新增行，不当成覆盖行', () => {
  const parsed = parsePatchText('- insert:\n    - id: ce-probe\n      name: ./_ce-probe.mjs\n')
  assert.equal(parsed.ok, true, parsed.reason)
  assert.equal(findOverrideRow(parsed, 'ce-probe'), undefined, 'insert 内的子条目不得冒充覆盖行')
  assert.deepEqual(insertedIds(parsed.rows), ['ce-probe'])
  assert.equal(mentionsId(parsed, 'ce-probe'), true)
})

test('空 profile 层（[] 或 全注释）→ ok 且没有行，交给 P1 判缺', () => {
  for (const text of ['[]\n', '# 还没配\n', '\n']) {
    const parsed = parsePatchText(text)
    assert.equal(parsed.ok, true, text)
    assert.deepEqual(parsed.rows, [], text)
  }
})

test('真实 profile 里的深层嵌套（providers 列表）不得误报整层失效（真机踩到的假阳性）', () => {
  const deep = [
    '- id: llm',
    `  name: '@deepseek-ai/dsh-llm'`,
    '  config:',
    '    providers:',
    '      - id: deepseek-v4',
    '        name: DeepSeek-V4',
    '        reasoning:',
    '          supportedEfforts:',
    '            - low',
    '            - high',
    '    enabledModelIds: []',
    '- id: connection',
    `  name: '@deepseek-ai/dsh-client-connection'`,
    '  config:',
    '    cookieMaxAgeDays: 1',
  ].join('\n')
  const parsed = parsePatchText(deep)
  assert.equal(parsed.ok, true, parsed.reason)
  assert.equal(findOverrideRow(parsed, 'connection').config.cookieMaxAgeDays, 1, '跳过的深层内容不得吃掉后面的行')
  assert.ok((parsed.skippedDeep ?? 0) > 0, '跳过的深度要有计数，不然不知道看了多少看不见的东西')
})

test('超出子集的构造一律 ok:false（宁可不判，也不猜）', () => {
  const cases = [
    '- id: connection\n  name: x\n  config: {cookieMaxAgeDays: 1}\n',
    '- &anchor\n  id: connection\n  name: x\n',
    '--- \n- id: connection\n  name: x\n',
  ]
  for (const text of cases) {
    const parsed = parsePatchText(text)
    if (parsed.ok) assert.fail(`应判不可解析：${text.split('\n')[0]}`)
    assert.ok(parsed.reason, '必须有原因')
  }
})

test('后写的同 id 行赢（与 applyEntryPatches 的顺序语义一致）', () => {
  const parsed = parsePatchText([
    '- id: connection',
    '  name: a',
    '  config:',
    '    cookieMaxAgeDays: 30',
    '- id: connection',
    '  name: a',
    '  config:',
    '    cookieMaxAgeDays: 1',
  ].join('\n'))
  assert.equal(findOverrideRow(parsed, 'connection').config.cookieMaxAgeDays, 1)
})
