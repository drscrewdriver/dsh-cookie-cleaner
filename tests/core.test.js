/**
 * core.js 的无 DB 单测：时间换算、路径候选、语句构造与注入面。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTH_COOKIE_PREFIX, buildDeleteStatement, candidateCookieDbs, exitInstruction, formatChromiumTimestamp } from '../src/core.js'

const EPOCH_OFFSET = 11_644_473_600_000_000
const PRODUCT_DIR_COUNT = 3

test('formatChromiumTimestamp 把 chromium 微秒换成可读 UTC', () => {
  const iso = '2026-11-04T00:00:00.000Z'
  const microseconds = Date.parse(iso) * 1000 + EPOCH_OFFSET
  assert.equal(formatChromiumTimestamp(microseconds), '2026-11-04 00:00 UTC')
})

test('formatChromiumTimestamp 对 0/负数/BigInt/超大整数都不炸', () => {
  assert.equal(formatChromiumTimestamp(0), 'session / never')
  assert.equal(formatChromiumTimestamp(-5), 'session / never')
  assert.equal(formatChromiumTimestamp(BigInt(Date.parse('2026-01-01T00:00:00.000Z') * 1000 + EPOCH_OFFSET)), '2026-01-01 00:00 UTC')
  // 真实 Chromium 时间戳（~1.34e16 微秒）超出 2^53，必须走 BigInt
  assert.equal(formatChromiumTimestamp(13_438_387_633_175_000n), '2026-11-05 21:27 UTC')
})

test('candidateCookieDbs：win32 走 APPDATA，且 Network/Cookies 优先于根下 Cookies', () => {
  const list = candidateCookieDbs('', 'win32', { APPDATA: 'C:\\Roaming' })
  assert.ok(list.length >= 4)
  assert.equal(list[0], 'C:\\Roaming\\@deepseek-ai\\dsh-desktop\\Network\\Cookies')
  assert.equal(list[1], 'C:\\Roaming\\@deepseek-ai\\dsh-desktop\\Cookies')
})

test('candidateCookieDbs：显式 userDataRoot 就只用这个根，不掺平台默认目录；linux 走 XDG', () => {
  const win = candidateCookieDbs('D:\\Custom\\UserData', 'win32', { APPDATA: 'C:\\Roaming' })
  assert.deepEqual(win, [
    'D:\\Custom\\UserData\\Network\\Cookies',
    'D:\\Custom\\UserData\\Cookies',
  ], '给定根时必须隔离，否则单测/多实例会误碰真库')
  const linux = candidateCookieDbs('', 'linux', { XDG_CONFIG_HOME: '/home/u/cfg' })
  assert.equal(linux[0], '/home/u/cfg/@deepseek-ai/dsh-desktop/Network/Cookies')
})

test('candidateCookieDbs：同一路径不重复出现', () => {
  const list = candidateCookieDbs('C:\\Roaming\\@deepseek-ai\\dsh-desktop', 'win32', { APPDATA: 'C:\\Roaming' })
  assert.equal(new Set(list).size, list.length)
})

test('buildDeleteStatement 默认档只按 host_key 白名单 + dsh-auth 前缀删', () => {
  const { sql, values } = buildDeleteStatement({})
  assert.equal(
    sql,
    "DELETE FROM cookies WHERE host_key IN ('127.0.0.1', 'localhost', '[::1]') AND name LIKE ?",
  )
  assert.deepEqual(values, [`${AUTH_COOKIE_PREFIX}%`])
  assert.ok(!sql.includes(';'), '语句里不得出现分号（多语句注入面）')
})

test('buildDeleteStatement 保守档把时间戳作为 BigInt 绑定参数而非字符串拼接', () => {
  const { sql, values } = buildDeleteStatement({ expiredOnly: true })
  assert.match(sql, /expires_utc > 0 AND expires_utc <= \?$/)
  assert.equal(values.length, 2)
  assert.equal(typeof values[1], 'bigint', '微秒时间戳超 2^53，不能用 Number 绑定')
  assert.ok(values[1] > 0n)
})

test('candidateCookieDbs：macOS 走 Library/Application Support，不掺 APPDATA/XDG', () => {
  const list = candidateCookieDbs('', 'darwin', { APPDATA: 'C:\\Roaming', XDG_CONFIG_HOME: '/home/u/cfg', HOME: '/Users/tester' })
  assert.equal(list[0], '/Users/tester/Library/Application Support/@deepseek-ai/dsh-desktop/Network/Cookies')
  assert.ok(!list.some((p) => p.includes('Roaming') || p.includes('cfg')))
  assert.equal(list.length, PRODUCT_DIR_COUNT * 2, '每个候选目录只出 Network/ 与根下两条')
})

test('candidateCookieDbs：linux 尊重 HOME，XDG 缺时回退 ~/.config', () => {
  const withXdg = candidateCookieDbs('', 'linux', { XDG_CONFIG_HOME: '/home/u/cfg', HOME: '/home/u' })
  assert.equal(withXdg[0], '/home/u/cfg/@deepseek-ai/dsh-desktop/Network/Cookies')
  const bare = candidateCookieDbs('', 'linux', { HOME: '/home/u' })
  assert.equal(bare[0], '/home/u/.config/@deepseek-ai/dsh-desktop/Network/Cookies')
})

test('candidateCookieDbs：三平台分隔符各自正确（在 Windows 上跑也不会把 posix 路径写成反斜杠）', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const list = candidateCookieDbs('/tmp/UD', platform, { HOME: '/tmp/u' })
    for (const p of list) {
      if (platform === 'win32') assert.ok(!p.startsWith('/'), 'win32 不应给 posix 路径')
      else assert.ok(!p.includes('\\'), `${platform} 不应混进反斜杠：${p}`)
    }
  }
})

test('candidateCookieDbs：DSH_COOKIE_DB 给的是库文件本身，也能推出根目录', () => {
  const list = candidateCookieDbs('', 'linux', { HOME: '/home/u', DSH_COOKIE_DB: '/opt/dsh/Network/Cookies' })
  assert.equal(list[0], '/opt/dsh/Network/Cookies')
})

test('exitInstruction：三平台文案不同，托盘字样只会出现在 win32', () => {
  assert.match(exitInstruction('win32'), /托盘/)
  assert.match(exitInstruction('darwin'), /Cmd\+Q|Quit/)
  assert.ok(!exitInstruction('darwin').includes('托盘'))
  assert.match(exitInstruction('linux'), /主窗口|进程/)
  assert.ok(!exitInstruction('linux').includes('托盘'))
  assert.ok(!exitInstruction('linux').includes('Cmd+Q'))
})

test('buildDeleteStatement 拒绝可疑的 host_key / 前缀', () => {
  assert.throws(() => buildDeleteStatement({ hostKeys: ["127.0.0.1' OR '1" ] }), /非法 host_key/)
  assert.throws(() => buildDeleteStatement({ prefix: 'dsh-auth%;--' }), /非法 cookie 名前缀/)
})
