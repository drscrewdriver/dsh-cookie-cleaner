/**
 * i18n 门禁测试：9 语键集对齐 + 占位符保留 + 装载期防漂移。
 *
 * 这类测试的价值在于「以后有人加一个键只写了中文」会立刻红，
 * 而不是等用户在德语环境上看到半句中文。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { LANGS, detectLang, dictionaries, exitFor, normalize, registerDictionary, translator, zh, zhKeys } from '../src/i18n.js'
import { exitInstruction, setLang } from '../src/core.js'
import { cookieCleanerCommandText } from '../src/report.js'

const ROOT = path.resolve(import.meta.dirname, '..')

/** 取占位符集合（{name} 形式）。 */
function placeholders(text) {
  return [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

test('LANGS 恰好 9 语，且 zh 在位', () => {
  assert.deepEqual(LANGS, ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'it', 'ru', 'es'])
})

test('其余 8 语已装载，且与 zh 逐键同集', () => {
  for (const lang of LANGS.filter((l) => l !== 'zh')) {
    const dict = dictionaries[lang]
    assert.ok(dict, `${lang} 未注册（locales-dict 装载链断了）`)
    assert.deepEqual(Object.keys(dict).sort(), [...zhKeys].sort(), `${lang} 键集与 zh 不一致`)
  }
})

test('每一语的占位符必须与 zh 完全一致（不多不少）', () => {
  for (const lang of LANGS) {
    const dict = dictionaries[lang]
    for (const key of zhKeys) {
      assert.deepEqual(
        placeholders(dict[key]),
        placeholders(zh[key]),
        `${lang}.${key} 占位符漂移：${dict[key]}`,
      )
    }
  }
})

test('拉丁/西里尔语系不得残留汉字或假名（漏翻会在这里红）', () => {
  // 注意：不能把 Hangul 归进 CJK 一同拦下——韩文本来全是谚文。
  const hanakana = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
  for (const lang of ['en', 'fr', 'de', 'it', 'ru', 'es']) {
    for (const key of zhKeys) {
      assert.ok(!hanakana.test(dictionaries[lang][key]), `${lang}.${key} 残留汉字/假名：${dictionaries[lang][key].slice(0, 60)}`)
    }
  }
})

test('registerDictionary 对缺键/多键直接抛错（新加键只写中文会当场红）', () => {
  assert.throws(() => registerDictionary('en', { skipped: 'x' }), /缺键/)
  assert.throws(() => registerDictionary('en', Object.fromEntries([...zhKeys.map((k) => [k, 'x']), ['bogusKey', 'y']])), /多余键/)
  assert.throws(() => registerDictionary('pt', Object.fromEntries(zhKeys.map((k) => [k, 'x']))), /不支持的语言/)
})

test('normalize / detectLang：认得的收，认不出的落 zh', () => {
  assert.equal(normalize('de-AT'), 'de')
  assert.equal(normalize('EN-us'), 'en')
  assert.equal(normalize('pt_BR'), 'zh', '未支持语言落底而非崩')
  assert.equal(normalize(''), 'zh')
  assert.equal(normalize(undefined), 'zh')
  // POSIX 中性 locale（C / C.UTF-8 / POSIX）不是中文环境，实测 WSL 默认就是 C.UTF-8
  assert.equal(normalize('C.UTF-8'), 'en')
  assert.equal(normalize('POSIX'), 'en')
  assert.equal(detectLang({ LANG: 'C.UTF-8' }, ''), 'en')
  assert.equal(detectLang({ DSH_COOKIE_LANG: 'ru' }, 'de'), 'ru', '显式变量优先于探测')
  assert.equal(detectLang({}, 'ja_JP.UTF-8'), 'ja', '无环境变量时用系统 locale')
})

test('translator 缺键回落 zh 原文，插值正常', () => {
  const t = translator('fr')
  assert.match(t('busy', { path: '/tmp/Cookies' }), /\/tmp\/Cookies$/)
  assert.ok(!t('busy', { path: '/x' }).includes('{path}'), '占位符必须被替换掉')
  assert.equal(t('notAKeyAtAll'), 'notAKeyAtAll', '未知键原样透出，不静默变空串')
})

test('exitInstruction 按语言与平台双重正确', () => {
  for (const lang of LANGS) {
    assert.ok(exitInstruction('darwin', lang).length > 4, `${lang} darwin 文案为空`)
    assert.ok(exitInstruction('linux', lang).length > 4, `${lang} linux 文案为空`)
  }
  // 非中日语不得出现「托盘」；日语允许汉字但不能出现中文那整句
  for (const lang of ['en', 'de', 'ru', 'es']) {
    assert.ok(!exitInstruction('win32', lang).includes('托盘'), `${lang} 混入了 Windows 中文指引`)
  }
  assert.ok(exitInstruction('win32', 'zh').includes('托盘'))
})

test('降级文案在 9 语下都给出可执行命令（不只中文有下一步）', () => {
  const stat = { verdict: 'warn', reason: 'busy', path: '/tmp/Cookies' }
  for (const lang of LANGS) {
    const text = cookieCleanerCommandText(stat, { lang, platform: 'linux' })
    assert.match(text, /--clean/, `${lang} 少了清理命令`)
    assert.ok(!/托盘/.test(text), `${lang} 串了 Windows 指引`)
  }
})

test('locale/<lang>.json：9 语齐备、en 锚存在、meta 非空串', () => {
  const dir = path.join(ROOT, 'locale')
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  assert.deepEqual(files.sort(), [...LANGS].map((l) => `${l}.json`).sort(), 'locale 目录必须正好这 9 份')
  for (const lang of LANGS) {
    const raw = readFileSync(path.join(dir, `${lang}.json`), 'utf8')
    assert.ok(!raw.charCodeAt(0).toString(16).startsWith('feff'), `${lang}.json 不得带 BOM`)
    const json = JSON.parse(raw)
    assert.equal(typeof json.meta?.title, 'string')
    assert.ok(json.meta.title.length > 0, `${lang}.json meta.title 为空`)
    assert.ok((json.meta.description ?? '').length > 20, `${lang}.json meta.description 太短`)
  }
})

test('setLang 影响 core 侧输出（describeStat / 错误文案随语言）', () => {
  setLang('en')
  const stat = cookieStatFixture()
  assert.match(describeStatEn(stat), /Found 3 dsh-auth-\*/, `实际：${describeStatEn(stat)}`)
  setLang('zh')
})

function cookieStatFixture() {
  return {
    verdict: 'warn',
    reason: 'has-stale-entries',
    path: '/tmp/Cookies',
    bytes: 20480,
    totalCookies: 5,
    authCookies: 3,
    authExpired: 1,
    authLive: 2,
    byHost: [{ hostKey: '127.0.0.1', count: 3 }],
  }
}

function describeStatEn(stat) {
  // 直接走 core 的 describeStat（它读 activeLang），避免把语言状态绑到参数上
  const { describeStat } = coreRef
  return describeStat(stat)
}

const coreRef = await import('../src/core.js')

test('exitFor 与 exitInstruction 对同一平台给出一致文本', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const lang of LANGS) {
      assert.equal(exitInstruction(platform, lang), exitFor(platform, translator(lang)))
    }
  }
})
