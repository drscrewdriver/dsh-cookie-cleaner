/**
 * dsh-cookie-cleaner — 播报文案层（把处置说全，避免二次求助 AI）。
 *
 * core.js 只做机械动作，这里负责「现在是什么状况 + 下一步敲哪条命令」。
 * 全部文案经 i18n 字典出（9 语），路径/条数/命令保持原样不译；
 * 命令文案给出两种形态：npm bin 别名不可用时用 `node <包>/src/cli.js` 直跑。
 */
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export * from './core.js'
import { activeLang, exitInstruction, setLang } from './core.js'
import { detectLang, translator } from './i18n.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 未经 npm 全局 link 时也能直接跑的调用形态。 */
export function directRunCommand() {
  return `node "${path.join(HERE, 'cli.js')}"`
}

/** 按宿主/环境挑语言并激活；返回最终语言码。 */
export function useDetectedLang(explicit = '') {
  const lang = explicit ? String(explicit).trim() : detectLang()
  return setLang(lang)
}

/**
 * 组装 `/cookie-cleaner` 的输出。
 * @param {object} stat statCookies 结果（可能是 busy/permission/skipped 降级形态）
 * @param {{expiredOnly?:boolean, userDataRoot?:string, mode?:'status'|'clean', platform?:string, lang?:string}} [cfg]
 */
export function cookieCleanerCommandText(stat, cfg = {}) {
  if (cfg.lang) setLang(cfg.lang)
  const lang = cfg.lang ?? activeLang()
  const t = translator(lang)
  const platform = cfg.platform ?? process.platform
  const exit = exitInstruction(platform, lang)
  const lines = []
  const mode = cfg.mode === 'clean' ? 'clean' : 'status'

  if (stat.verdict === 'skipped') {
    lines.push(t('skipped'))
    lines.push(t('skippedCandidates') + '\n  ' + (stat.candidates ?? []).join('\n  '))
    lines.push(t('skippedHint'))
    return lines.join('\n')
  }

  if (stat.reason === 'permission') {
    lines.push(t('permission', { path: stat.path }))
    lines.push(t('permissionHint'))
    lines.push(`  ${directRunCommand()} --db="${stat.path ?? '<cookie db path>'}" --clean --dry-run`)
    return lines.join('\n')
  }

  if (stat.reason === 'busy') {
    lines.push(t('busy', { path: stat.path }))
    lines.push(t('busyWhy'))
    lines.push(t('nextClean', { exit }))
    lines.push(`  ${directRunCommand()} --clean`)
    return lines.join('\n')
  }

  if (stat.verdict === 'error') {
    lines.push(`${t('cleanFailed')}${stat.message ?? 'unknown'}`)
    return lines.join('\n')
  }

  lines.push(t('dbLine', { path: stat.path, bytes: stat.bytes, total: stat.totalCookies }))
  if (stat.verdict === 'ok') {
    lines.push(t('ok'))
    return lines.join('\n')
  }
  lines.push(t('found', { count: stat.authCookies, expired: stat.authExpired, live: stat.authLive }))
  lines.push(t('span', { oldest: stat.oldestExpiry, newest: stat.newestExpiry }))
  lines.push(t('hostLine') + stat.byHost.map((row) => `${row.hostKey}×${row.count}`).join(', '))
  lines.push(t('note'))

  const flag = cfg.expiredOnly === true ? ' --expired-only' : ''
  lines.push(mode === 'status' ? t('nextStatus', { exit }) : t('nextClean', { exit }))
  lines.push(`  ${directRunCommand()} --clean${flag}`)
  lines.push(t('cleanFooter'))
  return lines.join('\n')
}
