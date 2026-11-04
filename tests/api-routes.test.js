/**
 * 桥路由测试：注册形态、POST-only、参数回落、以及「两半 URL 同串」的钉。
 * 面板与宿主各持一份路由派生式，不钉住就必然漂移（漂了表现为卡片永远 404）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { NS, bridgeRoutesFor, registerPatchRoutes } from '../src/api-routes.js'

const ROOT = path.resolve(import.meta.dirname, '..')

/** 假 webServer：只记录注册与调用。 */
function fakeServer() {
  const routes = new Map()
  return {
    routes,
    register(route) { routes.set(route.path, route); return () => routes.delete(route.path) },
  }
}

function fakeReq(method, body) {
  const listeners = {}
  return {
    method,
    on(event, cb) { (listeners[event] ??= []).push(cb) },
    emit(event, arg) { for (const cb of listeners[event] ?? []) cb(arg) },
    start() {
      if (body !== undefined) this.emit('data', Buffer.from(JSON.stringify(body)))
      this.emit('end')
    },
  }
}

function fakeRes() {
  const out = { code: 0, body: undefined, headers: undefined }
  return {
    out,
    writeHead(code, headers) { out.code = code; out.headers = headers },
    end(body) { out.body = body },
  }
}

/** 跑一跳并等异步链落定。 */
async function call(server, path_, method, body) {
  const route = server.routes.get(path_)
  assert.ok(route, `路由未注册：${path_}`)
  const req = fakeReq(method, body)
  const res = fakeRes()
  route.handler(req, res)
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  req.start()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  return { code: res.out.code, json: res.out.body === undefined ? undefined : JSON.parse(res.out.body) }
}

const GUARD = {
  check: (options) => ({ level: 'ok', echo: options }),
  fix: async (options) => ({ kind: 'fixed', echo: options }),
  applyPort: async (options) => ({ kind: 'port-applied', echo: options }),
  revert: async () => ({ kind: 'reverted' }),
}

test('四条路由都注册为 exact，NS 等于 npm 包名', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(NS, pkg.name, 'ns 必须与包名同串（卡 id / settings ns / 桥路径三处一致）')
  const server = fakeServer()
  const offs = registerPatchRoutes(server, GUARD, { targetDays: 1, guardMode: 'literal' })
  assert.equal(offs.length, 4)
  assert.deepEqual([...server.routes.values()].map((r) => r.kind), ['exact', 'exact', 'exact', 'exact'])
  assert.deepEqual([...server.routes.keys()], Object.values(bridgeRoutesFor()))
})

test('GET 一律 405（写面只接 POST）', async () => {
  const server = fakeServer()
  registerPatchRoutes(server, GUARD, { targetDays: 1 })
  const res = await call(server, bridgeRoutesFor().check, 'GET')
  assert.equal(res.code, 405)
  assert.equal(res.json.code, 'method-not-allowed')
})

test('POST 正常回数据，body 参数优先于宿主默认档', async () => {
  const server = fakeServer()
  registerPatchRoutes(server, GUARD, { targetDays: 7, guardMode: 'literal' })
  const checked = await call(server, bridgeRoutesFor().check, 'POST', { targetDays: 1, guardMode: 'expression' })
  assert.equal(checked.code, 200)
  assert.equal(checked.json.ok, true)
  assert.equal(checked.json.value.echo.targetDays, 1, 'body 显式值必须赢过设置默认')
  assert.equal(checked.json.value.echo.guardMode, 'expression')

  const fixed = await call(server, bridgeRoutesFor().fix, 'POST', {})
  assert.equal(fixed.json.value.kind, 'fixed')
  assert.equal(fixed.json.value.echo.targetDays, 7, 'body 不给时回落宿主设置档')

  const reverted = await call(server, bridgeRoutesFor().revert, 'POST')
  assert.equal(reverted.json.value.kind, 'reverted')
})

// 端口不预填：body 给了就用 body 的，没给就回退到设置值（可能是 0=未设定），
// 合法/非法的取舍统一在守卫里做，路由不自己判。
test('端口路由：body.port 优先于默认档，不给则透传设置值', async () => {
  const server = fakeServer()
  registerPatchRoutes(server, GUARD, { targetDays: 1, port: 4399 })
  const explicit = await call(server, bridgeRoutesFor().port, 'POST', { port: 4300 })
  assert.equal(explicit.json.value.kind, 'port-applied')
  assert.equal(explicit.json.value.echo.port, 4300, 'body 显式端口必须赢过设置默认')

  const fallback = await call(server, bridgeRoutesFor().port, 'POST', {})
  assert.equal(fallback.json.value.echo.port, 4399, 'body 不给时回落宿主设置档')
})

test('handler 抛错不外泄成 500，返回结构化 ok:false', async () => {
  const server = fakeServer()
  registerPatchRoutes(server, { ...GUARD, check: () => { throw new Error('boom') } }, { targetDays: 1 })
  const res = await call(server, bridgeRoutesFor().check, 'POST', {})
  assert.equal(res.code, 200)
  assert.equal(res.json.ok, false)
  assert.match(res.json.message, /boom/)
})

test('webServer 缺席（headless 线）只返回空注销表，不抛', () => {
  assert.deepEqual(registerPatchRoutes(undefined, GUARD, {}), [])
  assert.deepEqual(registerPatchRoutes({ noRegister: true }, GUARD, {}), [])
})

test('两半路由同串：从 client 源码抽字面量，与宿主派生函数比对', () => {
  const clientFile = path.join(ROOT, 'src', 'client', 'routes.ts')
  assert.ok(fs.existsSync(clientFile), 'client 半必须存在（没卡就谈不上两半一致性）')
  const client = fs.readFileSync(clientFile, 'utf8')
  // client 侧必须是硬字面量（它不能 import 宿主侧模块）；从 `check: '…'` 形状里抓
  const grabbed = {}
  for (const [, key, url] of client.matchAll(/(check|fix|port|revert):\s*'([^']+)'/g)) grabbed[key] = url
  const host = bridgeRoutesFor()
  assert.deepEqual(Object.keys(grabbed).sort(), ['check', 'fix', 'port', 'revert'], 'client 侧四条路由都得是可抓取的字面量')
  for (const name of ['check', 'fix', 'port', 'revert']) {
    assert.equal(grabbed[name], host[name], `两半的 ${name} 路由不一致：client ${grabbed[name]} ≠ host ${host[name]}`)
  }
  // 包名也必须出现在两边（ns 漂移会让路由挂到另一个包名下）
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.ok(client.includes(`/api/${pkg.name}/`), 'client 路由必须挂在包名下')
})
