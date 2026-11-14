// 水位观测臂：只读解析 Cookie 头，且必须与 runtimeGuard 解耦。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { cookieNameOf, installCookieObserver, observeCookieHeader } from '../src/runtime-guard.js'

const NAME = cookieNameOf('http:', '127.0.0.1:3090')
const OTHER = cookieNameOf('http:', '127.0.0.1:3091')

test('observeCookieHeader 统计启动 cookie 条数与实测字节', () => {
  const header = `theme=dark; ${NAME}=abc; ${OTHER}=def`
  const got = observeCookieHeader(header)
  assert.equal(got.total, 3, '三条 cookie')
  assert.equal(got.minted, 2, '其中两条是 dsh-auth-<43 base64url> 形状')
  assert.deepEqual(got.names, [NAME, OTHER])
  assert.equal(got.headerBytes, Buffer.byteLength(header, 'utf8'))
})

test('observeCookieHeader 对空/非字符串/数组都安全', () => {
  assert.deepEqual(observeCookieHeader(undefined), { total: 0, minted: 0, names: [], headerBytes: 0 })
  assert.deepEqual(observeCookieHeader(''), { total: 0, minted: 0, names: [], headerBytes: 0 })
  const arr = observeCookieHeader([`a=1; ${NAME}=x`, `${OTHER}=y`])
  assert.equal(arr.total, 3)
  assert.equal(arr.minted, 2)
})

test('非 MINTED 形状的名字不计入启动 cookie（不越界动别人的 cookie）', () => {
  const got = observeCookieHeader('dsh-auth-short=1; dsh-auth-=2; sid=3')
  assert.equal(got.total, 3)
  assert.equal(got.minted, 0)
})

test('installCookieObserver 记录最近一次水位；无 cookie 的请求不覆盖读数', () => {
  const server = new EventEmitter()
  let clock = 1000
  const seen = []
  const arm = installCookieObserver(server, { now: () => clock += 1000, onObserve: (info) => seen.push(info) })

  server.emit('request', { headers: { cookie: `${NAME}=v` } }, {})
  assert.equal(arm.latest().minted, 1)
  assert.equal(arm.latest().total, 1)

  server.emit('request', { headers: { cookie: `a=1; ${NAME}=v; ${OTHER}=v` } }, {})
  assert.equal(arm.latest().total, 3)
  assert.equal(arm.latest().minted, 2)
  assert.equal(arm.latest().unique, 2)

  // 不带 cookie 的请求（比如健康检查）不得把水位清成 0
  server.emit('request', { headers: {} }, {})
  assert.equal(arm.latest().minted, 2, '无 cookie 请求应保持上一次读数')
  assert.equal(seen.length, 2)

  arm.dispose()
  server.emit('request', { headers: { cookie: 'x=1' } }, {})
  assert.equal(arm.latest().minted, 2, 'dispose 后不再更新')
})

test('server 缺席时降级为空臂，不抛', () => {
  const arm = installCookieObserver(undefined)
  assert.equal(arm.latest(), undefined)
  assert.doesNotThrow(() => arm.dispose())
})

test('onObserve 抛错不得影响请求（观测是旁路）', () => {
  const server = new EventEmitter()
  installCookieObserver(server, { onObserve: () => { throw new Error('boom') } })
  assert.doesNotThrow(() => server.emit('request', { headers: { cookie: `${NAME}=v` } }, {}))
})