/**
 * dsh-cookie-cleaner — 宿主兼容清单（单一真源）。
 *
 * `scripts/sync-hosts.mjs` 把这份清单同步进三处：package.json 的 `engines.dsh`、
 * package.json 的 `dsh.compatibility.dshReleases`、dsh.plugin.json 的 `engines.dsh`。
 * 三处必须逐串相等（判定闸门只读 engines.dsh，compatibility 供插件管理器展示），
 * 手工改其中一处而漏掉其余 = 假兼容/假拒绝的直接来源。
 */

/**
 * 判定闸门声明面：`engines.dsh` 两处写点（package.json / dsh.plugin.json）与**全部**
 * `@deepseek-ai/dsh-*` peer 共用下面这个区间（定义在 HOSTS 之后，下限由其起点推导）。
 * HOSTS 枚举继续供 `dsh.compatibility.dshReleases` 展示（已实测细胞证据）。
 */

/** 已验证可装载的宿主线（逐 rc 单列，供 compatibility 展示与 peer range）。 */
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
  // 0.2.2 line
  '0.2.2-rc.1',
]

/**
 * 唯一宿主声明串（2026-11-14 形状统一）：engines.dsh 两处写点与全部 dsh-* peer 共用；
 * 下限＝HOSTS 起点，上限 `<0.3.0-0`（`-0` 堵住 0.3.0-rc.* 泄漏）。
 */
export const ENGINES_RANGE = `>=${HOSTS[0]} <0.3.0-0`

/** 每个宿主线的兼容判定。 */
export const STATUS = 'compatible'

/** npm 语法的逐串 or-range：`0.1.0-rc.2 || 0.1.0-rc.3 || ...`（仅作展示/证据）。 */
export function orRange(hosts = HOSTS) {
  return hosts.join(' || ')
}

/** peer 下发用串：与 engines.dsh 同串（2026-11-14 起不再下发枚举）。 */
export const PEER_RANGE = ENGINES_RANGE
