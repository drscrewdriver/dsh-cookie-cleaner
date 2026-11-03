/**
 * dsh-cookie-cleaner — 运行时文案 i18n（9 语）。
 *
 * 为什么自己做一层：本插件没有 client 半（运维工具，界面在终端），
 * 宿主规范的 `src/client/locales.ts` 那条路走不到；而 `locale/<lang>.json`
 * 只管市场卡标题/描述，管不到命令行输出。所以消息字典放在这里，
 * 由 CLI / 宿主命令共用。
 *
 * 纪律：
 * - `zh` 是键集真理源，其余 8 语必须与之完全同键（测试机械核对）；
 * - 占位符（{path} / {count} 等）逐语言保留，不翻译花括号内的名字；
 * - 语言探测优先级：显式参数 → DSH_LANG → LANG/LC_ALL/LC → 系统 locale → zh；
 * - 未知语言回落 zh，绝不因为取不到词条而崩或吞掉输出。
 */

/** 支持的语言（与 locale/*.json 的 9 语一致）。 */
export const LANGS = Object.freeze(['zh', 'en', 'ja', 'ko', 'fr', 'de', 'it', 'ru', 'es'])

const zh = Object.freeze({
  skipped: '未定位到 cookie 库——如果你用的是 Web 版而非桌面客户端，浏览器自身的 cookie 不由本工具管理，无需清理。',
  skippedCandidates: '候选路径：',
  skippedHint: '若你用的是 Web 版（浏览器直连宿主），本地没有这个库，无需清理；桌面版可用 userDataRoot 或 --db 指定。',
  busy: 'cookie 库此刻读不到（客户端正在运行，被 Chromium 独占）：{path}',
  busyWhy: '宿主插件无法在运行期清理这个库 —— 这是操作系统的文件占用，不是本工具的限制。',
  permission: 'cookie 库读不了：权限不够（文件不属于当前用户，或 flatpak/snap 安装的库不在常规位置）：{path}',
  permissionHint: '处置：确认用哪个用户跑命令，或直接把库指出来：',
  dbRequired: '--db=<完整路径>',
  exitWin: '完全退出 DSH 客户端（托盘图标 → 退出，并确认进程列表里已无 DeepSeek Harness）',
  exitMac: '完全退出 DSH 客户端（Cmd+Q 或菜单 → Quit；Dock 上图标消失还不够，确认 ps 里已无 DeepSeek Harness）',
  exitLinux: '完全退出 DSH 客户端（关闭主窗口后确认进程列表里已无 DeepSeek Harness / dsh-desktop）',
  dbLine: 'cookie 库：{path}（{bytes} B，共 {total} 条）',
  ok: '状态：ok —— 没有 dsh-auth-* 残留，无需清理。',
  found: '状态：发现 {count} 条 dsh-auth-*（已过期 {expired} / 未过期 {live}）',
  span: '过期时间跨度：{oldest} ～ {newest}',
  hostLine: 'host_key 分布：',
  note: '说明：dsh-auth-* 的名字按 host:port 哈希，每换一次端口就留一条，未过期的会一直躺到 30 天到期；它们不影响登录（主窗口用内存态凭据、鉴权只认当前端口那一条），也不涉及账号凭据/会话/插件配置。',
  nextStatus: '下一步：{exit}后，在终端执行（先看会删几条可加 --dry-run）：',
  nextClean: '清理命令（务必先{exit}，运行期做不到）：',
  cleanFooter: '  默认档删全部 dsh-auth-*；--expired-only 只删已过期的；写盘前自动留 .bak 副本。',
  statClean: '干净：{path}（共 {total} 条 cookie，无 dsh-auth-* 残留）',
  statBusy: '无法读取（客户端正在运行，库被 Chromium 独占）：{path}',

  statMissing: 'cookie 库不在这个位置（客户端从未起过、或装在了别处）：{path}',
  statPermission: '无权限读取 cookie 库（目录位置不对或文件不属于当前用户）：{path}',
  statFound: '发现 {count} 条 dsh-auth-*（已过期 {expired} / 未过期 {live}），分布在 {hosts} 个 host_key，库大小 {bytes} B：{path}',
  deleted: '已删除 {count} 条 dsh-auth-*（{scope}）',
  scopeAll: '全部',
  scopeExpired: '仅已过期',
  dbSize: '  库：{path}  {before} B → {after} B',
  backup: '  备份：{backup}',
  backupWith: '（含 {sidecars}）',
  backupSkipped: '  备份：已按 --no-backup 跳过',
  backupWarn: '  注意：{sidecars} 拷不上（被占），主库副本仍完整，不影响本次删除。',
  untouched: '  账号凭据、会话、插件配置均未触碰；下次启动会重新换发本地 cookie。',
  dryRun: '[dry-run] 将删除 {count} 条：{path}',
  dryRunTail: '未写盘。去掉 --dry-run 即可执行。',
  notFound: '没找到 cookie 库。候选路径：{candidates} 可用 --db=<完整路径> 指定。',
  nextCliClean: '下一步：{exit}后执行 `dsh-cookie-cleaner --clean`（默认会连未过期的一起删，不影响登录，见 README）。',
  nextCliRerun: '下一步：{exit}后重跑本命令。',
  nextCliPermission: '下一步：确认跑命令的用户拥有该文件，或用 --db=<完整路径> 指向你的库。',
  openFailed: '无法打开 cookie 库：{path}',
  reason: '  原因：{reason}',
  adviseBusy: '  处置：这个库在客户端运行期间被 Chromium 独占。请{exit}，再执行本命令。',

  adviseMissing: '  处置：文件不在这里（可能路径变了、客户端从未起过、或被标记删除）。用 --db=<完整路径> 指向实际的 cookie 库。',
  advisePermission: '  处置：当前用户读不了这个文件（权限或属主问题）。确认它属于跑本命令的账号；flatpak/snap 安装的库不在常规位置，用 --db=<完整路径> 指出。',
  adviseOwner: '  处置：这个文件属于另一个用户（不是跑本命令的你）。用那个账号跑，或用 --db=<完整路径> 指向你自己那份库。',
  missingFile: '文件不存在（或被标记删除）',
  cleanFailed: '清理失败：',
})

/** zh 键集的静态清单（i18n.test.js 用它核对其余 8 语，缺键即测试红）。 */
export const zhKeys = Object.freeze(Object.keys(zh))
export { zh }

/** 语言→字典。`zh` 开机即，其余 8 语由 locales-dict.js 注册进来（避开单文件过大）。 */
export const dictionaries = { zh }

/**
 * 注册一种语言的字典（仅 locales-dict.js 用）。
 * 键集必须与 zh 同串同数，否则插值会默默回落中文。
 * @param {string} lang
 * @param {Record<string,string>} dict
 */
export function registerDictionary(lang, dict) {
  if (!LANGS.includes(lang)) throw new Error(`不支持的语言：${lang}`)
  const missing = zhKeys.filter((key) => typeof dict[key] !== 'string')
  if (missing.length > 0) throw new Error(`${lang} 缺键：${missing.join(', ')}`)
  const extra = Object.keys(dict).filter((key) => !zhKeys.includes(key))
  if (extra.length > 0) throw new Error(`${lang} 多余键（zh 里没有）：${extra.join(', ')}`)
  dictionaries[lang] = Object.freeze(dict)
}

/** 取某语言在 Windows 下的进程名提示（文案里出现，需按平台正确）。 */
export function detectLang(candidates = process.env, systemLocale = safeSystemLocale()) {
  const explicit = String(candidates.DSH_COOKIE_LANG || candidates.DSH_LANG || '').trim()
  if (explicit) return normalize(explicit)
  const fromEnv = String(candidates.LC_ALL || candidates.LC_MESSAGES || candidates.LANG || '').trim()
  if (fromEnv) return normalize(fromEnv)
  return normalize(systemLocale)
}

function safeSystemLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || ''
  } catch {
    return ''
  }
}

/** BCP-47 → 我们支持的 9 个短码；认不出来就落 zh（本工具的原生语言）。 */
export function normalize(tag) {
  const raw = String(tag || '').toLowerCase()
  // POSIX 中性 locale（C / C.UTF-8 / POSIX）不是中文环境，落英文比落中文合理。
  if (/^(c|posix)(\.[\w-]+)?$/.test(raw)) return 'en'
  const base = raw.split(/[-_]/)[0]
  return LANGS.includes(base) ? base : 'zh'
}

/** 退出客户端的平台化指引。 */
export function exitFor(platform, t) {
  if (platform === 'darwin') return t('exitMac')
  if (platform === 'win32') return t('exitWin')
  return t('exitLinux')
}

/**
 * 造一个翻译函数：{name} 形式的插值，缺键回落 zh 原文。
 * @param {string} lang
 */
export function translator(lang) {
  const dict = dictionaries[lang] ?? zh
  return (key, vars) => fill(dict[key] ?? zh[key] ?? key, vars)
}

function fill(text, vars) {
  if (vars === undefined || vars === null) return text
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
}
