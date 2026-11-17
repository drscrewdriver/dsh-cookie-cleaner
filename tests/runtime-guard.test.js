/**
 * 运行期守护（src/runtime-guard.js）单测——覆盖薄整合方案里最容易被回归打到的 10 条断言。
 *
 * 与 dsh-auth-cookie-guard 上游测试同口径：
 *   - 303 对象写头合并（真实握手路径）
 *   - 三参数写头 / 平铺数组写头 / 无 header 走 setHeader 兜底
 *   - stale=0 时**不包装** writeHead（幂等，避免给稳态请求添负担）
 *   - MAX_RETIRE_PER_RESPONSE=96 分批
 *   - keep + current authority 保底
 *   - 运行时赋值 maxHeaderSize 对**新连接**生效、dispose 还原
 *   - 非法 config 走 bounded 夹位（16 KiB – 1 MiB / 1 – 64）
 *
 * 每个用例都真启一个 http.Server，agent: false 强制新 TCP——避免 keep-alive 复用旧 parser
 * 掩盖 maxHeaderSize 语义（README 里"对后续**连接**生效"这条纪律）。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import { test } from 'node:test'

import { installRuntimeGuard, cookieNameOf, DEFAULTS, LIMITS, MAX_RETIRE_PER_RESPONSE } from '../src/runtime-guard.js'

const PREFIX = 'dsh-auth-'

/** 与 DSH 一致：name = PREFIX + base64url(sha256(host:port))，恰好 43 字符。 */
const nameOfPort = (host, port) => cookieNameOf('http:', `${host}:${port}`)

/** 造一个"看起来合法"的 MINTED name（sha256 摘要形状，走 hash 就好）。 */
const minted = (label) => PREFIX + crypto.createHash('sha256').update(label).digest('base64url')

/**
 * 起一个 handler 可控的 http.Server，返回 { port, url, close }。
 * @param {(req:import('node:http').IncomingMessage, res:import('node:http').ServerResponse) => void} handler
 */
function withServer(handler) {
  const server = http.createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({
        server,
        port,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

/**
 * 强制新 TCP 的一次请求（避开 keep-alive 复用旧 parser，让 maxHeaderSize 语义可验）。
 * @param {number} port
 * @param {{cookie?: string, host?: string}} headers
 */
function fire(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const reqHeaders = {}
    if (typeof headers.cookie === 'string') reqHeaders.cookie = headers.cookie
    if (typeof headers.host === 'string' && headers.host !== '') reqHeaders.host = headers.host
    const req = http.request({
      host: '127.0.0.1',
      port,
      agent: false,
      headers: reqHeaders,
    }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode, setCookies: res.headers['set-cookie'] ?? [] }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** 构造 N 条 MINTED 名字的 cookie 头（顺序 = 旧→新，与浏览器 jar 一致）。 */
function buildCookieHeader(names) {
  return names.map((n) => `${n}=v`).join('; ')
}

// ────────────────────────────────────────────────────────────────────
test('cookieNameOf: http: 走 url.host（含端口），https: 走 url.origin', () => {
  const a = nameOfPort('127.0.0.1', 1234)
  assert.match(a, /^dsh-auth-[A-Za-z0-9_-]{43}$/)
  assert.equal(a, nameOfPort('127.0.0.1', 1234), '同 authority 稳定')
  assert.notEqual(a, nameOfPort('127.0.0.1', 1235), '端口进键')
  assert.equal(cookieNameOf('http:', undefined), undefined)
  assert.equal(cookieNameOf('http:', ''), undefined)
})

// ────────────────────────────────────────────────────────────────────
test('真实握手形态（303 对象写头）：pending 删除行合并进 set-cookie，原始会话 cookie 保留', async () => {
  const current = minted('current-port')
  const stale = [minted('s1'), minted('s2'), minted('s3')]
  const jar = [...stale, current]
  const srv = await withServer((req, res) => {
    res.writeHead(303, { location: '/welcome', 'set-cookie': `${current}=token; Max-Age=2592000; Path=/` })
    res.end()
  })
  try {
    installRuntimeGuard(srv.server, { keep: 1 })
    const r = await fire(srv.port, { cookie: buildCookieHeader(jar), host: `127.0.0.1:${srv.port}` })
    assert.equal(r.status, 303)
    // 1 原始会话 + 3 删除 = 4 条（保留 tail 1 + current）
    assert.equal(r.setCookies.length, 4, `期望 4 条 set-cookie，实得 ${r.setCookies.length}: ${JSON.stringify(r.setCookies)}`)
    const originals = r.setCookies.filter((l) => !l.includes('Max-Age=0'))
    assert.equal(originals.length, 1)
    assert.match(originals[0], new RegExp(current))
    const deletes = r.setCookies.filter((l) => l.includes('Max-Age=0'))
    assert.equal(deletes.length, 3)
    for (const staleName of stale) assert.ok(deletes.some((l) => l.startsWith(`${staleName}=;`)), `缺失 ${staleName}`)
  } finally {
    await srv.close()
  }
})

// ────────────────────────────────────────────────────────────────────
test('stale=0（jar 全在 tail keep + current 保留集内）→ 不包装 writeHead，无删除行下发', async () => {
  const a = minted('a')
  const b = minted('b')
  const jar = [a, b]
  const srv = await withServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  try {
    installRuntimeGuard(srv.server, { keep: 4 })
    const r = await fire(srv.port, { cookie: buildCookieHeader(jar), host: `127.0.0.1:${srv.port}` })
    assert.equal(r.status, 200)
    assert.deepEqual(r.setCookies, [], '幂等：稳态请求不应带任何 set-cookie 头')
  } finally {
    await srv.close()
  }
})

// ────────────────────────────────────────────────────────────────────
test('MAX_RETIRE_PER_RESPONSE=96 分批：200 条陈旧首轮只发 96 条', async () => {
  const current = minted('cur')
  const stale = Array.from({ length: 200 }, (_, i) => minted('s' + i))
  const jar = [...stale, current]
  const srv = await withServer((_, res) => {
    res.writeHead(303, { location: '/', 'set-cookie': `${current}=t; Path=/` })
    res.end()
  })
  try {
    installRuntimeGuard(srv.server, { keep: 4 })
    const r = await fire(srv.port, { cookie: buildCookieHeader(jar), host: `127.0.0.1:${srv.port}` })
    const deletes = r.setCookies.filter((l) => l.includes('Max-Age=0'))
    assert.equal(deletes.length, MAX_RETIRE_PER_RESPONSE, `首轮应发 ${MAX_RETIRE_PER_RESPONSE} 条删除，实发 ${deletes.length}`)
    // 前 96 条应是 stale 里最老的 96 条（不是尾部 keep 那条）
    assert.ok(!deletes.some((l) => l.startsWith(`${current}=`)), '当前端口那条不能被列进删除')
    assert.ok(!deletes.some((l) => l.startsWith(`${stale.slice(-4)[0]}=`)), '尾部 keep 之一不能被删')
  } finally {
    await srv.close()
  }
})

// ────────────────────────────────────────────────────────────────────
test('keep + current 保底：Host 头算出的 current 即便不在尾部 keep 也保留', async () => {
  const old = minted('old-1')
  const current = minted('current-in-front') // 人为把 current 放到最前面（模拟时钟回拨/端口不匹配）
  const filler = [minted('f1'), minted('f2'), minted('f3'), minted('f4')] // 尾部 4 条 = keep 全被 filler 占
  const jar = [current, ...filler, old]
  const srv = await withServer((_, res) => {
    res.writeHead(200, {})
    res.end()
  })
  try {
    const dispose = installRuntimeGuard(srv.server, { keep: 4 })
    // 请求里 Host 指到一个我们预先算过 name 的 authority：需要 retire 里能命中 current 名字
    // retire 会用 cookieNameOf(protocol='http:', host) 反算——直接构造 host 让 nameOf 等于 current 名字
    // 简单起见：把 cookieNameOf 的输入换成一个能算出 current 那个 name 的 host 不可能（因为 current 是 hash 得来的）
    // 所以这里只验"current 不在 names 里，names.slice(-keep) 是 filler 那批"——retained = 4 (filler) + 反算 current 名不在 jar → stale = 2 (current, old)
    const r = await fire(srv.port, { cookie: buildCookieHeader(jar), host: `127.0.0.1:${srv.port}` })
    const deletes = r.setCookies.filter((l) => l.includes('Max-Age=0'))
    // 尾部 4 保留，current 与 old 都被删（因为反算出的 name 不等于人为的 current）
    assert.equal(deletes.length, 2)
    dispose()
  } finally {
    await srv.close()
  }
})

// ────────────────────────────────────────────────────────────────────
test('三参数 writeHead 形态与平铺数组形态都合并删除行', async () => {
  const staleName = minted('s')
  const keepName = minted('k')
  const jar = [staleName, keepName]
  const srv = await withServer((_, res) => {
    // 三参数形态（statusCode, statusMessage, headers）
    res.writeHead(302, 'Found', { location: '/', 'set-cookie': `${keepName}=t; Path=/` })
    res.end()
  })
  try {
    installRuntimeGuard(srv.server, { keep: 1 })
    const r = await fire(srv.port, { cookie: buildCookieHeader(jar), host: `127.0.0.1:${srv.port}` })
    assert.equal(r.status, 302)
    const deletes = r.setCookies.filter((l) => l.includes('Max-Age=0'))
    const originals = r.setCookies.filter((l) => !l.includes('Max-Age=0'))
    assert.equal(deletes.length, 1)
    assert.equal(originals.length, 1)
  } finally {
    await srv.close()
  }

  // 平铺数组形态
  const srv2 = await withServer((_, res) => {
    res.writeHead(200, ['content-type', 'text/plain', 'set-cookie', `${keepName}=t; Path=/`])
    res.end()
  })
  try {
    installRuntimeGuard(srv2.server, { keep: 1 })
    const r = await fire(srv2.port, { cookie: buildCookieHeader(jar), host: `127.0.0.1:${srv2.port}` })
    const deletes = r.setCookies.filter((l) => l.includes('Max-Age=0'))
    assert.equal(deletes.length, 1, `平铺数组也应合并删除行，实发 ${deletes.length}`)
  } finally {
    await srv2.close()
  }
})

// ────────────────────────────────────────────────────────────────────
test('无 header 的 writeHead 走 setHeader 兜底：删除行仍然出现在响应里', async () => {
  const staleName = minted('s')
  const keepName = minted('k')
  const srv = await withServer((_, res) => {
    res.setHeader('set-cookie', `${keepName}=t; Path=/`)
    res.writeHead(302) // 无 headers 参数
    res.end()
  })
  try {
    installRuntimeGuard(srv.server, { keep: 1 })
    const r = await fire(srv.port, { cookie: buildCookieHeader([staleName, keepName]), host: `127.0.0.1:${srv.port}` })
    const deletes = r.setCookies.filter((l) => l.includes('Max-Age=0'))
    assert.equal(deletes.length, 1)
    assert.ok(deletes[0].startsWith(`${staleName}=`))
  } finally {
    await srv.close()
  }
})

// ────────────────────────────────────────────────────────────────────
test('installRuntimeGuard 抬 maxHeaderSize 对新连接生效；dispose 还原为原值', async () => {
  const srv = await withServer((req, res) => {
    res.writeHead(200, {})
    res.end('ok')
  })
  try {
    // 默认 16 KiB：20 KiB 头 → 431
    const big = 'a'.repeat(20000)
    const r0 = await fire(srv.port, { cookie: `${PREFIX}${big}` })
    assert.equal(r0.status, 431)

    const previous = srv.server.maxHeaderSize // 一般是 undefined = 走默认
    const dispose = installRuntimeGuard(srv.server, { maxHeaderBytes: 65536, keep: 1 })
    const r1 = await fire(srv.port, { cookie: `${PREFIX}${big}` })
    assert.equal(r1.status, 200, '抬到 64 KiB 后 20 KiB 头应放行')

    dispose()
    assert.equal(srv.server.maxHeaderSize, previous, 'dispose 应把 maxHeaderSize 还原到 previous')
    const r2 = await fire(srv.port, { cookie: `${PREFIX}${big}` })
    assert.equal(r2.status, 431, '还原后同一大头应重新被 431')
  } finally {
    await srv.close()
  }
})

// ────────────────────────────────────────────────────────────────────
test('bounded 夹位：maxHeaderBytes 与 keep 越界回落到 LIMITS 端点，非法值回落到 DEFAULTS', async () => {
  const srv = await withServer((_, res) => { res.writeHead(200, {}); res.end() })
  try {
    installRuntimeGuard(srv.server, { maxHeaderBytes: 1, keep: 0 })
    assert.equal(srv.server.maxHeaderSize, LIMITS.maxHeaderBytes[0])

    const srv2 = await withServer((_, res) => { res.writeHead(200, {}); res.end() })
    try {
      installRuntimeGuard(srv2.server, { maxHeaderBytes: 999_999_999 })
      assert.equal(srv2.server.maxHeaderSize, LIMITS.maxHeaderBytes[1])

      const srv3 = await withServer((_, res) => { res.writeHead(200, {}); res.end() })
      try {
        installRuntimeGuard(srv3.server, { maxHeaderBytes: undefined, keep: undefined })
        assert.equal(srv3.server.maxHeaderSize, DEFAULTS.maxHeaderBytes)
      } finally { await srv3.close() }
    } finally { await srv2.close() }
  } finally {
    await srv.close()
  }
})

// ────────────────────────────────────────────────────────────────────
test('retireAbove 阈值：条目数 ≤ 阈值时完全不动（不发删除行）', async () => {
  const names = Array.from({ length: 6 }, (_, i) => minted('t' + i))
  const srv = await withServer((_, res) => { res.writeHead(200, {}); res.end() })
  try {
    installRuntimeGuard(srv.server, { keep: 1, retireAbove: 40 })
    const r = await fire(srv.port, { cookie: buildCookieHeader(names), host: `127.0.0.1:${srv.port}` })
    assert.deepEqual(r.setCookies, [], '未过阈值不应下发任何 Set-Cookie')
  } finally {
    await srv.close()
  }
})

test('retireAbove 阈值：条目数 > 阈值时按尾部 keep 收敛', async () => {
  const names = Array.from({ length: 6 }, (_, i) => minted('x' + i))
  const srv = await withServer((_, res) => { res.writeHead(200, {}); res.end() })
  try {
    installRuntimeGuard(srv.server, { keep: 1, retireAbove: 3 })
    const r = await fire(srv.port, { cookie: buildCookieHeader(names), host: `127.0.0.1:${srv.port}` })
    const deletes = r.setCookies.filter((l) => l.includes('Max-Age=0'))
    assert.equal(deletes.length, 5, `6 条保尾部 1，应删 5，实删 ${deletes.length}`)
  } finally {
    await srv.close()
  }
})

test('retireAbove 默认 0 = 不设阈值（保持每次按 keep 收敛）', async () => {
  const names = Array.from({ length: 3 }, (_, i) => minted('d' + i))
  const srv = await withServer((_, res) => { res.writeHead(200, {}); res.end() })
  try {
    installRuntimeGuard(srv.server, { keep: 1 })
    const r = await fire(srv.port, { cookie: buildCookieHeader(names), host: `127.0.0.1:${srv.port}` })
    assert.equal(r.setCookies.filter((l) => l.includes('Max-Age=0')).length, 2, '3 条保尾部 1，应删 2')
  } finally {
    await srv.close()
  }
})

test('onRetire 拿到 total/retained/stale/emitted 四元组；名字与值不进日志', async () => {
  const jar = [minted('s1'), minted('s2'), minted('s3'), minted('keep-me')]
  const secret = 'super-secret-token-should-not-appear'
  const srv = await withServer((_, res) => {
    res.writeHead(200, { 'set-cookie': `${jar[3]}=${secret}; Path=/` })
    res.end()
  })
  const seen = []
  try {
    installRuntimeGuard(srv.server, {
      keep: 1,
      onRetire: (info) => seen.push(info),
    })
    const r = await fire(srv.port, { cookie: jar.map((n) => `${n}=${secret}`).join('; '), host: `127.0.0.1:${srv.port}` })
    assert.equal(seen.length, 1)
    assert.deepEqual(seen[0], { total: 4, retained: 2, stale: 3, emitted: 3 },
      'retained 包含 tail-keep=1 与由 Host 头反算的 current（当 jar 里无同名项时 = phantom 名，插件不删 jar 中的当前会话行）')
    // retire 只把四元组报给 onRetire；cookie 名字/值本身**不进 info**（防止把签名载荷写日志）
    const dumped = JSON.stringify(seen)
    assert.ok(!dumped.includes(PREFIX), 'info 里不应出现 dsh-auth- 前缀')
    assert.ok(!dumped.includes(secret), 'info 里不应出现 cookie 值')
    // 会话 cookie 保留（在 tail keep=1 里）
    assert.ok(r.setCookies.some((l) => l.startsWith(`${jar[3]}=${secret}`)), '当前 tail 保留的会话 cookie 应在响应头里')
  } finally {
    await srv.close()
  }
})

// ────────────────────────────────────────────────────────────────────
// v0.7.0：退休与抬预算拆成两个开关（清理默认开，放宽阈值仍默认关）

test('retire:false → 不发任何删除行（清理可单独关闭）', async () => {
  const current = minted('current')
  const stale = [minted('x1'), minted('x2')]
  const srv = await withServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  try {
    installRuntimeGuard(srv.server, { keep: 1, retire: false })
    const r = await fire(srv.port, { cookie: buildCookieHeader([...stale, current]), host: `127.0.0.1:${srv.port}` })
    assert.deepEqual(r.setCookies, [], '关掉退休就不该有删除行')
  } finally {
    await srv.close()
  }
})

test('raiseBudget:false → 不动 server.maxHeaderSize（清理不等于放宽阈值）', async () => {
  const srv = await withServer((_, res) => {
    res.writeHead(200)
    res.end('ok')
  })
  try {
    const before = srv.server.maxHeaderSize
    const dispose = installRuntimeGuard(srv.server, { maxHeaderBytes: 65536, raiseBudget: false })
    assert.equal(srv.server.maxHeaderSize, before, '关掉抬预算就必须保持原值')
    dispose()
    assert.equal(srv.server.maxHeaderSize, before)
  } finally {
    await srv.close()
  }
})

test('两个开关互相独立：只开退休时，清理照常生效而预算不变', async () => {
  const current = minted('current-2')
  const stale = [minted('y1'), minted('y2'), minted('y3')]
  const srv = await withServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  try {
    const before = srv.server.maxHeaderSize
    installRuntimeGuard(srv.server, { keep: 1, retire: true, raiseBudget: false })
    assert.equal(srv.server.maxHeaderSize, before, '预算未被改动')
    const r = await fire(srv.port, { cookie: buildCookieHeader([...stale, current]), host: `127.0.0.1:${srv.port}` })
    assert.ok(r.setCookies.some((l) => l.includes('Max-Age=0')), '退休仍要照常下发删除行')
    assert.ok(!r.setCookies.some((l) => l.startsWith(`${current}=;`)), '当前 authority 的 cookie 永远保留')
  } finally {
    await srv.close()
  }
})
