/**
 * 面板卡片：体检 / 修复 / 回滚三个按钮 + P1-P12 明细。
 *
 * 三条纪律：
 * 1. 文本全部走注入进来的 `t`（宿主 locale 服务），卡片自己不留一份语言常量；
 * 2. 颜色/字号只用宿主主题令牌（`--dsw-*`），不写死色值——宿主换肤时卡片必须跟着变；
 * 3. 动作结果一律**重跑体检回显**，不信「按钮点了=改好了」：修复后档位仍偏，就如实显示。
 */
import * as React from 'react'

import { render } from './locales'
import { postJson, routes } from './routes'
import type { ActionView, CheckView, Finding, RowView } from './routes'

export interface CardProps {
  /** 当前语言的取词函数（跟着宿主 locale 走，卡片不缓存旧值）。 */
  t: (key: string) => string
}

const LEVEL_COLOR: Record<string, string> = {
  ok: 'var(--dsw-color-success, var(--dsw-color-primary))',
  warn: 'var(--dsw-color-warning)',
  fail: 'var(--dsw-color-danger)',
  skipped: 'var(--dsw-color-muted)',
}

function FindingLine({ finding, t }: { finding: Finding; t: (key: string) => string }) {
  // 宿主只回 `{code, params}`，语言由界面定；占位符必须在卡片侧填——
  // 直接显示 t('p.P1') 会把 `{current}` 这种半成品词交给用户（真机看到过）。
  return <div style={{ marginLeft: 14, fontSize: '0.9em', lineHeight: 1.5 }}>· {render(t(`p.${finding.code}`), finding.params ?? {})}</div>
}

function Row({ row, t }: { row: RowView; t: (key: string) => string }) {
  const label = row.rowId === 'connection' ? 'row.connection' : 'row.webserver'
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-label="verdict" style={{ width: 8, height: 8, borderRadius: 4, background: LEVEL_COLOR[row.level] ?? LEVEL_COLOR.skipped }} />
        <b>{t(label)}</b>
        <span style={{ color: LEVEL_COLOR[row.level] }}>{t(`level.${row.level}`)}</span>
      </div>
      {(row.findings ?? []).map((finding, index) => (
        <FindingLine key={`${finding.code}-${String(index)}`} finding={finding} t={t} />
      ))}
    </div>
  )
}

/**
 * cookie 读数行。四档不得混用一句：
 * - 普通只读打开成功 → 实时值（条数 / 百分比 / 余量），过半转告警色、达阈值转危险色；
 * - 借宿主句柄拿的快照 → 同一组数字但明说「非实时」（说成实时就是谎报）；
 * - 读得到但无折算（旧宿主半）→ 只给条数，不编造百分比；
 * - 读不到 → 按原因分档：占用 / 权限 / 没找到。把后两者说成“被 Chromium 占”是误引导。
 */
function CookieLine({ cookie, t }: { cookie?: CheckView['cookie']; t: (key: string) => string }) {
  if (cookie === undefined) return null
  const muted = { fontSize: '0.85em', color: 'var(--dsw-color-muted)' } as const
  const unreadable = cookie.verdict === 'skipped' || cookie.reason === 'busy' || cookie.reason === 'permission' || cookie.reason === 'missing'
  if (unreadable) {
    const key = cookie.reason === 'missing' ? 'x.cookieMissing' : cookie.reason === 'permission' ? 'x.cookiePermission' : 'x.cookieBusy'
    return <div style={muted}>{t(key)}</div>
  }
  const occupancy = cookie.header
  if (occupancy === undefined) {
    return <div style={muted}>{`${String(cookie.authCookies ?? '?')} dsh-auth-* / ${String(cookie.totalCookies ?? '?')} total`}</div>
  }
  const color = occupancy.over || occupancy.remaining <= 0
    ? 'var(--dsw-color-danger)'
    : occupancy.pct >= 50 ? 'var(--dsw-color-warning)' : 'var(--dsw-color-muted)'
  return (
    <div style={{ fontSize: '0.85em', color, lineHeight: 1.5 }}>
      {render(t(cookie.snapshot === true ? 'x.cookieLiveSnapshot' : 'x.cookieLive'), {
        count: String(cookie.authCookies ?? '?'),
        total: String(cookie.totalCookies ?? '?'),
        bytes: String(occupancy.bytes),
        max: String(occupancy.maxHeaderBytes),
        pct: String(occupancy.pct),
        remaining: String(occupancy.remaining),
      })}
    </div>
  )
}

export function PatchCard({ t }: CardProps): React.ReactElement {
  const [state, setState] = React.useState<CheckView | undefined>(undefined)
  const [busy, setBusy] = React.useState<'' | 'check' | 'fix' | 'revert' | 'port'>('')
  const [note, setNote] = React.useState('')
  // 端口不预填任何默认值：输入框开局为空，用户写了什么就写什么进表达式。
  const [portInput, setPortInput] = React.useState('')
  const mounted = React.useRef(true)

  React.useEffect(() => {
    mounted.current = true
    void run('check')
    return () => { mounted.current = false }
  }, [])

  async function run(action: 'check' | 'fix' | 'revert' | 'port'): Promise<void> {
    setBusy(action)
    setNote('')
    try {
      if (action === 'check') {
        const value = await postJson<CheckView>(routes.check, {})
        if (mounted.current) setState(value)
      }
      else if (action === 'port') {
        const value = await postJson<ActionView>(routes.port, { port: Number(portInput) })
        const fail = (message: string) => render(t('state.failed'), { message })
        // 结果文案全部取自 `x.*`（与宿主/CLI 同一张表），卡片不留第二份翻译。
        const outcome = value.kind === 'port-applied'
          ? `${render(t('x.portApplied'), { port: String(value.port ?? portInput), expr: value.expr ?? '' })}\n`
            + t(value.hotApplied === true ? 'x.portHot' : value.hotApplied === false ? 'x.portRestart' : 'x.portUnknown')
            + `\n${t('x.portSwitchWarn')}`
          : value.kind === 'port-busy' ? render(t('x.portBusy'), { port: String(value.port ?? portInput) })
            : value.kind === 'invalid-port' ? t('x.portInvalid')
              : value.kind === 'noop' ? t('fix.noop')
                : value.kind === 'blocked' ? render(t('fix.blocked'), { codes: value.codes ?? [] })
                  : fail(value.message ?? value.kind)
        if (!mounted.current) return
        setNote(outcome)
        const after = value.result ?? await postJson<CheckView>(routes.check, {})
        if (mounted.current) setState(after)
      }
      else {
        const path = action === 'fix' ? routes.fix : routes.revert
        const value = await postJson<ActionView>(path, {})
        const fail = (message: string) => render(t('state.failed'), { message })
        const outcome = action === 'fix'
          ? value.kind === 'fixed' ? render(t('fix.done'), { changed: value.changed ?? [] })
            : value.kind === 'noop' ? t('fix.noop')
              : value.kind === 'blocked' ? render(t('fix.blocked'), { codes: value.codes ?? [] })
                : fail(value.message ?? value.kind)
          : value.kind === 'reverted' ? render(t('revert.done'), { changed: value.changed ?? [] })
            : value.kind === 'no-snapshot' ? t('revert.none')
              : fail(value.message ?? value.kind)
        if (!mounted.current) return
        setNote(outcome)
        // 动作后一律重读，不信单次返回值
        const after = value.result ?? await postJson<CheckView>(routes.check, {})
        if (mounted.current) setState(after)
      }
    } catch (error) {
      if (mounted.current) setNote(render(t('state.failed'), { message: String((error as Error).message ?? error) }))
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  const offline = state?.reason === 'no-config-editor'
  // 启用条件 = 体检已回来 & connection 行真的可动作。
  // 曾把这句写成 `rows.some(row => row.rowId==='connection' && row.actionable !== true) !== true`：
  // actionable 为真时 some() 本身就是 false，再取反反而把按钮锁死了（真机看到）。
  const conn = state?.rows?.find((row) => row.rowId === 'connection')
  const web = state?.rows?.find((row) => row.rowId === 'webserver')
  const canFix = offline !== true && conn?.actionable === true
  const canRevert = offline !== true
  // 端口：用户真填了合法值、且 webserver 行没有“写了也没用”的硬闸（P2/P6/P10/P11）才能点。
  const portNumber = Number(portInput)
  const portValid = /^\d+$/.test(portInput.trim()) && Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535
  const canPort = offline !== true && portValid && web?.blocked !== true
  const button = (action: 'check' | 'fix' | 'revert' | 'port', disabled = false) => (
    <button
      type="button"
      disabled={busy !== '' || disabled}
      onClick={() => void run(action)}
      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--dsw-color-border)', background: 'var(--dsw-color-surface)', color: 'var(--dsw-color-text)', cursor: busy === '' && !disabled ? 'pointer' : 'default' }}
    >
      {busy === action ? t('state.busy') : t(action === 'port' ? 'action.port' : `action.${action}`)}
    </button>
  )

  return (
    <div style={{ display: 'grid', gap: 6, padding: '4px 0' }}>
      <div style={{ fontWeight: 600 }}>{t('card.title')}</div>
      {state?.documentPath ? <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }}>{state.documentPath}</code> : null}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {button('check')}
        {button('fix', !canFix)}
        {button('revert', !canRevert)}
      </div>
      {note !== '' ? <div style={{ color: 'var(--dsw-color-primary)', whiteSpace: 'pre-line' }}>{note}</div> : null}
      {offline ? <div>{t('state.offline')}</div> : null}
      {/* 结构无差异：一句话给肯定结论，不逐行刷档位（用户要的就是「注入正常」这个判定）。
          表达式被抄成字面量（P9）不在这里刷屏：它不改档位，只在 patch plan 的处方里提。 */}
      {state?.level === 'ok'
        ? <div style={{ color: LEVEL_COLOR.ok }}>{t('x.injectOk')}</div>
        : (state?.rows ?? []).map((row) => <Row key={row.rowId} row={row} t={t} />)}
      {(state?.rows ?? []).some((row) => row.rowId === 'webserver' && (row.findings ?? []).length > 0)
        ? <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-muted)' }}>{t('note.webserver')}</div>
        : null}
      {/* 端口写入面：放在启动面（webserver）检查下方——它属于启动行为面，与 cookie 寿命（connection）无关。
          只在“显式输入 + 显式点击”时动 webserver 行；写进去的是表达式 `ctx.webStartup.port ?? +<值>`，`--port` 仍优先。 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <input
          type="text"
          inputMode="numeric"
          placeholder={t('port.input')}
          aria-label={t('port.input')}
          value={portInput}
          onChange={(event) => setPortInput(event.target.value)}
          style={{ width: 110, padding: '5px 9px', borderRadius: 6, border: '1px solid var(--dsw-color-border)', background: 'var(--dsw-color-bg, var(--dsw-color-surface))', color: 'var(--dsw-color-text)', fontFamily: 'var(--dsw-font-mono, monospace)' }}
        />
        {button('port', !canPort)}
      </div>
      <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-muted)' }}>{t('port.help')}</div>
      {/* 常驻警告：端口热生效会把旧端口的当前页面踢下线，不提醒就会把用户锁在门外。 */}
      <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-warning, var(--dsw-color-muted))', lineHeight: 1.5 }}>{t('x.portSwitchWarn')}</div>
      {/* cookie 库读数（见 CookieLine：读得到就给实时值，读不到才说 busy） */}
      <CookieLine cookie={state?.cookie} t={t} />
      {/* 审计行：修复前根本没有覆盖行时（快照里无旧值），不能说“修复前 ?”——
          那是把“无据”伪装成一个值；改说“此前无覆盖行”。 */}
      {state?.lastFix
        ? <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-muted)' }}>
          {state.lastFix.beforeDays === undefined || state.lastFix.beforeDays === null
            ? render(t('x.auditLineNew'), { at: state.lastFix.at ?? '?', after: state.lastFix.targetDays ?? '?' })
            : render(t('x.auditLine'), { at: state.lastFix.at ?? '?', before: state.lastFix.beforeDays, after: state.lastFix.targetDays ?? '?' })}
        </div>
        : null}
      {state?.lastPort
        ? <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-muted)' }}>
          {render(t('port.audit'), { at: state.lastPort.at ?? '?', before: String(state.lastPort.before ?? '?'), port: String(state.lastPort.port ?? '?') })}
        </div>
        : null}
      {state?.checkedAt ? <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-muted)' }}>{render(t('lastCheck'), { at: state.checkedAt })}</div> : null}
    </div>
  )
}
