/**
 * 卡片的数据臂：四条 POST 路由。
 *
 * URL 与宿主侧 `src/api-routes.js` 的派生式**必须逐字符一致**——两半各写一份是事实，
 * 但一致性由 `tests/api-routes.test.js` 读两份源码比对钉住（漂移表现为卡片永远 404）。
 */

export const NS = 'dsh-cookie-cleaner'

export const routes = {
  check: '/api/dsh-cookie-cleaner/patch/check',
  fix: '/api/dsh-cookie-cleaner/patch/fix',
  port: '/api/dsh-cookie-cleaner/patch/port',
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
  /** 上次成功修复的留痕（面板重开也看得到，不只在这一瞬） */
  lastFix?: { at?: string | null; beforeDays?: number; targetDays?: number }
  /** 上次端口动作的留痕（写前值/目标值） */
  lastPort?: { at?: string | null; before?: unknown; port?: number }
  /** cookie 库现状：运行期必然 busy，卡片得把它说出来而不是隐掉 */
  cookie?: { verdict?: string; reason?: string; path?: string; authCookies?: number; totalCookies?: number; bytes?: number }
}

export interface ActionView {
  kind: string
  changed?: string[]
  codes?: string[]
  message?: string
  effective?: number
  /** 端口动作：写进去的表达式与实际监听到了什么 */
  port?: number
  expr?: string
  hotApplied?: boolean
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
