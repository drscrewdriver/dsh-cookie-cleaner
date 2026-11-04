/**
 * client 半装载契约测试。
 *
 * 钉的是「宿主会不会加载这个 bundle」的四条硬条件（全部有源码依据）：
 * - `dsh.client.platform` 必须是 'web'，否则扫描直接跳过这一行
 *   （`client/modules/src/index.ts:841`）；
 * - `exports['./client']` 必须存在，否则宿主抛
 *   `declares dsh.client but exports no "./client" bundle`（同文件 :846-848）；
 * - bundle 注册的 id 必须 = **npm 包名**（图按 `graphRow(packageName,…)` 建，:1040）；
 * - 产物在 files 里，否则装机的包里根本没有 lib/client.js（stale-build 的另一半）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

test('dsh.client 声明齐备：platform=web + exports["./client"] + files 含 lib/', () => {
  assert.equal(pkg.dsh.client.platform, 'web', 'platform 不是 web 时宿主扫不到这一行')
  assert.equal(pkg.exports['./client'], './lib/client.js', '缺 ./client 导出会让宿主直接抛错')
  assert.ok(pkg.files.includes('lib'), 'files 不含 lib → 装机包里没有 bundle')
})

test('client 半只 inject 三代都存在的服务（代际互斥服务不得进插件级 inject）', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'client', 'index.ts'), 'utf8')
  const listed = source.match(/export const inject = \[([^\]]*)\]/)
  assert.ok(listed, 'client 半必须导出 inject')
  const deps = listed[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
  assert.deepEqual(deps, ['slots', 'locale'], '只允许 slots+locale；configForms/settingsScope 属代际互斥面')
})

test('构建产物：注册 id = 包名，react 走 external（不得内联第二份 React）', () => {
  const bundle = path.join(ROOT, 'lib', 'client.js')
  assert.ok(fs.existsSync(bundle), 'lib/client.js 不存在——先跑 npm run build')
  const code = fs.readFileSync(bundle, 'utf8')
  assert.match(code, /^window\.__ModuleLoader__\.load\(\{/, 'banner 必须是模块加载器注册形态')
  assert.ok(code.includes(`id: ${JSON.stringify(pkg.name)}`), `注册 id 必须是包名 ${pkg.name}`)
  assert.ok(/require\("react"\)/.test(code), 'react 必须以 external 形式引用')
  assert.ok(!code.includes('__SECRET_INTERNALS'), '绝不能把 React 实现打进 bundle')
  assert.ok(code.includes('exports.apply = apply'), '必须导出 apply')
  assert.ok(code.includes('exports.inject = inject'), '必须导出 inject')
})

test('席位参数匹配槽形态：keyed 给 key、list 给 id（钉住真机报过的错）', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'client', 'index.ts'), 'utf8')
  /** 每个席位名 → 它在本宿主上的形态（`ui-slots`：keyed 必给 key，list 必给 id）。 */
  const seats = { 'settings.section': 'id', 'plugins.bundle.config': 'key' }
  for (const [seat, required] of Object.entries(seats)) {
    const block = source.match(new RegExp(`name: '${seat}'([\\s\\S]{0,220}?)\\}, PatchCard`))
    assert.ok(block, `找不到 ${seat} 的注册块`)
    assert.ok(new RegExp(`\\b${required}:`).test(block[1]), `${seat} 是 ${required === 'key' ? 'keyed' : 'list'} 槽，必须传 ${required}（否则运行时 throw）`)
  }
})

test('卡片必须把 finding.params 插进文案（真机看到过 `{current}` 直接给用户看）', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'client', 'card.tsx'), 'utf8')
  assert.ok(/render\(t\(`p\.\$\{finding\.code\}`\),\s*finding\.params/.test(source), '判定码文案未经 params 插值')
  // 产物层再钉一次：渲染后的 bundle 里得带上插值函数对 finding.params 的使用
  const code = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(code, /finding\.params/, '插值逻辑没进 bundle')
})

// 端口面板契约：输入框不预填具体默认值（用户口径“也不固定 34567 吧”），
// 且只有用户真的填了合法值才允许点「应用端口」。
test('端口输入框不预填默认值，且未填时按钮禁用', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'client', 'card.tsx'), 'utf8')
  // useState 初值必须是空串，不能是任何端口常量
  assert.match(source, /useState\(''\)/, 'portInput 初值为空串')
  assert.doesNotMatch(source, /useState\(\d+\)/, '不得用数字初始化端口输入框')
  // 禁用条件里要同时要求 offline 不成立 + 端口合法 + webserver 行不被硬闸
  assert.match(source, /const canPort = offline !== true && portValid && web\?\.blocked !== true/, 'canPort 判定缺失')
  assert.match(source, /button\('port', !canPort\)/, '端口按钮必须以 !canPort 为禁用')
  // 端口热生效会踢下线旧端口页面：卡片必须常驻警告（不能只在点完那一瞬出现）
  assert.match(source, /t\('x\.portSwitchWarn'\)/, '缺常驻端口切换警告')
  const code = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(code, /portSwitchWarn|立即生效|in effect immediately/, '警告词没进 bundle')
})

test('端口写入只改表达式不写字面量（写进去的必须是 __jsExpr 形态）', () => {
  // 这条由 patch-model 的 nextPortConfig 保证；此处只测契约串不串：
  // card 只发 { port }，具体写不写、写什么形态全在守卫，卡片不自己拼表达式。
  const source = fs.readFileSync(path.join(ROOT, 'src', 'client', 'card.tsx'), 'utf8')
  assert.match(source, /postJson<ActionView>\(routes\.port, \{ port: Number\(portInput\) \}\)/, '卡片只发 port 一个参数')
  assert.doesNotMatch(source, /__jsExpr/, '卡片不自己拼表达式')
})

// 真机实拍看到的呈现缺陷：修复前根本没有覆盖行（快照里无旧值）时，卡片把“修复前”填成了 `?`，
// 等于把“无据”伪装成一个具体值。无据必须说无据。
test('审计行不得把「无旧值」渲染成 "?"，要改说「此前无覆盖行」', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'client', 'card.tsx'), 'utf8')
  assert.match(source, /beforeDays === undefined \|\| state\.lastFix\.beforeDays === null/, '缺旧值必须走 auditLineNew 分支')
  assert.doesNotMatch(source, /before: state\.lastFix\.beforeDays \?\? '\?'/, '不许再把 undefined 洗成 "?"')
  const code = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(code, /x\.auditLineNew/, '新词没进 bundle（分支没被编译进去）')
})

// 用户口径（2026-11-04）：“结构无差异时只需要说注入正常”。绿态还在逐行刷「结构健康」
// 就是把一个判定拆成两行噪声；逐行渲染必须挂在非 ok 分支上。
test('档位 ok 时卡片只说「注入正常」，不逐行刷档位', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'client', 'card.tsx'), 'utf8')
  assert.match(source, /state\?\.level === 'ok'/, '缺 ok 分支')
  assert.match(source, /x\.injectOk/, '肯定结论没取词')
  const okBranch = source.slice(source.indexOf("state?.level === 'ok'"), source.indexOf('note.webserver'))
  assert.ok(/: \(state\?\.rows \?\? \[\]\)\.map\(/.test(okBranch), '逐行渲染必须只在非 ok 分支')
  const code = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(code, /x\.injectOk|注入正常|injected as written/, '新词没进 bundle')
})

test('界面文案不留死键（定义了没人引用 = 漏渲染，插件规范里的静态检查项）', () => {
  const sources = ['card.tsx', 'index.ts'].map((f) => fs.readFileSync(path.join(ROOT, 'src', 'client', f), 'utf8')).join('\n')
  const locales = fs.readFileSync(path.join(ROOT, 'src', 'client', 'locales.ts'), 'utf8')
  const keys = [...locales.matchAll(/^ {2}'([\w.]+)': t\(/gm)].map((m) => m[1])
  assert.ok(keys.length >= 20, `只抓到 ${String(keys.length)} 个键，解析方式估错了`)
  // 这些前缀在卡片里是动态拼的（t(`level.${x}`) / t(`p.${code}`) / t(`action.${a}`) / t('x.'+k)）
  const dynamic = ['level.', 'action.', 'p.', 'x.']
  const dead = keys.filter((key) => !dynamic.some((prefix) => key.startsWith(prefix)) && !sources.includes(`'${key}'`))
  assert.deepEqual(dead, [], '有界面键定义了却没人渲染')
})

test('构建产物带全 9 语语言码与判定码文案（卡片本地渲染所需的表都在）', () => {
  const code = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  // 字典是在源码里用 Object.fromEntries 压平的，所以不能找 `zh:` 字面量；
  // 能确定存在的是语言码本身（PATCH_LANGS）与被压进表的文案。
  for (const lang of ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'it', 'ru', 'es']) {
    assert.ok(code.includes(`"${lang}"`) || code.includes(`'${lang}'`), `bundle 里找不到语言码 ${lang}`)
  }
  // chrome 与判定码共用同一份渲染：卡片文案必须随 bundle 出去，不能等宿主回文本
  assert.match(code, /浅赋值|整块替换/, '判定码文案没进 bundle → 卡片会只能显示 code')
  assert.match(code, /Cookie 清理器|Cookie Cleaner/)
})
