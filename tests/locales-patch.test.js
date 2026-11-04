/**
 * 9 语 patch 文案表的门禁：缺格、占位符漂移、漏翻残留一律红。
 * 这类测试的价值在于「以后有人加一个码只写了中文」会当场拦住，而不是让德语用户看到半句中文。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PATCH_CODES, PATCH_LANGS, PATCH_TEXT, patchText } from '../src/locales-patch.js'

const HANAKANA = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
const LATIN = ['en', 'fr', 'de', 'it', 'ru', 'es']

function placeholders(text) {
  return [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
}

const BUCKETS = [['PATCH_CODES', PATCH_CODES], ['PATCH_TEXT', PATCH_TEXT]]

for (const [name, table] of BUCKETS) {
  test(`${name}: 每个键都有完整 9 语且非空`, () => {
    for (const [key, entry] of Object.entries(table)) {
      for (const lang of PATCH_LANGS) {
        assert.ok(typeof entry[lang] === 'string' && entry[lang].trim().length >= 2, `${name}.${key}.${lang} 缺失或过短`)
      }
      const extra = Object.keys(entry).filter((lang) => !PATCH_LANGS.includes(lang))
      assert.deepEqual(extra, [], `${name}.${key} 出现了未登记语言 ${extra.join(',')}`)
    }
  })

  test(`${name}: 占位符逐语一致（不允许只在中文里带参数）`, () => {
    for (const [key, entry] of Object.entries(table)) {
      const base = placeholders(entry.zh)
      for (const lang of PATCH_LANGS) {
        assert.equal(placeholders(entry[lang]), base, `${name}.${key}.${lang} 占位符漂移：期望 ${base || '(无)'}`)
      }
    }
  })
}

test('拉丁/西里尔语系不得残留汉字或假名（漏翻在这里红；谚文是韩文正常书写，不算）', () => {
  for (const [, table] of BUCKETS) {
    for (const [key, entry] of Object.entries(table)) {
      for (const lang of LATIN) {
        assert.ok(!HANAKANA.test(entry[lang]), `${key}.${lang} 残留汉字/假名：${entry[lang].slice(0, 50)}`)
      }
    }
  }
})

test('判定码集合与内核可产出的码一致（加规则忘了配文案会红）', () => {
  const codes = Object.keys(PATCH_CODES).sort()
  assert.deepEqual(codes, ['P1', 'P10', 'P11', 'P12', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'])
})

test('patchText 插值：数组用逗号连接，空数组与未知参数都不得漏字面量', () => {
  assert.match(patchText('code', 'P5', 'zh', { dropped: ['trustedHosts', 'tls'] }), /trustedHosts, tls/)
  // 空数组是合法数据（真的没丢键）：渲染成空串可以接受，但绝不能把 `{dropped}` 泄给用户
  assert.equal(patchText('code', 'P5', 'en', { dropped: [] }).includes('{dropped}'), false)
  assert.equal(patchText('text', 'NOPE', 'zh'), 'NOPE', '未知键不得崩，回落键名方便定位')
})

test('未知语言回落 zh，不吞输出', () => {
  assert.equal(patchText('text', 'title', 'zz'), PATCH_TEXT.title.zh)
})
