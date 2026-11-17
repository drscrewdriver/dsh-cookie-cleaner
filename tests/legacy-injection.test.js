/**
 * legacy-injection.js 测试：历史注入残留的识别 / 清理 / 能力闸。
 *
 * 事故背景（要钉住的东西）：
 * 0.2.1 之前本插件提供过「应用端口」动作，把 webserver.port 写成
 * `ctx.webStartup.port ?? +<用户填的数>`。能力删了，但写进用户 profile 的那行不会自己消失。
 * 清理的关键不是"能删"，而是**只删自己写过的那一种**——用户手写的字面量端口、
 * 用户自己的表达式，一律不碰。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canCleanLegacy, classifyLegacyPort, findLegacyInjection, supportsLegacyCleanup, withoutLegacyInjection } from '../src/legacy-injection.js'

const expr = (text) => ({ __jsExpr: text })

test('classifyLegacyPort：认出本插件写过的两种形态（带 + 与不带 +）', () => {
  for (const [text, fallback] of [
    ['ctx.webStartup.port ?? 34568', 34568],
    ['ctx.webStartup.port ?? +34568', 34568],
    ['ctx.webStartup.port ??  4200', 4200],
  ]) {
    const r = classifyLegacyPort(expr(text))
    assert.equal(r.legacy, true, `应认作历史注入：${text}`)
    assert.equal(r.fallback, fallback)
  }
})

test('classifyLegacyPort：用户自己的写法一律不认（防误删）', () => {
  const cases = [
    expr('process.env.PORT ?? 8080'), // 用户自己的表达式
    expr('ctx.webStartup.port'), // 缺 fallback
    expr('ctx.webRuntime.port ?? 3000'), // 别的 ctx 路径
    expr('ctx.webStartup.port ?? someVar'), // fallback 不是数字
    34567, // 字面量（P8 报的那类，绝不代改）
    undefined,
    null,
    '34568',
  ]
  for (const value of cases) {
    assert.equal(classifyLegacyPort(value).legacy, false, `不得认作历史注入：${JSON.stringify(value)}`)
  }
})

test('findLegacyInjection：从真实 profile 形态里找到残留', () => {
  // 本机 desktop profile 的真实形态
  const current = {
    host: '127.0.0.1',
    port: expr('ctx.webStartup.port ?? 34568'),
    compression: 'gzip',
    compressionLevel: 1,
    compressionThresholdBytes: 1024,
  }
  const r = findLegacyInjection({ rowId: 'webserver', current })
  assert.equal(r.found, true)
  assert.equal(r.key, 'port')
  assert.equal(r.fallback, 34568)
  assert.equal(r.expression, 'ctx.webStartup.port ?? 34568')
})

test('findLegacyInjection：bundle 层有原值时一并给出还原目标', () => {
  const r = findLegacyInjection({
    current: { port: expr('ctx.webStartup.port ?? 34568') },
    inherited: { port: expr('ctx.webStartup.port') },
  })
  assert.equal(r.found, true)
  assert.deepEqual(r.restoreTo, expr('ctx.webStartup.port'))
})

test('findLegacyInjection：没有残留时 found=false（不得把干净配置报成有问题）', () => {
  assert.equal(findLegacyInjection({ current: { port: 34567 } }).found, false)
  assert.equal(findLegacyInjection({ current: {} }).found, false)
  assert.equal(findLegacyInjection({}).found, false)
})

test('withoutLegacyInjection：删键而不是抄 bundle 原值', () => {
  const current = { host: '127.0.0.1', port: expr('ctx.webStartup.port ?? 34568'), compression: 'gzip' }
  const { next, changed } = withoutLegacyInjection({ current })
  assert.deepEqual(changed, ['port'])
  assert.equal('port' in next, false, '少一个键 = 该键回落到 bundle 默认，这才是"清掉插件写的东西"')
  assert.equal(next.host, '127.0.0.1', '同一行的其它键必须原样保留')
  assert.equal(next.compression, 'gzip')
  assert.equal('port' in current, true, '不得就地改动入参')
})

test('withoutLegacyInjection：键不存在时 changed 为空（幂等）', () => {
  const { next, changed } = withoutLegacyInjection({ current: { host: 'x' } })
  assert.deepEqual(changed, [])
  assert.deepEqual(next, { host: 'x' })
})

test('canCleanLegacy：只认官方清理能力这个事实判据', () => {
  assert.equal(canCleanLegacy({ nativeCleanup: true }), true)
  assert.equal(canCleanLegacy({ nativeCleanup: false }), false)
  assert.equal(canCleanLegacy({}), false, '拿不到判据就不清（fail-safe）')
})

test('supportsLegacyCleanup：0.2.2-rc.2 是分界线', () => {
  // 达标
  for (const v of ['0.2.2-rc.2', '0.2.2-rc.3', '0.2.2', '0.2.3', '0.3.0', '1.0.0']) {
    assert.equal(supportsLegacyCleanup(v), true, `应支持：${v}`)
  }
  // 不达标（区间内但官方还没接管 cookie 清理）
  for (const v of ['0.2.1', '0.2.1-rc.5', '0.2.2-rc.0', '0.2.2-rc.1', '0.2.0-rc.2', '0.1.7']) {
    assert.equal(supportsLegacyCleanup(v), false, `不应支持：${v}`)
  }
  // 解析不了 → 一律不支持（fail-safe）
  for (const v of [undefined, null, '', 'garbage', '0.2', 'v0.2.2-rc.3']) {
    assert.equal(supportsLegacyCleanup(v), false, `解析不了应判不支持：${String(v)}`)
  }
})
