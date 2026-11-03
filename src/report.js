/**
 * dsh-cookie-cleaner — 播报文案层（把处置说全，避免二次求助 AI）。
 *
 * core.js 只做机械动作，这里负责「现在是什么状况 + 下一步敲哪条命令」。
 * 命令文案按平台给出：脚本随包分发（npm bin `dsh-cookie-cleaner`），
 * 未全局安装时给出 `node <包>/src/cli.js` 的直跑形态。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export * from './core.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 未经 npm 全局 link 时也能直接跑的调用形态。 */
export function directRunCommand() {
  return `node "${path.join(HERE, 'cli.js')}"`
}

/**
 * 组装 `/cookie-cleaner` 的输出。
 * @param {object} stat statCookies 结果（可能是 busy/skipped 降级形态）
 * @param {{expiredOnly?:boolean, userDataRoot?:string, mode?:'status'|'clean'}} [cfg]
 */
export function cookieCleanerCommandText(stat, cfg = {}) {
  const lines = []
  const mode = cfg.mode === 'clean' ? 'clean' : 'status'

  if (stat.verdict === 'skipped') {
    lines.push('cookie 库：未定位到。')
    lines.push(`候选路径：\n  ${(stat.candidates ?? []).join('\n  ')}`)
    lines.push('若你用的是 Web 版（浏览器直连宿主），本地没有这个库，无需清理；桌面版可用 userDataRoot 覆盖根目录。')
    return lines.join('\n')
  }

  if (stat.reason === 'busy') {
    lines.push(`cookie 库此刻读不到（客户端正在运行，被 Chromium 独占）：${stat.path}`)
    lines.push('宿主插件无法在运行期清理这个库 —— 这是操作系统的文件占用，不是本工具的限制。')
    lines.push('处置：完全退出 DSH 客户端（托盘 → 退出，确认进程列表里已无 DeepSeek Harness）后，在终端执行：')
    lines.push(`  ${directRunCommand()} --clean`)
    return lines.join('\n')
  }

  if (stat.verdict === 'error') {
    lines.push(`cookie 库读取异常：${stat.message ?? '未知错误'}`)
    return lines.join('\n')
  }

  lines.push(`cookie 库：${stat.path}（${stat.bytes} B，共 ${stat.totalCookies} 条）`)
  if (stat.verdict === 'ok') {
    lines.push('状态：ok —— 没有 dsh-auth-* 残留，无需清理。')
    return lines.join('\n')
  }
  lines.push(`状态：发现 ${stat.authCookies} 条 dsh-auth-*（已过期 ${stat.authExpired} / 未过期 ${stat.authLive}）`)
  lines.push(`过期时间跨度：${stat.oldestExpiry} ～ ${stat.newestExpiry}`)
  lines.push('host_key 分布：' + stat.byHost.map((row) => `${row.hostKey}×${row.count}`).join(', '))
  lines.push('说明：dsh-auth-* 的名字按 host:port 哈希，每换一次端口就留一条，未过期的会一直躺到 30 天到期；'
    + '它们不影响登录（主窗口用内存态凭据、鉴权只认当前端口那一条），也不涉及账号凭据/会话/插件配置。')

  const flag = cfg.expiredOnly === true ? ' --expired-only' : ''
  if (mode === 'status') {
    lines.push('下一步：完全退出 DSH 客户端后，在终端执行（先看会删几条可加 --dry-run）：')
  } else {
    lines.push('清理命令（务必先完全退出 DSH 客户端，运行期做不到）：')
  }
  lines.push(`  ${directRunCommand()} --clean${flag}`)
  lines.push('  默认档删全部 dsh-auth-*；--expired-only 只删已过期的；写盘前自动留 .bak 副本。')
  return lines.join('\n')
}
