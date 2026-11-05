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
import { patchText } from './locales-patch.js'

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
 * cookie 实时读数的一句（面板/命令面/CLI 共用）。
 * 没折算结果就返回 undefined —— 绝不能拿“没读到”编一个 0%。
 * 借句柄快照走 `cookieLiveSnapshot`：数字是真的，但不是实时，说成实时就是谎报。
 * @param {{authCookies?:number,totalCookies?:number,header?:object,snapshot?:boolean}} [stat]
 * @param {string} [lang]
 */
export function cookieLiveText(stat, lang) {
  if (stat === undefined || stat.header === undefined) return undefined
  return patchText('text', stat.snapshot === true ? 'cookieLiveSnapshot' : 'cookieLive', lang ?? activeLang(), {
    count: String(stat.authCookies ?? 0),
    total: String(stat.totalCookies ?? 0),
    bytes: String(stat.header.bytes),
    max: String(stat.header.maxHeaderBytes),
    pct: String(stat.header.pct),
    remaining: String(stat.header.remaining),
  })
}

/**
 * 读不到的分档文案。三者不能共用一句：把“路径没找到/权限不够”说成“被 Chromium 占”是误引导。
 * @param {string} [reason] statCookies 的 reason
 * @param {string} [lang]
 */
export function cookieUnreadableText(reason, lang) {
  const key = reason === 'missing' ? 'cookieMissing' : reason === 'permission' ? 'cookiePermission' : 'cookieBusy'
  return patchText('text', key, lang ?? activeLang())
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
  // 占用折算与面板/命令面共用同一个 `cookieLive`（同一张 9 语表），两边不得各自拼一套句式。
  const liveLine = cookieLiveText(stat, lang)
  if (stat.verdict === 'ok') {
    lines.push(t('ok'))
    if (liveLine !== undefined) lines.push(liveLine)
    return lines.join('\n')
  }
  lines.push(t('found', { count: stat.authCookies, expired: stat.authExpired, live: stat.authLive }))
  lines.push(t('span', { oldest: stat.oldestExpiry, newest: stat.newestExpiry }))
  lines.push(t('hostLine') + stat.byHost.map((row) => `${row.hostKey}×${row.count}`).join(', '))
  if (liveLine !== undefined) lines.push(liveLine)
  lines.push(t('note'))

  const flag = cfg.expiredOnly === true ? ' --expired-only' : ''
  lines.push(mode === 'status' ? t('nextStatus', { exit }) : t('nextClean', { exit }))
  lines.push(`  ${directRunCommand()} --clean${flag}`)
  lines.push(t('cleanFooter'))
  return lines.join('\n')
}

const VERDICT_KEY = Object.freeze({ ok: 'vOk', warn: 'vWarn', fail: 'vFail', skipped: 'vSkipped' })

/**
 * 组装 patch 体检结果（命令面与面板共用同一份渲染，保证「按按钮」与「敲命令」不同案）。
 * @param {object} result patch-guard check/plan 的返回
 * @param {{lang?:string, platform?:string, outcome?:object, withPlan?:boolean}} [cfg]
 */
export function patchReportText(result, cfg = {}) {
  if (cfg.lang) setLang(cfg.lang)
  const lang = cfg.lang ?? activeLang()
  const L = (key, params) => patchText('text', key, lang, params)
  const C = (code, params) => patchText('code', code, lang, params)
  const lines = []

  if (result.reason === 'no-config-editor') {
    lines.push(L('title'))
    lines.push(L('noService'))
    return lines.join('\n')
  }

  // 无据档单独渲染：不能把「profile 不存在」混进「有偏差」的叙事里（也不给 nextFix 这种误导下一步）。
  if (result.reason === 'missing-profile') {
    lines.push(`${L('title')} — ${L('vSkipped')}`)
    if (result.documentPath) lines.push(result.documentPath)
    lines.push(L('missingProfile'))
    return lines.join('\n')
  }

  lines.push(`${L('title')} — ${L(VERDICT_KEY[result.level] ?? 'vSkipped')}`)
  if (result.documentPath) lines.push(result.documentPath)
  if (result.offline === true) lines.push(L('offlineNote'))

  const rows = result.rows ?? []
  if (result.level === 'ok') {
    // 结构无差异：一句话给肯定结论，不逐行刷「结构健康」（真机口径：用户要的是「注入正常」这个判定）。
    lines.push(`\u2713 ${L('injectOk')}`)
  }
  else {
    for (const row of rows) {
      const label = row.rowId === 'connection' ? 'rowConnection' : 'rowWebserver'
      lines.push(`\u25aa ${L(label)}: ${L(VERDICT_KEY[row.level] ?? 'vSkipped')}`)
      for (const finding of row.findings ?? []) lines.push(`   \u00b7 ${C(finding.code, finding.params)}`)
    }
  }

  if (result.blocks !== undefined && result.blocks.length > 0) {
    for (const block of result.blocks) {
      lines.push('')
      lines.push(L('planFor', { file: result.documentPath ?? 'cordis.patch.yml' }))
      lines.push(block.block)
      // 表达式被抄成字面量不在体检里刷屏，但处方里必须说清：哪些键原本会跟随上游、怎么拿回跟随形态。
      if ((block.exprFrozen ?? []).length > 0) {
        lines.push('')
        lines.push(C('P9', { rowId: block.rowId, keys: block.exprFrozen }))
        lines.push(L('exprFrozenHint'))
      }
    }
  }

  if ((result.rows ?? []).some((row) => row.rowId === 'webserver' && (row.findings ?? []).length > 0)) {
    lines.push('')
    lines.push(L('webserverNote'))
  }
  const conn = (result.rows ?? []).find((row) => row.rowId === 'connection')
  if (conn?.actionable === true && cfg.outcome === undefined) {
    lines.push('')
    lines.push(L('nextFix'))
  }
  // cookie 读数与面板同构：同一个折算函数出同一句话。
  if (result.cookie !== undefined) {
    const c = result.cookie
    const readable = c.verdict !== 'skipped' && c.reason !== 'busy' && c.reason !== 'permission'
    lines.push('')
    if (!readable) lines.push(cookieUnreadableText(c.reason, lang))
    else {
      const live = cookieLiveText(c, lang)
      lines.push(live ?? `${String(c.authCookies ?? '?')} dsh-auth-* / ${String(c.totalCookies ?? '?')} total`)
    }
  }
  if (cfg.outcome !== undefined) lines.push('', patchOutcomeText(cfg.outcome, { lang }))
  return lines.join('\n')
}

/** 修复/回滚结果的固定句式（kind 来自 patch-guard，不在此处二次判定）。 */
export function patchOutcomeText(outcome, cfg = {}) {
  const lang = cfg.lang ?? activeLang()
  const L = (key, params) => patchText('text', key, lang, params)
  switch (outcome.kind) {
    case 'fixed': return L('fixed', { changed: (outcome.changed ?? []).join(', ') })
      + (outcome.retried === true ? ` (${L('vWarn')}: P12)` : '')
    case 'noop': return L('noop')
    case 'blocked': return L('blocked', { codes: (outcome.codes ?? []).join(', ') })
    case 'failed': return L('failed', { message: outcome.message ?? 'unknown' })
    case 'unverified': return L('failed', { message: `effective=${String(outcome.effective)}` })
    case 'reverted': return L('reverted', { changed: (outcome.changed ?? []).join(', ') })
      + ((outcome.rows ?? []).length > 1 ? ` (${(outcome.rows ?? []).join(', ')})` : '')
      + ((outcome.failed ?? []).length > 0 ? ` (${L('failed', { message: (outcome.failed ?? []).map((f) => f.rowId).join(', ') })})` : '')
    // 端口：写的是什么表达式、监听现在到底在哪个端口，全部回传真实数据（不拿“点了”当“改好了”）。
    case 'port-applied': {
      const lines = [L('portApplied', { expr: outcome.expr ?? String(outcome.port), port: outcome.port })]
      if (outcome.hotApplied === true) lines.push(L('portHot'))
      else if (outcome.hotApplied === false) lines.push(L('portRestart'))
      else lines.push(L('portUnknown'))
      // 无论哪档，端口一旦生效旧地址就不可用：补一句同步提醒（热生效时尤其关键）。
      lines.push(L('portSwitchWarn'))
      return lines.join('\n') + (outcome.retried === true ? ` (${L('vWarn')}: P12)` : '')
    }
    case 'port-busy': return L('portBusy', { port: outcome.port })
    case 'invalid-port': return L('portInvalid', { minimum: outcome.minimum, maximum: outcome.maximum, got: String(outcome.got) })
    case 'no-snapshot': return L('noSnapshot')
    case 'no-editor': return L('noService')
    default: return L('failed', { message: outcome.kind ?? 'unknown' })
  }
}
