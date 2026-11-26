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
import type { ActionView, CheckView, Finding, GuardView, LegacyView, RowView } from './routes'
import { mountStarRow } from './star-row-copy'

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

/**
 * 运行期守护面板：两个独立开关（retireStale 清理 / raiseHeaderBudget 抬预算）+ 两个阈值（retireAbove / keep）。
 * v0.7.0 之前是一个 runtimeGuard 全包——用户为了清 cookie 被迫放宽 431 阈值，故拆开。
 * 读写都走后端桥（configEditor 写本插件自己那行），写后回显生效值——不凭手写 YAML。
 */
/**
 * 历史注入残留面板（v0.7.1）：旧版插件写进 profile 的 `port` 表达式还在不在。
 *
 * 为什么单独一块而不是塞进体检结果：这不是"配置对不对"，是"插件自己留下的东西还在不在"，
 * 与 cookie 寿命无关。清理只在官方已接管 cookie 清理的宿主（0.2.2-rc.2+）上开放，
 * 更早的宿主仍需要钉端口这条缓解，所以那里只显示不提供按钮。
 */
function LegacyPanel({ t }: { t: (key: string) => string }): React.ReactElement | null {
  const [v, setV] = React.useState<LegacyView | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState('')
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    postJson<LegacyView>(routes.legacyGet, {}).then((next) => { if (mounted.current) setV(next) }).catch(() => { /* 无 config-editor 时静默 */ })
    return () => { mounted.current = false }
  }, [])
  if (v === undefined) return null
  if (v.available === false || v.found !== true) return null
  const clean = async () => {
    setBusy(true); setNote('')
    try {
      const next = await postJson<LegacyView>(routes.legacyClean, {})
      if (!mounted.current) return
      setV(next.state ?? v)
      setNote(next.kind === 'cleaned' ? t('legacy.cleaned') : t('legacy.noop'))
    } catch (error) {
      if (mounted.current) setNote(render(t('state.failed'), { message: String((error as Error).message ?? error) }))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--dsw-color-border)' }}>
      <div style={{ fontWeight: 600 }}>{t('legacy.title')}</div>
      <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-muted)' }}>{render(t('legacy.found'), { expr: v.expression ?? '?' })}</div>
      {v.cleanupSupported === true
        ? <button type="button" disabled={busy} onClick={() => void clean()} style={{ justifySelf: 'start', padding: '3px 10px', borderRadius: 6, border: '1px solid var(--dsw-color-border)', background: 'var(--dsw-color-surface)', color: 'var(--dsw-color-text)', cursor: busy ? 'default' : 'pointer' }}>{t('legacy.clean')}</button>
        : <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-muted)' }}>{t('legacy.unsupported')}</div>}
      {note !== '' ? <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-text)' }}>{note}</div> : null}
    </div>
  )
}

function GuardPanel({ t }: { t: (key: string) => string }): React.ReactElement | null {
  const [g, setG] = React.useState<GuardView | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState('')
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    postJson<GuardView>(routes.guardGet, {}).then((v) => { if (mounted.current) setG(v) }).catch(() => { /* 无 config-editor 时静默，不刷红 */ })
    return () => { mounted.current = false }
  }, [])
  if (g === undefined) return null
  if (g.available === false) return <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-muted)' }}>{t('guard.unavailable')}</div>
  const toInt = (e: React.ChangeEvent<HTMLInputElement>) => { const n = Math.trunc(Number(e.target.value)); return Number.isFinite(n) ? n : 0 }
  // 改完即存（无保存按钮）：先乐观更新本地态，后端失败则回滚到服务端值
  const commit = async (next: GuardView) => {
    const prev = g
    setG(next)
    setBusy(true); setNote('')
    try {
      const v = await postJson<GuardView>(routes.guardSet, {
        retireStale: next.retireStale,
        raiseHeaderBudget: next.raiseHeaderBudget,
        maxHeaderBytes: next.maxHeaderBytes,
        keep: next.keep,
        retireAbove: next.retireAbove,
      })
      if (!mounted.current) return
      setG(v)
      setNote(v.kind === 'noop' ? t('guard.noop') : t('guard.saved'))
    } catch (error) {
      if (mounted.current) {
        setG(prev)
        setNote(render(t('state.failed'), { message: String((error as Error).message ?? error) }))
      }
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const inputStyle = { width: 72, padding: '2px 6px', border: '1px solid var(--dsw-color-border)', borderRadius: 6, background: 'var(--dsw-color-surface)', color: 'var(--dsw-color-text)' } as const
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--dsw-color-border)' }}>
      <div style={{ fontWeight: 600 }}>{t('guard.title')}</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={g.retireStale} disabled={busy} onChange={(e) => void commit({ ...g, retireStale: e.target.checked })} />
        {t('guard.enableRetire')}
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={g.raiseHeaderBudget} disabled={busy} onChange={(e) => void commit({ ...g, raiseHeaderBudget: e.target.checked })} />
        {t('guard.enableBudget')}
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9em' }}>
        {t('guard.retireAbove')}
        <input type="number" min={0} max={10000} value={g.retireAbove} disabled={busy}
          onChange={(e) => setG({ ...g, retireAbove: toInt(e) })}
          onBlur={() => void commit(g)}
          onKeyDown={(e) => { if (e.key === 'Enter') void commit(g) }}
          style={inputStyle} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9em' }}>
        {t('guard.keep')}
        <input type="number" min={1} max={64} value={g.keep} disabled={busy}
          onChange={(e) => setG({ ...g, keep: toInt(e) })}
          onBlur={() => void commit(g)}
          onKeyDown={(e) => { if (e.key === 'Enter') void commit(g) }}
          style={inputStyle} />
      </label>
      {busy || note !== '' ? <div style={{ fontSize: '0.85em', color: busy ? 'var(--dsw-color-muted)' : 'var(--dsw-color-primary)' }}>{busy ? t('state.busy') : note}</div> : null}
    </div>
  )
}

export function PatchCard({ t }: CardProps): React.ReactElement {
  const [state, setState] = React.useState<CheckView | undefined>(undefined)
  const [busy, setBusy] = React.useState<'' | 'check' | 'fix' | 'revert'>('')
  const [note, setNote] = React.useState('')
  const mounted = React.useRef(true)

  React.useEffect(() => {
    mounted.current = true
    void run('check')
    return () => { mounted.current = false }
  }, [])

  async function run(action: 'check' | 'fix' | 'revert'): Promise<void> {
    setBusy(action)
    setNote('')
    try {
      if (action === 'check') {
        const value = await postJson<CheckView>(routes.check, {})
        if (mounted.current) setState(value)
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
  const canFix = offline !== true && conn?.actionable === true
  const canRevert = offline !== true
  const button = (action: 'check' | 'fix' | 'revert', disabled = false) => (
    <button
      type="button"
      disabled={busy !== '' || disabled}
      onClick={() => void run(action)}
      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--dsw-color-border)', background: 'var(--dsw-color-surface)', color: 'var(--dsw-color-text)', cursor: busy === '' && !disabled ? 'pointer' : 'default' }}
    >
      {busy === action ? t('state.busy') : t(`action.${action}`)}
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
      {/* 真正有效的那一项：修复按钮写入的目标寿命（宿主设置里的 guardDays），跟结果同屏回显。
          面板不再提供端口控件：端口属启动行为面，需要时用命令面 `patch port <n>` 显式改。 */}
      {state?.targetDays !== undefined
        ? <div style={{ fontSize: '0.9em', color: 'var(--dsw-color-text)' }}>{render(t('x.targetDaysLine'), { days: String(state.targetDays) })}</div>
        : null}
      {/* cookie 库读数（见 CookieLine：读得到就给实时值，读不到才说 busy） */}
      <CookieLine cookie={state?.cookie} t={t} />
      {/* 运行期守护：开关 + 两个阈值（写本插件自己那行，写后回显生效值） */}
      <GuardPanel t={t} />
      {/* 历史注入残留：旧版「应用端口」写进 profile 的表达式（有才显示） */}
      <LegacyPanel t={t} />
      {/* 审计行：修复前根本没有覆盖行时（快照里无旧值），不能说“修复前 ?”——
          那是把“无据”伪装成一个值；改说“此前无覆盖行”。 */}
      {state?.lastFix
        ? <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-muted)' }}>
          {state.lastFix.beforeDays === undefined || state.lastFix.beforeDays === null
            ? render(t('x.auditLineNew'), { at: state.lastFix.at ?? '?', after: state.lastFix.targetDays ?? '?' })
            : render(t('x.auditLine'), { at: state.lastFix.at ?? '?', before: state.lastFix.beforeDays, after: state.lastFix.targetDays ?? '?' })}
        </div>
        : null}
      {state?.checkedAt ? <div style={{ fontSize: '0.85em', color: 'var(--dsw-color-muted)' }}>{render(t('lastCheck'), { at: state.checkedAt })}</div> : null}
      <span
        ref={(node: HTMLElement | null) => {
          if (node && !node.firstChild) node.appendChild(mountStarRow())        }}
      />
    </div>
  )
}
