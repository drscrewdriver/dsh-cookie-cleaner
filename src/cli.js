#!/usr/bin/env node
/**
 * dsh-cookie-cleaner — 独立清理脚本（可在 npm 全局/任意 shell 下直接执行）。
 *
 * 为什么独立成脚本：cookie 库在客户端运行期间被 Chromium 独占（实测写入必须等退出），
 * 所以清理只能发生在「客户端已完全退出」的时刻——那时宿主插件根本不存在，
 * 执行体必须是这个包里的脚本。
 *
 * 包是 ESM（宿主装载与 npm bin 都走 ESM），core 只有一份实现，两边共用。
 * 输出语言：--lang > DSH_COOKIE_LANG/DSH_LANG > LC_ALL/LANG > 系统 locale > zh。
 */
import path from 'node:path'
import process from 'node:process'
import * as core from './core.js'
import { LANGS, detectLang, normalize, translator } from './i18n.js'

function usage() {
  return `dsh-cookie-cleaner — 清理 DSH 客户端留在 cookie 库里的本地登录凭据（dsh-auth-*）

用法（务必先${core.exitInstruction()}）：
  dsh-cookie-cleaner                        查看现状：库在哪、多少条 dsh-auth-*、多少已过期
  dsh-cookie-cleaner --clean                删除回环域(127.0.0.1/localhost/[::1])下全部 dsh-auth-*
  dsh-cookie-cleaner --clean --expired-only 保守档：只删已过期的
  dsh-cookie-cleaner --clean --dry-run      只看会删几条，不写盘
  dsh-cookie-cleaner --db=<完整路径>         手动指定 cookie 库（非默认安装/flatpak/snap 用）

库位置默认按平台惯例推导（也可用 DSH_USER_DATA / DSH_COOKIE_DB 覆盖）：
  Windows  %APPDATA%\\@deepseek-ai\\dsh-desktop\\Network\\Cookies
  macOS    ~/Library/Application Support/@deepseek-ai/dsh-desktop/Network/Cookies
  Linux    ~/.config/@deepseek-ai/dsh-desktop/Network/Cookies

其它：--no-backup 不产出 .bak 副本；--no-vacuum 不做 VACUUM 收缩；
      --lang <${LANGS.join('|')}> 指定输出语言（缺省跟随系统 locale）
退出码：0 成功；1 失败（库被占用/无权限/没找到/参数非法）
`
}

function parseArgs(argv) {
  const options = { clean: false, expiredOnly: false, dryRun: false, noBackup: false, noVacuum: false, db: '', lang: '', help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--clean') options.clean = true
    else if (arg === '--expired-only') options.expiredOnly = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--no-backup') options.noBackup = true
    else if (arg === '--no-vacuum') options.noVacuum = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--db=')) options.db = arg.slice('--db='.length)
    else if (arg === '--lang') options.lang = normalize(argv[++i] ?? '')
    else if (arg.startsWith('--lang=')) options.lang = normalize(arg.slice('--lang='.length))
    else {
      process.stderr.write(`未知参数：${arg}\n\n${usage()}`)
      process.exitCode = 1
      return undefined
    }
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options === undefined) return
  const lang = options.lang || detectLang(process.env)
  core.setLang(lang)
  if (options.help) {
    process.stdout.write(usage())
    return
  }
  const explicitPath = options.db ? path.resolve(options.db) : ''
  const env = process.env
  try {
    if (!options.clean) {
      const stat = core.statCookies({ explicitPath, env })
      process.stdout.write(core.describeStat(stat) + '\n')
      const exit = core.exitInstruction()
      if (stat.reason === 'busy') {
        process.stdout.write(nextLine('nextCliRerun', { exit }) + '\n')
      } else if (stat.reason === 'permission') {
        process.stdout.write(nextLine('nextCliPermission', {}) + '\n')
      } else if (stat.reason === 'missing') {
        // 文件不存在时提“关客户端”是误引导，直接给 --db 形式
        process.stdout.write(msg('nextCliPermission', {}) + '\n')
      } else if (stat.verdict === 'warn') {
        process.stdout.write(nextLine('nextCliClean', { exit }) + '\n')
      }
      // 退出码用黑名单：只有「真读到内容」的档位才是 0。白名单写法会把新档误归成成功。
      const okReason = stat.reason === 'has-stale-entries' || stat.reason === 'nothing-to-clean' || stat.verdict === 'ok'
      process.exitCode = okReason ? 0 : 1
      return
    }
    const result = core.cleanCookies({
      expiredOnly: options.expiredOnly,
      dryRun: options.dryRun,
      noBackup: options.noBackup,
      noVacuum: options.noVacuum,
      explicitPath,
      env,
    })
    if (result.ok === false) {
      process.stderr.write(result.message + '\n')
      process.exitCode = 1
      return
    }
    if (result.dryRun) {
      process.stdout.write(msg('dryRun', { count: result.wouldDelete, path: result.path }) + '\n' + msg('dryRunTail', {}) + '\n')
      return
    }
    const lines = [
      msg('deleted', { count: result.deleted, scope: result.expiredOnly ? msg('scopeExpired', {}) : msg('scopeAll', {}) }),
      msg('dbSize', { path: result.path, before: result.beforeBytes, after: result.afterBytes }),
    ]
    if (result.backup) {
      lines.push(msg('backup', { backup: result.backup }) + ((result.backupSidecars ?? []).length ? msg('backupWith', { sidecars: result.backupSidecars.join(', ') }) : ''))
      if ((result.skippedSidecars ?? []).length) lines.push(msg('backupWarn', { sidecars: result.skippedSidecars.join(', ') }))
    } else {
      lines.push(msg('backupSkipped', {}))
    }
    lines.push(msg('untouched', {}))
    process.stdout.write(lines.join('\n') + '\n')
  } catch (e) {
    const busy = e && (e.code === 'cookie-busy' || e.code === 'cookie-permission')
    process.stderr.write((busy ? '' : msg('cleanFailed', {})) + (e && e.message ? e.message : String(e)) + '\n')
    process.exitCode = 1
  }
}

/** 取当前语言的词条（core 内部也按同一语言出文案，保持一致）。 */
function msg(key, vars) {
  return translator(core.activeLang())(key, vars)
}
function nextLine(key, vars) {
  return msg(key, vars)
}

main()
