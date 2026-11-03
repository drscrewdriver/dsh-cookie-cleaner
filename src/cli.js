#!/usr/bin/env node
/**
 * dsh-cookie-cleaner — 独立清理脚本（可在 npm 全局/任意 shell 下直接执行）。
 *
 * 为什么独立成脚本：cookie 库在客户端运行期间被 Chromium 独占（实测连只读打开
 * 都会失败），所以清理只能发生在「客户端已完全退出」的时刻——那时宿主插件
 * 根本不存在，执行体必须是这个包里的脚本。
 *
 * 包是 ESM（宿主装载与 npm bin 都走 ESM），core 只有一份实现，两边共用。
 */
import path from 'node:path'
import * as core from './core.js'

const USAGE = `dsh-cookie-cleaner — 清理 DSH 客户端留在 cookie 库里的本地登录凭据（dsh-auth-*）

用法（务必先完全退出 DSH 客户端：托盘 → 退出，进程列表里不再有 DeepSeek Harness）：
  dsh-cookie-cleaner                  查看现状：库在哪、有多少条 dsh-auth-*、多少已过期
  dsh-cookie-cleaner --clean          删除回环域(127.0.0.1/localhost/[::1])下全部 dsh-auth-*
  dsh-cookie-cleaner --clean --expired-only   只删已过期的（保守档）
  dsh-cookie-cleaner --clean --dry-run        只看会删几条，不写盘
  dsh-cookie-cleaner --db=<完整路径>          手动指定 cookie 库

可选：--no-backup 不产出 .bak 副本；--no-vacuum 不做 VACUUM 收缩
退出码：0 成功；1 失败（库被占用/没找到/参数非法）
`

function parseArgs(argv) {
  const options = { clean: false, expiredOnly: false, dryRun: false, noBackup: false, noVacuum: false, db: '', help: false }
  for (const arg of argv) {
    if (arg === '--clean') options.clean = true
    else if (arg === '--expired-only') options.expiredOnly = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--no-backup') options.noBackup = true
    else if (arg === '--no-vacuum') options.noVacuum = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--db=')) options.db = arg.slice('--db='.length)
    else {
      process.stderr.write(`未知参数：${arg}\n\n${USAGE}`)
      process.exitCode = 1
      return undefined
    }
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options === undefined) return
  if (options.help) {
    process.stdout.write(USAGE)
    return
  }
  const explicitPath = options.db ? path.resolve(options.db) : ''
  const env = process.env
  try {
    if (!options.clean) {
      const stat = core.statCookies({ explicitPath, env })
      process.stdout.write(core.describeStat(stat) + '\n')
      if (stat.verdict === 'warn' && stat.reason !== 'busy') {
        process.stdout.write('下一步：完全退出 DSH 客户端后执行 `dsh-cookie-cleaner --clean`（默认会连未过期的一起删，不影响登录，见 README）。\n')
      } else if (stat.reason === 'busy') {
        process.stdout.write('下一步：完全退出 DSH 客户端后重跑本命令。\n')
      }
      process.exitCode = stat.reason === 'busy' || stat.verdict === 'skipped' ? 1 : 0
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
      process.stdout.write(`[dry-run] 将删除 ${result.wouldDelete} 条：${result.path}\n未写盘。去掉 --dry-run 即可执行。\n`)
      return
    }
    process.stdout.write(
      `已删除 ${result.deleted} 条 dsh-auth-*（${result.expiredOnly ? '仅已过期' : '全部'}）\n` +
      `  库：${result.path}  ${result.beforeBytes} B → ${result.afterBytes} B\n` +
      (result.backup ? `  备份：${result.backup}\n` : '  备份：已按 --no-backup 跳过\n') +
      '  账号凭据、会话、插件配置均未触碰；下次启动会重新换发本地 cookie。\n',
    )
  } catch (e) {
    const busy = e && e.code === 'cookie-busy'
    process.stderr.write((busy ? '' : '清理失败：') + (e && e.message ? e.message : String(e)) + '\n')
    process.exitCode = 1
  }
}

main()
