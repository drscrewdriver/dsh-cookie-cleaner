/**
 * 卡片的数据臂：三条 POST 路由。
 *
 * URL 与宿主侧 `src/api-routes.js` 的派生式**必须逐字符一致**——两半各写一份是事实，
 * 但一致性由 `tests/api-routes.test.js` 读两份源码比对钉住（漂移表现为卡片永远 404）。
 *
 * 没有 port：面板不再提供端口控件（真正有效的是 cookie 寿命注入），
 * 端口只能走命令面 `/cookie-cleaner patch port <n>`。
 */

export const NS = 'dsh-cookie-cleaner'

export const routes = {
  check: '/api/dsh-cookie-cleaner/patch/check',
  fix: '/api/dsh-cookie-cleaner/patch/fix',
  revert: '/api/dsh-cookie-cleaner/patch/revert',
} as const

/** 宿主统一信封：`{ok, value}` 或 `{ok:false, code, message}`。 */
export interface BridgeReply<T> {
  ok?: boolean
  code?: string
  message?: string
  value?: T
}

export interface Finding {
  code: string
  level: 'ok' | 'warn' | 'fail' | 'skipped'
  params?: Record<string, unknown>
}

export interface RowView {
  rowId: string
  writable?: boolean
  level: 'ok' | 'warn' | 'fail' | 'skipped'
  actionable?: boolean
  /** 写了也没用的硬闸（P2/P4/P6/P10/P11）：面板据此禁用动作 */
  blocked?: boolean
  /** 表达式被抄成字面量（或根本没写）的键：不进档位，只在处方里提 */
  exprFrozen?: string[]
  findings?: Finding[]
}

export interface CheckView {
  level: 'ok' | 'warn' | 'fail' | 'skipped'
  reason?: string
  rows?: RowView[]
  documentPath?: string
  checkedAt?: string
  offline?: boolean
  /** 修复按钮要写入的目标寿命（宿主设置里那个值，跟结果同屏回显） */
  targetDays?: number
  /** 上次成功修复的留痕（面板重开也看得到，不只在这一瞬） */
  lastFix?: { at?: string | null; beforeDays?: number; targetDays?: number }
  /** 上次端口动作的留痕（写前值/目标值） */
  lastPort?: { at?: string | null; before?: unknown; port?: number }
  /** cookie 库现状：读得到就给条数与占用折算，读不到才给 reason */
  cookie?: {
    verdict?: string
    reason?: string
    path?: string
    authCookies?: number
    totalCookies?: number
    bytes?: number
    /** 读数来源：普通只读打开还是借句柄快照 */
    source?: string
    snapshot?: boolean
    liveUnavailable?: boolean
    liveReason?: string
    header?: {
      bytes: number
      pct: number
      rawPct: number
      maxHeaderBytes: number
      basis: string
      threshold: number
      remaining: number
      over: boolean
    }
  }
}

export interface ActionView {
  kind: string
  changed?: string[]
  codes?: string[]
  message?: string
  effective?: number
  result?: CheckView
}

/** POST 一跳；网络/解析失败都归成结构化错误，不让卡片白屏。 */
export async function postJson<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const reply = (await response.json()) as BridgeReply<T>
  if (reply.ok !== true) throw new Error(`${reply.code ?? 'unknown'} ${reply.message ?? ''}`.trim())
  if (reply.value === undefined) throw new Error('empty reply value')
  return reply.value
}
