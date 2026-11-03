/**
 * dsh-cookie-cleaner — 宿主兼容清单（单一真源）。
 *
 * `scripts/sync-hosts.mjs` 把这份清单同步进三处：package.json 的 `engines.dsh`、
 * package.json 的 `dsh.compatibility.dshReleases`、dsh.plugin.json 的 `engines.dsh`。
 * 三处必须逐串相等（判定闸门只读 engines.dsh，compatibility 供插件管理器展示），
 * 手工改其中一处而漏掉其余 = 假兼容/假拒绝的直接来源。
 */

/** 已验证可装载的宿主线（逐 rc 单列，禁用 range 通配）。 */
export const HOSTS = [
  '0.1.0-rc.2',
  '0.1.0-rc.3',
  '0.1.0-rc.6',
  '0.1.0-rc.7',
  '0.1.0-rc.8',
  '0.1.1-rc.1',
  '0.1.1-rc.2',
  '0.1.2-rc.1',
  '0.1.5-rc.1',
  '0.1.5-rc.2',
  '0.1.5-rc.3',
  '0.1.7-rc.1',
  '0.1.7-rc.2',
  '0.2.0-rc.1',
  '0.2.0-rc.2',
  '0.2.1-rc.1',
  '0.2.1-rc.2',
  '0.2.1-rc.3',
  '0.2.1-rc.4',
  '0.2.1-rc.5',
]

/** 每个宿主线的兼容判定。 */
export const STATUS = 'compatible'

/** npm 语法的逐串 or-range：`0.1.0-rc.2 || 0.1.0-rc.3 || ...`。 */
export function orRange(hosts = HOSTS) {
  return hosts.join(' || ')
}
