/**
 * dsh-cookie-cleaner — 核心逻辑（纯函数面，host 半与 CLI 共用）。
 *
 * 为什么清理动作不能在插件运行期做（2026-11-04 对本机 0.2.1-rc.5 客户端实测）：
 * - Host 是 Electron 的纯 Node 模式子进程（`ELECTRON_RUN_AS_NODE=1`），拿不到
 *   `session.cookies`，只能落到磁盘上的 Chromium cookie 库；
 * - 客户端在跑时该库被 Chromium 周期性持有：Host runtime（Electron 44 / Node 24）
 *   连 `readOnly` 打开都报 `unable to open database file`，`fs.copyFileSync` 同样被拒；
 *   而系统 node 22 在相近时刻却能读。**能否打开随时间漂移，而且只报一个笼统错，
 *   所以不能拿错误码分档（POSIX 权限不足也不给 EACCES），只能自己探文件。**
 * 因此本模块把「独占写锁」当作唯一的安全闸：拿不到锁就一律拒绝，
 * 拿到锁即意味着此刻没有其它写者，删除是原子的、不会留中间态。
 *
 * 删了会不会掉登录？不会（源码依据）：
 * - 主窗口 HTTP/WS 用的是内存态 `hostCookie`（desktop `main.ts` 换发后经
 *   `forwardWebRequest` / `onBeforeSendHeaders` 注入），不经 cookie jar；
 * - `BrowserAuth.isAuthenticated` 按当前 authority 派生**唯一**名字取值
 *   （`dsh-auth-<base64url(sha256(host:port))>`），其余同名前缀条目本就永远读不到；
 * - 每次启动都会用 launch token 重新换发（`authenticateWebHost`）。
 * 账号凭据（`.credentials.yaml`）、会话、插件配置都不在这个库里。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { exitFor, translator } from './i18n.js'
import './locales-dict.js'

/** Cookie 名前缀：宿主 client-connection 生成（`COOKIE_PREFIX + sha256(authority)`）。 */
export const AUTH_COOKIE_PREFIX = 'dsh-auth-'

/** 本地回环 host_key：一个端口一条记录，历史端口会长期堆积。 */
export const LOOPBACK_HOST_KEYS = Object.freeze(['127.0.0.1', 'localhost', '[::1]'])

/** Chromium 的 `expires_utc` 是自 1601-01-01 起的微秒数。 */
const WINDOWS_EPOCH_OFFSET_MICROSECONDS = 11_644_473_600_000_000

/** 打包的 desktop 应用名（Electron 由 package.json 的 name 派生 userData 目录）。 */
const PRODUCT_DIR_NAMES = Object.freeze(['@deepseek-ai/dsh-desktop', 'DSH Desktop', 'deepseek-harness'])

/**
 * Chromium 在 POSIX 平台上用 WAL 日志（Windows 上用 rollback journal）：
 * 备份只拷主文件会丢掉 `-wal` 里尚未 checkpoint 的行，恢复时反而把库写小。
 */
const SIDECAR_SUFFIXES = Object.freeze(['-wal', '-shm', '-journal'])

/**
 * 退出客户端的人话指引（托盘只在 Windows 存在；macOS 叫 Quit）。
 * `lang` 缺省走当前激活语言（由 setLang 设定），文本按 9 语字典出。'zh' 是无探测时的底。
 */
export function exitInstruction(platform = process.platform, lang = activeLang()) {
  return exitFor(platform, translator(lang))
}

/**
 * 当前输出语言。调用方（CLI / 宿主命令）负责先探测再 setLang；
 * 没设过时默认 zh，保证行为与 0.1.0 一致（不因为探测把一个中文用户推到英文）。
 */
let lang = 'zh'
export function setLang(next) { if (typeof next === 'string' && next) lang = next; return lang }
export function activeLang() { return lang }

const require = createRequire(import.meta.url)

/** Windows epoch 下的「现在」，用于和 `expires_utc` 同量纲比较。 */
function windowsNowMicroseconds() {
  return Date.now() * 1000 + WINDOWS_EPOCH_OFFSET_MICROSECONDS
}

/** 微秒级时间戳超过 2^53，一律以 BigInt 进出（node:sqlite 的 readBigInts 语义）。 */
function toBigInt(value) {
  return typeof value === 'bigint' ? value : BigInt(Math.round(Number(value) || 0))
}

/** COUNT(*) 之类的小整数：BigInt → Number（超安全范围只可能出现在损坏库上）。 */
function toCount(value) {
  return typeof value === 'bigint' ? Number(value) : Number(value) || 0
}

/** 把 Chromium 的微秒时间戳换成可读 UTC 时间（0/非法值给出对应文案）。 */
export function formatChromiumTimestamp(value) {
  const microseconds = toBigInt(value)
  if (microseconds <= 0n) return 'session / never'
  const milliseconds = Number((microseconds - BigInt(WINDOWS_EPOCH_OFFSET_MICROSECONDS)) / 1000n)
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return 'unknown'
  return new Date(milliseconds).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

/** 候选 cookie 库路径（按平台惯例派生；桌面客户端与 Web 共用同一 userData 布局）。 */
export function candidateCookieDbs(userDataRoot = '', platform = process.platform, env = process.env) {
  // 分隔符跟随目标平台而不宿主：跨平台单测/多实例部署才不会拿到一身反斜杠的 posix 路径。
  const pathModule = platform === 'win32' ? path.win32 : path.posix
  // 显式给根 = 只要这个根（单测/多实例隔离），不得再把平台默认目录掺进来。
  const explicit = String(userDataRoot || '').trim()
  if (explicit) {
    const out = []
    for (const leaf of [pathModule.join('Network', 'Cookies'), 'Cookies']) {
      out.push(pathModule.join(explicit, leaf))
    }
    return out
  }
  const roots = []
  if (env.DSH_USER_DATA) roots.push(String(env.DSH_USER_DATA).trim())
  // home 从注入的 env 取（方便单测/多用户场景），真跑时才回退到 os.homedir()。
  const home = env.HOME || env.USERPROFILE || os.homedir()
  if (platform === 'win32') {
    if (env.APPDATA) for (const name of PRODUCT_DIR_NAMES) roots.push(pathModule.join(env.APPDATA, name))
  } else if (platform === 'darwin') {
    for (const name of PRODUCT_DIR_NAMES) roots.push(pathModule.join(home, 'Library', 'Application Support', name))
  } else {
    for (const name of PRODUCT_DIR_NAMES) roots.push(pathModule.join(env.XDG_CONFIG_HOME || pathModule.join(home, '.config'), name))
  }
  const out = []
  // DSH_COOKIE_DB 是库文件本身：直接当首选候选，不拆根重组（拆错了就永远命不中）。
  if (env.DSH_COOKIE_DB) out.push(pathModule.resolve(env.DSH_COOKIE_DB))
  for (const root of roots) {
    if (!root) continue
    // Chromium ≥88 把网络状态收敛到 <userData>/Network/，更早的版本直接放根下。
    for (const leaf of [pathModule.join('Network', 'Cookies'), 'Cookies']) {
      const file = pathModule.join(root, leaf)
      if (!out.includes(file)) out.push(file)
    }
  }
  return out
}

/** 存在性过滤：返回真实存在的候选库（带大小），一个都没有 → 空数组。 */
export function resolveCookieDbs({ userDataRoot = '', platform = process.platform, env = process.env } = {}) {
  const found = []
  for (const file of candidateCookieDbs(userDataRoot, platform, env)) {
    const bytes = sizeOf(file)
    if (bytes > 0) found.push({ path: file, bytes })
  }
  return found
}

function sizeOf(file) {
  try {
    const stat = fs.statSync(file)
    return stat.isFile() ? stat.size : 0
  } catch { return 0 }
}

/** sidecar 存在性（journal/wal 可能是 0 字节，但仍是恢复现场的一部分）。 */
function existsFile(file) {
  try { return fs.statSync(file).isFile() } catch { return false }
}

function loadSqlite(explicit) {
  if (explicit) return explicit
  try {
    // Node ≥22.5 / Electron 44（Node 24）自带；缺失时上层降级为「只给处置文案」。
    return require('node:sqlite')
  } catch (e) {
    throw new Error(`当前 Node 运行时无 node:sqlite（需要 Node ≥22.5）：${e.message}`, { cause: e })
  }
}

/**
 * 打不开时的真实归因。
 *
 * 为什么不看错误码：实测（Linux / node:sqlite）chmod 000 与权限不足都只报
 * `ERR_SQLITE_ERROR: unable to open database file`，根本不出 EACCES——按码分档会永远走不到
 * 权限档，把人误报成“客户端在跑”。所以自己探：可读性 → 属主 → 才能回到“占用”。
 * @returns {'busy'|'unreadable'|'not-owned'|'missing'}
 */
export function classifyOpenFailure(filePath) {
  let stat
  try {
    const probed = fs.statSync(filePath)
    stat = probed.isFile() ? probed : null
  } catch {
    stat = null
  }
  if (stat === null) return 'missing'
  try {
    fs.accessSync(filePath, fs.constants.R_OK)
  } catch {
    return 'unreadable'
  }
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && stat && typeof stat.uid === 'number') {
    if (stat.uid !== process.getuid()) return 'not-owned'
  }
  return 'busy'
}

/**
 * 打不开 = 库被占用、路径不对或权限不够。文案带处置指引，避免用户回头找 AI 解析。
 * 分档靠 {@link classifyOpenFailure}（不是错误码）；EPERM 等 ambiguous 码仍走占用档。
 */
export class CookieBusyError extends Error {
  constructor(filePath, cause, platform = process.platform, classify = classifyOpenFailure) {
    const t = translator(lang)
    const exit = exitFor(platform, t)
    const kind = classify(filePath)
    const key = kind === 'missing' ? 'adviseMissing' : kind === 'unreadable' ? 'advisePermission' : kind === 'not-owned' ? 'adviseOwner' : 'adviseBusy'
    super(
      t('openFailed', { path: filePath }) + '\n' + t('reason', { reason: cause && cause.message ? cause.message : String(cause) }) + '\n' + t(key, { exit }),
      { cause },
    )
    this.name = 'CookieBusyError'
    // 只有真占用才是 busy；其余三档都是「找错地方/错用户」，处置不同
    this.code = kind === 'busy' ? 'cookie-busy' : 'cookie-' + kind
    this.kind = kind
    this.path = filePath
    this.cause = cause
  }
}

/**
 * 打开数据库。`write:true` 会立刻 `BEGIN IMMEDIATE`——拿不到保留写锁即抛
 * {@link CookieBusyError}，这就是「必须关闭客户端」的机械实现。
 * 统一开 `readBigInts`：真实的 `expires_utc`（~1.34e16 微秒）超过 2^53，
 * 默认按 Number 读会直接 `ERR_OUT_OF_RANGE`。
 */
export function openDatabase(filePath, { write = false, sqlite, timeoutMs = 150, platform = process.platform, classify } = {}) {
  const { DatabaseSync } = loadSqlite(sqlite)
  if (!sizeOf(filePath)) {
    throw new CookieBusyError(filePath, new Error(translator(lang)('missingFile')), platform, classify)
  }
  const options = { timeout: timeoutMs, readBigInts: true }
  let handle
  try {
    handle = write ? new DatabaseSync(filePath, options) : new DatabaseSync(filePath, { ...options, readOnly: true })
  } catch (e) {
    // 老运行时可能不认 readBigInts：降级重试一次，仍失败才算占用/权限。
    if (!/readBigInts/.test(String(e && e.message))) throw new CookieBusyError(filePath, e, platform, classify)
    try {
      handle = write ? new DatabaseSync(filePath) : new DatabaseSync(filePath, { readOnly: true })
    } catch (e2) {
      throw new CookieBusyError(filePath, e2, platform, classify)
    }
  }
  if (write) {
    try {
      handle.exec('BEGIN IMMEDIATE')
    } catch (e) {
      try { handle.close() } catch { /* 忽略二次错误 */ }
      throw new CookieBusyError(filePath, e, platform, classify)    }
  }
  return handle
}

/** host_key 白名单 + name 前缀都过字符校验，杜绝把外部输入拼进语句。 */
function assertSafeIdentifiers(hostKeys, prefix) {
  for (const key of hostKeys) {
    if (!/^[A-Za-z0-9._:[\]-]{1,64}$/.test(key)) throw new Error(`非法 host_key：${key}`)
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(prefix)) throw new Error(`非法 cookie 名前缀：${prefix}`)
}

/**
 * 删除语句 + 绑定参数。`expiredOnly` 走参数绑定（时间戳不拼字符串），
 * 且以 BigInt 绑定——微秒时间戳超出 2^53。
 * @returns {{sql:string, values:Array<bigint|string>}}
 */
export function buildDeleteStatement({ expiredOnly = false, hostKeys = LOOPBACK_HOST_KEYS, prefix = AUTH_COOKIE_PREFIX } = {}) {
  assertSafeIdentifiers(hostKeys, prefix)
  const hosts = hostKeys.map((key) => `'${key}'`).join(', ')
  const where = `host_key IN (${hosts}) AND name LIKE ?`
  if (expiredOnly) {
    return { sql: `DELETE FROM cookies WHERE ${where} AND expires_utc > 0 AND expires_utc <= ?`, values: [`${prefix}%`, BigInt(windowsNowMicroseconds())] }
  }
  return { sql: `DELETE FROM cookies WHERE ${where}`, values: [`${prefix}%`] }
}

/** 表结构自检：不是 Chromium cookie 库就收手，绝不对未知库执行写语句。 */
function assertCookieSchema(handle) {
  const table = handle.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cookies'").get()
  if (table === undefined) throw new Error('目标库里没有 cookies 表，可能不是 Chromium cookie 库')
  const columns = new Set(handle.prepare('PRAGMA table_info(cookies)').all().map((row) => String(row.name)))
  for (const need of ['host_key', 'name', 'expires_utc']) {
    if (!columns.has(need)) throw new Error(`cookies 表缺少 ${need} 列，拒绝执行`)
  }
}

/** 只读统计。客户端在跑时可能抛 CookieBusyError → 降级成 verdict:'warn'/busy。 */
export function statCookies({ userDataRoot = '', explicitPath = '', env = process.env, sqlite, timeoutMs, platform = process.platform } = {}) {
  const candidates = explicitPath ? [{ path: explicitPath, bytes: sizeOf(explicitPath) }] : resolveCookieDbs({ userDataRoot, platform, env })
  if (candidates.length === 0) {
    return { verdict: 'skipped', reason: 'not-found', candidates: candidateCookieDbs(userDataRoot, platform, env) }
  }
  const target = candidates[0]
  let handle
  try {
    handle = openDatabase(target.path, { write: false, sqlite, timeoutMs, platform })
  } catch (e) {
    if (e instanceof CookieBusyError) {
      const reason = e.kind === 'busy' ? 'busy' : e.kind === 'missing' ? 'missing' : 'permission'
      return { verdict: 'warn', reason, ...target, candidates }
    }
    throw e
  }
  try {
    assertCookieSchema(handle)
    const total = toCount(handle.prepare('SELECT COUNT(*) AS c FROM cookies').get().c)
    const byHost = handle.prepare('SELECT host_key, COUNT(*) AS c FROM cookies GROUP BY host_key ORDER BY c DESC').all()
    const rows = handle.prepare('SELECT name, host_key, expires_utc FROM cookies WHERE name LIKE ? ORDER BY expires_utc DESC')
      .all(`${AUTH_COOKIE_PREFIX}%`)
    const now = BigInt(windowsNowMicroseconds())
    let expired = 0
    let live = 0
    for (const row of rows) {
      const microseconds = toBigInt(row.expires_utc)
      if (microseconds > 0n && microseconds <= now) expired += 1
      else live += 1
    }
    return {
      verdict: rows.length === 0 ? 'ok' : 'warn',
      reason: rows.length === 0 ? 'nothing-to-clean' : 'has-stale-entries',
      ...target,
      candidates,
      totalCookies: total,
      authCookies: rows.length,
      authExpired: expired,
      authLive: live,
      byHost: byHost.map((row) => ({ hostKey: String(row.host_key), count: toCount(row.c) })),
      newestExpiry: rows.length > 0 ? formatChromiumTimestamp(rows[0].expires_utc) : '',
      oldestExpiry: rows.length > 0 ? formatChromiumTimestamp(rows[rows.length - 1].expires_utc) : '',
    }
  } finally {
    handle.close()
  }
}

/**
 * 执行清理。默认档删掉回环域下**全部** `dsh-auth-*`（含未过期，安全性见文件头）；
 * `expiredOnly` 为保守档。写盘前先落 `.bak-<ts>`：主库副本失败即整单放弃（全有或全无），
 * sidecar（-wal/-shm/journal）拷不上只记为跳过，不拦停。
 * @param {{expiredOnly?:boolean,noBackup?:boolean,noVacuum?:boolean,dryRun?:boolean,explicitPath?:string,userDataRoot?:string,env?:object,sqlite?:object,timestamp?:() => string,platform?:string,copyFile?:(from:string,to:string)=>void}} options
 */
export function cleanCookies(options = {}) {
  const {
    expiredOnly = false, noBackup = false, noVacuum = false, dryRun = false,
    explicitPath = '', userDataRoot = '', env = process.env, sqlite,
    timestamp = () => defaultTimestamp(), platform = process.platform,
    copyFile = (from, to) => fs.copyFileSync(from, to),
  } = options
  const found = explicitPath ? [{ path: explicitPath, bytes: sizeOf(explicitPath) }] : resolveCookieDbs({ userDataRoot, platform, env })
  if (found.length === 0) {
    return {
      ok: false, code: 'not-found',
      message: `没找到 cookie 库。候选路径：\n  ${candidateCookieDbs(userDataRoot, platform, env).join('\n  ')}\n可用 --db=<完整路径> 指定。`,
    }
  }
  const target = found[0]
  const { sql, values } = buildDeleteStatement({ expiredOnly })
  const selectSql = sql.replace('DELETE FROM', 'SELECT COUNT(*) AS c FROM')
  const handle = openDatabase(target.path, { write: true, sqlite, platform })
  try {
    assertCookieSchema(handle)
    const wouldDelete = Number(handle.prepare(selectSql).get(...values).c)
    if (dryRun) {
      handle.exec('ROLLBACK')
      return { ok: true, dryRun: true, path: target.path, bytes: target.bytes, wouldDelete, sql, expiredOnly }
    }
    let backup = ''
    const backupSidecars = []
    const skippedSidecars = []
    if (!noBackup) {
      const stamp = timestamp()
      backup = `${target.path}.bak-${stamp}`
      try {
        copyFile(target.path, backup)
      } catch (e) {
        handle.exec('ROLLBACK')
        throw new Error(`备份失败，已放弃写入（未做任何修改）：${e.message}`, { cause: e })
      }
      // 连 WAL/journal 一起拷：POSIX 上未 checkpoint 的行在 -wal 里，只拷主文件是个残副本。
      // 但 sidecar 失败不能反过来拦停清理：-shm 只是可再生的一致性索引，-wal 在拿到独占写锁后
      // 已无并发写者，拷不上顶多丢失少量尚未落盘的会话 cookie，而主库副本是完整的。
      for (const suffix of SIDECAR_SUFFIXES) {
        const side = `${target.path}${suffix}`
        if (!existsFile(side)) continue
        try {
          copyFile(side, `${backup}${suffix}`)
          backupSidecars.push(suffix)
        } catch {
          skippedSidecars.push(suffix)
        }
      }
    }
    const deleted = Number(handle.prepare(sql).run(...values).changes)
    handle.exec('COMMIT')
    let afterBytes = sizeOf(target.path)
    if (!noVacuum) {
      try {
        handle.exec('VACUUM')
        afterBytes = sizeOf(target.path)
      } catch { /* VACUUM 失败不影响已提交的结果 */ }
    }
    return {
      ok: true, dryRun: false, path: target.path, beforeBytes: target.bytes, afterBytes,
      deleted, backup, backupSidecars, skippedSidecars, sql, expiredOnly,
    }
  } catch (e) {
    try { handle.exec('ROLLBACK') } catch { /* 事务已结束，忽略 */ }
    throw e
  } finally {
    handle.close()
  }
}

function defaultTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
}

/** 给 CLI / 命令共用的「现在是什么状况」一句话（把处置说全，避免二次求助）。 */
export function describeStat(stat) {
  const t = translator(lang)
  if (stat.verdict === 'skipped') return t('skipped')
  if (stat.reason === 'busy') return t('statBusy', { path: stat.path })
  if (stat.reason === 'permission') return t('statPermission', { path: stat.path })
  if (stat.reason === 'missing') return t('statMissing', { path: stat.path })
  if (stat.verdict === 'ok') return t('statClean', { path: stat.path, total: stat.totalCookies })
  return t('statFound', {
    count: stat.authCookies, expired: stat.authExpired, live: stat.authLive,
    hosts: stat.byHost.length, bytes: stat.bytes, path: stat.path,
  })
}
