# Changelog

## 0.7.2 (2026-11-26)

**设置卡底栏 Star 快车道：★ 直接打开仓库页（不再只静默收起），隐藏独立成 ×。**

- 新增 `src/client/star-row-copy.ts`（由 `_tools/star-row/sync.mjs` 从 kit 真源生成，禁手改）：GitHub 图标 + owner/repo 链接 ｜ 求星话术 ｜ ★ CTA ｜ × 隐藏。
- **修 S 档旧缺陷**：点 ★ 此前写成 `starDismiss()`，与「别打扰我」合流，仓库页一次都没打开过。现在 ★ 走锚点 click 打开 `REPO_URL`（不写 dismissed），× 才写 `dsh.star.<ns>.dismissed=1` 并收话术与两钮；链接段永留。
- 真源 `STAR:EXTENDED` 段单源维护，A/L 档副本由 sync 整段剥除，已发布 A/L 仓零 diff。
- 文案 10 语按 `documentElement.lang` 前缀自选，不依赖宿主 locale 服务；样式只走 `--dsw-alias-*` 令牌与 `currentColor`，零硬色。
- 契约测试改写：旧断言「点 ★ 只收话术」本身把缺陷锁成了契约，改为「★ 打开仓库页且不写 dismissed / × 才隐藏」。

## 0.7.1 (2026-11-17)

- **修复：合法空 flow map 被判成整层 YAML 非法（issue #1）**。`src/patch-read.js` 三处把「值形如 `{...}`」直接 `fail('inline flow map')`，于是一处 `providers: {}` 让 profile 层**整层失效**——其后 112 行全部不再处理，面板对 connection / webserver 双双报「会失效」，「修复」按钮永远写不进去。而 `{}` 是合法 YAML。
- **修法**：值形态不再参与「整层是否合法」的判定。新增 `parseFlowMap()` / `splitFlow()` 尽力解析 `{}` / `{a: 1, b: "x"}`；跨行 flow（本行只有开括号）与嵌套 flow 降级为「值未知」，**不升级为整层失败**。真结构性错误（多文档 `---`、锚点 `&x`、模板根 `[]` 后接分块行）仍照旧 `ok:false`。
- **测试**：`patch-read.test.js` 原「超出子集的构造一律 ok:false」用例把 flow map 与锚点/多文档并列，等于把 bug 当规范——已拆成两条：结构错误仍拒，flow map 改判合法并断言「坏值前后所有行都读得到」。新增跨行 flow / 嵌套 flow / `config: {}` 形态。
- **新增：历史注入残留清理（适用于 0.2.2-rc.2+）**。0.2.1 之前本插件提供过「应用端口」动作，把 `webserver.port` 写成 `ctx.webStartup.port ?? +<n>`；能力删了，但**已写进用户 profile 的那行不会自己消失**，仍在生效（启动层没传 `--port` 时落在当年那个数上，且卸载插件后残留仍在）。
  - 新增 `src/legacy-injection.js`：`classifyLegacyPort()` 只认「`!!js` 表达式 + 指向 `webStartup.port` + fallback 是数字」这一种形态；`findLegacyInjection()` 读现状；`withoutLegacyInjection()` **删键而非写回 bundle 原值**（少一个键 = 回落到 bundle 默认，这才是"清掉插件写的东西"；抄 bundle 表达式会把上游实现细节固化进用户配置）。
  - **不碰**：用户手写的字面量端口（P8 那类，坚持"看到但不替你改"）、用户自己的表达式（如 `process.env.PORT ?? 8080`）、缺 fallback 的写法、别的 ctx 路径。
  - **只在官方已接管 cookie 清理的宿主上开放**（`detectNativeCleanup()` 判据，即 0.2.2-rc.2+）。更早的宿主钉端口仍是上游给的可选缓解，那里**只报告不清理**。另留 `supportsLegacyCleanup()` 按版本串判定（完整单测，供诊断）。
  - 三个入口：面板 `LegacyPanel`（有残留才显示 + 「清理这一行」）、命令 `dsh-cookie-cleaner legacy`（只读报告，离线进程不直改 profile）、API `/legacy/get` + `/legacy/clean`（与客户端路由逐字一致，测试双向钉住）。写仍走 `configEditor.edit`（schema 校验 + 原子写 + HMR）并留快照可回滚。
- **新增：`detectNativeCleanup()` / `scanBinaryFor()`**（`src/core.js`）。官方在 desktop 0.2.2-rc.2 起自带 `removeLegacyHostCookies`（走 Electron `session.cookies.remove` 直删 jar），比下发 Set-Cookie 更彻底。插件跑在 `ELECTRON_RUN_AS_NODE=1` 的纯 Node 子进程，**拿不到 `session.cookies`**，照抄不了官方手法——只能探测后让位。asar 是容器文件、纯 Node 的 `fs` 读不到内部路径，故用**二进制分块扫描**找标记字符串（跨块边界不丢、命中即停、200MB 不进内存）。读不到一律判 `present:false`，宁可多做一次幂等清理也不误判成"官方已管"。
- **运行期守护：退休与抬预算拆成两个独立开关**。原 `runtimeGuard` 一个开关把两件事捆在一起，用户为了清 cookie 被迫放宽 431 阈值。
  - `retireStale`（**默认开**）：只发 `Set-Cookie: ...; Max-Age=0` 让浏览器丢历史启动 cookie，保留当前 authority 那条 + tail-keep。实测确认：握手响应里会话 cookie **恒排第一**、desktop `authenticateWebHost` 解析出的 `hostCookie` 正确，追加的删除行不会污染它；当前端口那条永不删。可逆、不碰 SQLite、不降鉴权强度 → 默认开是安全的。
  - `raiseHeaderBudget`（**默认关**）：放宽 431 触发线属于「调松安全阈值」，不该被清理动作顺带打开。
  - 官方清理存在时 `retireStale` 自动让位（两套一起跑只会让水位读数抖动）；水位观测臂仍**无条件挂**，与两个开关都解耦。
  - 旧字段 `runtimeGuard: true` 保留为「一键全开」的兼容写法；面板相应改为两个勾选框（新增 9 语 `guard.enableRetire` / `guard.enableBudget`，移除已无引用的 `guard.enable`）。
- **全量 gate**：223 tests / 222 pass / 1 skip / 0 fail（lint + typecheck + build 全绿）。

## 0.6.4 (2026-11-14)

- **修复：守护关闭时水位归零（接线错位）**。原因两层：
  1. 观测 Cookie 头的代码长在 `installRuntimeGuard` 里，而它被 `if (cfg.runtimeGuard !== true) return` 整体短路——守护一关，实时读数渠道跟着没了；
  2. 剩下的磁盘阶梯只能读已落盘的 jar。Chromium 只在**优雅退出**时写盘，强杀/崩溃后磁盘库长期停在旧快照（本机实测：36864 B、mtime 停在 12:03，而 15:04 已重启并在使用），于是面板与命令面双双报 `0 条（共 0 条）`。
- **修正接线**：新增 `observeCookieHeader()` + `installCookieObserver()`（`src/runtime-guard.js`），作为**只读旁路**无条件挂在 `webServer` 的 `request` 上；`runtimeGuard` 只管抬 `maxHeaderSize` 与下发退休行。水位优先级：请求头实时观测 > 借句柄快照 > 普通只读。
- **统一入口**：命令面 / 面板 `cookie` 数据臂 / patch 体检均改走 `cookieWaterLevel(cfg)`；`--json` 新增 `observed` 与 `headerBytes`，文本新增「水位 实时（请求头观测）」行；没观测到启动 cookie 时完全退回磁盘档，不编造数据。
- **测试**：新增 `tests/cookie-observer.test.js`（7 例：形状统计/数组头/非 MINTED 不越界/无 cookie 请求不清读数/dispose 后不更新/旁路抛错不影响请求）；`command-contract.test.js` 改为钉住“观测臂必须在 runtimeGuard 短路之前”。全量 gate：204 tests / 203 pass / 1 skip / 0 fail。
- **真机验证**（TUI profile 宿主 0.2.2-rc.3，守护处于关闭）：token 交换后 `/cookie-cleaner status` 报
  `1 条 dsh-auth-*（共 1 条），请求头约 224 B / 上限 16384 B（1.4%）`，`ladder:"observed-header"`、`source:"request-header"`。

## 0.6.3 (2026-11-14)

- **命令面读数接线修正**：`/cookie-cleaner status|clean|patch` 与面板共用读数阶梯 `readCookieStat()`——普通只读被 Chromium 独占（`busy`）时回落 `statCookiesLive()`（借宿主自己持有的句柄做快照，内置 5s 节流 + 60s 缓存）。桌面端运行期不再只报“读不到”，面板有水位的命令面也有水位。
- **扫描范围护栏**：新增导出 `shouldUseLiveLadder(env, proc)`，仅在宿主进程（Electron 主进程 `process.type==='browser'` 或 `process.versions.electron` 存在）启用借句柄；独立 node（单测/脚本）保持普通只读，避免系统级扫描把测试拖超时。`DSH_COOKIE_LIVE_LADDER=1|on|0|off` 可显式覆盖。
- **`--json` 增补来源字段**：`{ladder, source, snapshot, verdict, authCookies, totalCookies}`，脚本可区分真水位与 busy 回档；输出仍单行。
- **0.6.2 回退**：撤销误加的“非 Desktop 宿主回不适用”运行时短路——那个短路把桌面版命令面也变成只提示，等于没接线。
- **测试**：新增 `tests/live-ladder-gate.test.js`（5 例）；`command-contract.test.js` 的阶梯契约改为“命令面与面板共用 + 扫句柄仅限宿主进程”。全量 gate：198 tests / 197 pass / 1 skip / 0 fail。

## 0.6.2 (2026-11-14)

- **回退运行时闸门**：删除 `DSH_DESKTOP_DEFAULT_PROFILE` 判断，`status|clean|patch` 在 Desktop/TUI/CLI 一律走真实逻辑（“TUI 上价值有限”只写进 README，不进代码）。
- **命令输出契约**：新增 `clipOut`（单行 ≤100、总行 ≤40）与 `--json` 包装（`{ok, cmd:'cookie-cleaner', sub, data|error}`）。

## 0.6.1 (2026-11-09)

- **守护面板改为「改完即存」**：去掉保存按钮。`runtimeGuard` 勾选/取消**立即写入**（乐观更新，失败回滚）；`retireAbove` / `keep` 两个数字失焦或回车即写。无需再点保存，与开关同样的 `configEditor` 写入/HMR 热生效路径。

## 0.6.0 (2026-11-09)

- **运行期守护接线到设置面板**：卡片新增「运行期守护」一块——`runtimeGuard` 开关 + `retireAbove` / `keep` 两个阈值输入 + 保存按钮；读写走后端桥 `guard/get` / `guard/set`，写走宿主 `configEditor.edit()`（目标插件 Config schema 校验 + 原子写 + HMR 热应用），写后回显生效值。默认仍禁用，与手写 patch 等价。
- **Host 侧**：`patch-guard.js` 新增 `readGuard` / `writeGuard`（只动白名单四键，其余 config 原样保留；无变化不写）；`api-routes.js` 新增 `guard/get` / `guard/set` 两路由（仍 POST-only），`endpoint` 把 body 透传给 run；`index.js` 把 getGuard/setGuard 接进 registerPatchRoutes。
- **Client 侧**：`card.tsx` 新增 `GuardPanel`（开关 + 两个 number，主题令牌配色）；`routes.ts` 新增两条字面量 + `GuardView` 类型；`locales.ts` 新增 8 个界面键（`guard.*`，9 语齐备）。
- **测试**：`api-routes.test.js` 由「三条」改「五条」，并把 `guardGet/guardSet` 纳入两半 URL 同串的钉。全量 gate：193 tests / 192 pass / 1 skip / 0 fail。
- **兼容性**：无 config-editor 时面板显示「不可改」而不报错；默认值不变。

## 0.5.0 (2026-11-09)

- **新增 `retireAbove` 阈值触发：条目数 > N 才退休**。解决“不想每次请求都动 jar、想攒到一定量再清”的诉求：
  `retireAbove: 40` 时，只要 Cookie 头里合法 `dsh-auth-*` 条数 ≤ 40 就**完全不动**（连 Set-Cookie 都不发）；
  超过 40 才按尾部 `keep` 收敛。默认 `0` = 不设阈值（保持“每次按 keep 收敛”的旧行为）。
- **runtime-guard**：`installRuntimeGuard` 新增 `retireAbove` 选项（夹到 0–10000），`retire()` 在 collect 后早退；`DEFAULTS`/`LIMITS` 导出同步。
- **Config**：新增 `retireAbove: 0`（volatile）；`runtimeGuard` 仍**默认禁用**，装开后才生效。
- **测试**（+3，共 13 例）：≤ 阈值不发删除行、> 阈值删到 keep、默认 0 保持旧行为。
- **兼容性**：默认值不改任何现有行为；仅在 `runtimeGuard: true` 且显式设 `retireAbove > 0` 时才改变节奏。

## 0.4.0 (2026-11-09)

- **新增 `--older-than=<小时>`：按创建时间清理**。`dsh-cookie-cleaner --clean --older-than=24` 只删
  `creation_utc` 早于“现在 - N 小时”的 `dsh-auth-*`（可小数，`0.5` = 30 分钟）。这条能力属**离线 CLI 独有**：
  它直连 SQLite 读得到 `creation_utc`；运行期守护走 HTTP 只能拿到 `name=value`，读不到创建时间，因此没有该开关。
- **core**：`buildDeleteStatement` / `cleanCookies` 新增 `olderThanHours`（默认 0 = 关），可与 `--expired-only`
  叠加为 AND（更保守）；`0` / 负数 / 非数字一律忽略。`creation_utc` 阈值同样以 BigInt 绑定（微秒时间戳超 2^53）。
- **文案**（9 语）：新增 `scopeOlderThan`（`创建超过 {hours} 小时` / `older than {hours}h` …），`deleted` 行用它。
- **测试**（+2）：`buildDeleteStatement` 的 `creation_utc` 阈值语句/BigInt 参数、与 `expiredOnly` 叠加、0/负/NaN 忽略；
  全量 190 tests / 189 pass / 1 skip / 0 fail。
- **真机验证**：注入 75 条（33×60h 前 + 33×25h 前 + 9 条真实）后，`--older-than=24 --dry-run` 精确报
  66 条；实跑 `Deleted 66 (older than 24h)`，库 53248 B → 20480 B，保留 9 条最近（header 2052 B / 12.5%）。

## 0.3.0 (2026-11-09)

- **新增运行期守护（可选，`runtimeGuard` 默认关）**：薄整合自第三方
  [`dsh-auth-cookie-guard`](https://github.com/jitianjiyan/dsh-auth-cookie-guard)，把 431 防护从"停机整清"扩展到"日常收敛"。
  实现：`src/runtime-guard.js`——①抬 `webServer` 监听器 `server.maxHeaderSize`（默认 64 KiB；
  Node 每 accept 新连接才读该属性，运行时赋值对新连接当场生效）；②在 `request` 事件上 prepend `retire`，
  只读 Cookie 头里的**名字**（`dsh-auth-<43 base64url>`），保留尾部 `keep` 条 + 当前端口那一条，其余下发
  `Set-Cookie: name=; Max-Age=0; Path=/; Expires=...` 让浏览器自己从 jar 与磁盘库退休；
  ③每响应最多 96 条删除行（~12 KiB，留在 Node HTTP 客户端 16 KiB 响应头预算内；大 jar 分多轮收敛）；
  ④不解 cookie 值（签名会话载荷）、不写日志、不新增依赖，仍**不直连 SQLite**。
- **Config 新增三项**（均 `volatile`）：`runtimeGuard: false` / `maxHeaderBytes: 65536`（夹到 16 KiB–1 MiB）/ `keep: 4`（夹到 1–64）。
  挂载点用独立的 `ctx.inject(['webServer'])` 分支，**不依赖 `configEditor`**——headless/fiber 环境无 `webServer` 时静默降级、
  不阻塞现有命令面/patch 面。禁用（默认）下与 0.2.x 行为完全一致。
- **文案**（9 语）：新增 `guardOn` / `guardOff` 两档状态行，面板与命令面共用；`patch check` 输出末尾会带一句
  "运行期守护：开/关（预算 / keep / cap）"，用户不靠日志也能看。
- **测试**（`tests/runtime-guard.test.js`，10 例）：303 对象写头合并、三参数写头、平铺数组、无 header 走
  `setHeader` 兜底、`stale=0` 不包装 `writeHead`（幂等）、`MAX_RETIRE_PER_RESPONSE=96` 分批、keep + current 保底、
  `maxHeaderSize` 赋值对新连接生效 + dispose 还原、`bounded` 夹位、`onRetire` 四元组不带名字/值。
  全量 `node --test tests/*.test.js`：188 tests / 187 pass / 1 skip（预期：POSIX chmod 用例在 Windows skip）/ 0 fail。
- **README**：首段从"两条互斥路线"改为"本插件两条都提供（运行期 + 离线）"；`关键约束` 澄清**直连 SQLite** 的限制，
  不再误伤 HTTP 运行期路径；新增 [运行期守护（可选）](#运行期守护可选) 完整章节（机制 / 怎么开 / 边界）；
  「与运行期守护的分工」改写为「本插件 runtimeGuard / 离线 `--clean` / 第三方 guard」三方叠加规则。
- **兼容性**：向后兼容，默认关；升级不强制改任何 profile。与第三方 `dsh-auth-cookie-guard` **建议二选一**
  （同时开会双份下发删除行、日志重复）。

## 0.2.1 (2026-11-06)

- **端口写入能力整体删除**（用户裁决 2026-11-05）：防 431 真正有效的是 **cookie 寿命注入**，
  而端口属启动行为决策，不在本工具职责内。上一版只藏了面板控件，本版删到底：
  ① 卡片去掉输入框/按钮/常驻警告/留痕行；② 命令面去掉 `patch port` 子命令（`patch` 只剩
  `check|fix|revert|plan`，命令描述与 hint 同步）；③ 守卫去掉 `applyPort` 与 `net.connect` 占用探针；
  ④ 内核去掉 `PORT_WRITE` / `isValidPort` / `portExpressionFor` / `nextPortConfig`；
  ⑤ HTTP 去掉 `/api/.../patch/port` 写端点（没人调的写端点只是攻击面）；⑥ 设置项 `guardPort` 删除；
  ⑦ 文案去掉 7 个端口结果句（`portApplied`/`portHot`/`portRestart`/`portUnknown`/`portBusy`/
  `portInvalid`/`portSwitchWarn`，9 语）与 CHROME 里的 `port.*`/`action.port`。
  **保留**的是只读判定：`webserver.port` 写成字面量仍报 P8（“看到但不替你改”），
  `webserverNote` 改为说明本插件只改 cookie 有效期（9 语）。
  面板现在同屏回显 **目标 cookie 绝对寿命**（新词 `targetDaysLine`，面板/命令面共用），
  让用户看得到「修复」到底写哪个值。
  测试口径：端口行为测试全部删除，改钉「导出不存在」（`patch-model.test.js`）与
  「面板/命令面/路由都没有 port」（`client-bundle.test.js`、`api-routes.test.js`）——
  行为测试会随实现一起被删，导出面才能拦住“顺手加回来”。
- **句柄扫描只留给面板**：命令面 / CLI / 启动播报改回普通只读打开。真机踩过：`patch check`
  也接了阶梯之后，测试里会真的去扫全机句柄表，整个测试文件超时；现由
  `tests/command-contract.test.js` 的静态契约钉住这条边界。
- **实时读数进设置面**：`statCookies` 结果新增 `header` 折算（`headerOccupancy`）——名字长度用库内实测
  `SUM(LENGTH(name))`，`value` 列存的是密文不能当体积，所以明文按上游三份报告一致的 173 B/条估算并标
  `basis:'estimated'`；每条合计 228 B，与 #11366 现场（71 条 = 16,188 B）对齐，临界 = floor(16384/228) = 71 条。
  面板新增 `CookieLine` 三档（实时值 / 只有条数 / 读不到），过半转告警色、顶到上限转危险色；
  命令面与 CLI status 共用 `cookieLiveText` 同一句话（9 语）。同时修正一个旧口径：
  读数路径**先尝试只读打开**，打开成功就给实时值，不再把“运行期必然读不到”当必然（CLI 的
  `patch` 路径仍不碰 cookie 库，职责分离不变）。
- **运行期读数：借宿主已打开的句柄（`src/jar-live.js`，仅 Windows）**。普通只读打开被 Chromium 拒
  （本机实测 `fs.openSync`/`copyFileSync` 均 `EBUSY`，`DatabaseSync(readOnly)`/`?immutable=1` 均
  `ERR_SQLITE_ERROR`），所以阶梯是“普通打开 → 借句柄快照 → 仍不成才报 busy”。
  实现完全部靠公开 Win32 语义自己写（不抄任何无 license 仓的代码）：
  `NtQuerySystemInformation(SystemExtendedHandleInformation=64)` → `CreateToolhelp32Snapshot` 找目标 PID →
  `OpenProcess(PROCESS_QUERY_INFORMATION)` → `DuplicateHandle(DUPLICATE_SAME_ACCESS)` →
  `GetFinalPathNameByHandleW` 比路径 → `SetFilePointerEx`+`ReadFile` 分块读 → 落临时库后用同一个
  `statCookies` 解析。两个实测坑已写进代码注释：`szExeFile` 只是**映像基名**（比目录永远不匹配）；
  `OpenProcess` 用 `PROCESS_DUP_HANDLE(0x20)` 或 `PROCESS_QUERY_LIMITED_INFORMATION(0x1000)` 会被
  `ERROR_ACCESS_DENIED` 拒，**0x40 才可用**（0x400|0x1000 互斥混传也不行）。
  约束：只读；非 win32 不尝试；快照带 `snapshot:true` 开新词 `cookieLiveSnapshot` 明说非实时；
  每 PID 只 OpenProcess 一次、命中即返、默认预算 2 万次/1200ms（超则 `scan-budget`）；
  同一库 60s 复用、失败也隔 5s；koffi 只从宿主自带位置解析（`DSH_KOFFI_PATH` 可覆盖），找不到就当能力不存在。
  同时修正一个误引导：`not-found` 与 `permission` 不再共用“被 Chromium 独占”那一句
  （新词 `cookieMissing` / `cookiePermission`，9 语）。


## 0.2.0 (2026-11-04)

profile patch 结构化体检与一键修复（面板 + 命令 + CLI），并修一个已发布的 P0。

- **P0 修复**：`/cookie-cleaner` 原来返回 `{kind:'text'}`，而宿主在命令注册边界硬校验
  `CommandResult`（`interaction/commands/src/index.ts:228-255`，只认 `success|error`），
  导致**每次调用都报错**。旧测试只记返回值、从不校契约（桩把产品的错当契约背了下来）；
  现在返回体改对，并由 `tests/command-contract.test.js` 把宿主规则逐路径钉住。
- **判定去噪（无差异就只说「注入正常」）**：
  - P5 只在**证明确实丢了值**时报——拿运行态对拍 bundle 层，同值即未丢；两边都没内容（`{}` 对缺省）
    也未丢（真机噪声源：`webserver.tls` 这类 schema 默认键曾被无脑报成「有偏差」）；表达式键被丢仍报，
    因为无法用字面量证明等价。
  - P9（bundle 层是 `!!js`、覆盖层给了字面量）**不再进体检结论**，只留在 `row.exprFrozen`：我们无权求值
    那个表达式，「以后上游变了不跟」是假想后果而不是现状故障（`host`/`trustedHosts` 这种当前同值的不再刷成偏差）。
    它只在 `patch plan` 的处方里提一句，并附动作（把 `guardMode` 切到 `expression` 再跑一次就能拿到跟随形态）。
    P8 措辞也不再猜部署场景（原“LAN 部署会被钉死”、“两实例撞端口”对纯回环 desktop 不成立），
    改为只陈述实测事实：“现在生效的就是你钉的值，启动层传来的 `--port` 压不动它”。
- **端口可在面板调（新动作「应用端口」）**：为避开代理工具常用端口，面板/`patch port <n>`
  会把 webserver 行的 `port` 改写为**表达式**而非字面量，统一形式 `ctx.webStartup.port ?? +<你填的数>`
  （`??` 只在启动层未传端口时兜底，`+` 把回落值显式转数字，防 `webStartup.port` 为字符串形态时
  `z.natural()` 报 expected number；已有表达式则只换末尾数字并补 `+`），所以 `--port` 仍优先。插件**不预填也不内置任何默认端口**（`guardPort` 默认 0=未设定，
  非法/未给一律拒写；src 里出现端口常量会被测试扫出来）。写前用 `net.connect` 探针查目标端口
  是否已被占（占用就不写）；写后“监听到底在哪个端口”也由探针回答（分热生效/下次启动/无据三档）。
  **常驻警告**（`portSwitchWarn`，9 语）：端口热生效会立即把旧端口的当前页面踢下线，
  必须马上用新端口地址重新访问/重启，server 与 browser 端口号要同步（否则把自己锁在门外）。
  快照改为按行存放（`patch-snapshot--<profile>.json` 的 `rows.{connection,webserver}`，兼容旧单行），
  一次回滚把两行各自退回前值。
  - 结构无差异时面板/命令/CLI 只给一句肯定结论：**「补丁设置注入正常：覆盖行已被宿主采纳，键集与运行态一致」**
    （新词 `injectOk`，9 语），不再逐行刷「结构健康」、也不提示「下一步点修复」。
- **判定内核 `src/patch-model.js`**（纯函数、零 IO，由 eslint `no-restricted-imports` 钉）：
  P1 缺覆盖行 / P2 name 不匹配（整行静默跳过）/ P3 偏档 / P4 非法值（不得试写）/
  P5 丢键（浅赋值整块替换，落回 schema 默认）/ P6 home-overlay 影子 / P7 文件值≠运行值 /
  P8 `port` 字面量夺走 `--port` 旗标权 / P10 未知 id / P11 整层 YAML 非法 / P12 嵌套事务可重试。
  依据：`cordis-plugin-include/src/index.ts:120-123`、`app-boot/src/profile-context.ts:63-70`、
  `boot/cmdline/src/index.ts:12-15`、`host/webserver/src/index.ts:64`、`client/connection/src/index.ts:113`。
- **写路径只走官方 `configEditor`**（`boot/config-editor/src/index.ts:87-154`）：文件锁 +
  目标插件 Config schema 校验 + home 影子检查 + 原子写 + reconcile 失败自动回滚。
  不再自建 `.bak`、不自己拼 YAML；实测往返**保留值的既有形态**（字面量仍字面量、
  `{__jsExpr}` 仍 `!!js`），所以“用户改过的 port 不刷”由机制保证。单层快照支持 revert。
- **热生效**：HMR 本就 watch profile/home 两级 patch 文件（`boot/hmr/src/index.ts:215,235`），
  写完不重启；在 `apply()` 链上直接写会报 `HMR transactions cannot be nested`，
  因此写只在用户触发的回调链上，并自动退避重试一次。
- **CLI 只读**（`src/patch-read.js` + `patch check|plan`）：手写子集解析器，只读到
  顶层行/字段/config 键这一深度，更深的嵌套一律计 `skippedDeep` 并跳过而不是误判；
  子集外形状（多文档/锚点/行内 flow 映射）一律降级。**CLI 不写 profile**，避免第二把写刀。
- **CLI 无据档**：`patch check --profile <不存在的名字>` 不再把「文件读不到」当成「没这一行」
  （那会编出一条误导的 cookie 异常，又因 warn→0 把「什么都没读到」洗成退出码 0）；
  目录都不在 → `skipped` + 「该 profile 不存在，无据可判」+ 退出码 1；目录在、仅文件缺仍判 P1。
- **审计行无据不伪装**：修复前还没有 connection 覆盖行时，卡片不再说「修复前 ?」，
  而说「此前无覆盖行 → 现在 N 天」（新词 `auditLineNew`，9 语；`beforeDays` 缺失走独立分支）。
- **快照按 profile 隔离**（`patch-snapshot--<profile>.json`）：原先是 `<dsh home>/cookie-cleaner/patch-snapshot.json`
  全局单文件，真机串台过一次——隔离格那次修复的「上次修复」出现在了用户真实 profile 的卡片上，
  更糟的是在另一个 profile 点「回滚」会把**别人的**旧 config 写进来。旧全局快照不再读。
- **浏览器半（首次）**：`src/client/` + tsdown 构建 `lib/client.js`；注册 id = npm 包名
  （`client/modules/src/index.ts:1040` 按 `graphRow(packageName,…)` 建图），插件级 inject 只声明
  `slots`+`locale`（代际互斥服务不进插件级列表），两个席位各自 `safe()` 包裹。
  卡片本地渲染 9 语（宿主只回 `{code, params}`），颜色全走 `--dsw-*` 主题令牌。
- **门禁**：`gate` 加入 `typecheck`(tsc) 与 `build`；`prepack = build && gate`；新增
  `tests/client-bundle.test.js` 钉住装载契约（platform=web / exports['./client'] / files 含 lib /
  react 不得内联）与两半 URL 同串。本轮 131 测试 / 130 pass / 0 fail / 1 跳过（POSIX-only）。
- 9 语：`locale/*.json` 市场卡描述补上体检/修复语义；新增 `src/locales-patch.js`（12 判定码 × 9 语）
  与 `src/client/locales.ts`（23 chrome 键 × 9 语），`tests/locales-patch.test.js` 机械核对九格齐备、
  占位符一致、拉丁语系无汉字假名（韩文谚文不算漏翻）。

## 0.1.2 (2026-11-04)

装载身份与兼容性闸门修复（为后续 client 面板做准备）。

- `dsh.plugin.json#id`：`dsh-external/dsh-cookie-cleaner` → `dsh-cookie-cleaner`（= 包名）。
  挂载 id 不等于包名时 client 半从不加载（VD-017-020-06），不修则以后加面板必定白做。
- `peerDependencies` 补 `@deepseek-ai/dsh-client-ui-renderer`（optional）。兼容性闸门
  **只读 `@deepseek-ai/dsh`/`dsh-*` 前缀的 peer range**，不读 `engines.dsh`：0.1.0/0.1.1 一个
  `dsh*` peer 都没有 → 对所有宿主线恒判兼容，宿主换代时不会干净拒载，而是装载后
  运行期报错。现由 `scripts/sync-hosts.mjs` 从 `scripts/hosts.mjs` 单源下发，与 `engines.dsh` 逐串相同。
- 门禁：双清单校验加入 renderer peer 一项；新测试钉住「manifest.id = 包名」与
  「至少有一个 `@deepseek-ai/dsh*` peer，且 renderer peer 与 engines.dsh 同串」。

## 0.1.1 (2026-11-04)

跨平台支持（macOS / Linux）与 9 语分发。

- **失败归因重写**：实测 `node:sqlite` 在 POSIX 权限不足时只报
  `ERR_SQLITE_ERROR: unable to open database file`，**不给 EACCES**——原先按错误码分档
  的实现永远走不到权限档，会把「读不了」误报成「客户端在跑」。改为主动探测四档：
  `missing`（文件不在）/ `unreadable`（读不了）/ `not-owned`（属别人）/ `busy`（真占用），
  每档给各自的处置文案，`classifyOpenFailure` 导出且可注入以便测试。
- **POSIX 平台分叉**：路径推导按目标平台选 `path.win32`/`path.posix`（此前在 Windows 上
  会把 posix 路径写成反斜杠）；macOS 走 `~/Library/Application Support`，Linux 尊重
  `XDG_CONFIG_HOME`/`HOME`；`DSH_COOKIE_DB` 直接当首选候选，不再拆根重组；
  退出指引按平台出文案（Linux/mac 不再提「托盘」）。
- **备份带走 WAL**：POSIX 上 Chromium 用 WAL，只拷主文件是个残副本；现在把
  `-wal`/`-shm`/`-journal` 一并复制并在输出里注明。sidecar 拷不上只记为跳过（`-shm`
  只是可再生的一致性索引），不再让单个 sidecar 被锁导致整单清理失败。
- **退出码改黑名单**：此前 `missing` 档会退出 0（把失败报成成功）；现在只有真读到内容
  的档位才返回 0。
- **9 语分发**：`locale/<lang>.json`（en 为锚，宿主市场卡）+ 运行时文案字典
  （zh 为键集真理源，`registerDictionary` 装载时机械核对缺键/多键/占位符）；
  语言优先级 `--lang` > `DSH_COOKIE_LANG`/`DSH_LANG` > `LC_ALL`/`LANG` > 系统 locale > zh，
  `C.UTF-8`/`POSIX` 中性 locale 判为英文。新增 `lang` 设置项。
- 测试：`gate` 增 `gen-locales --check`；POSIX `chmod 000` 归因用例在 Windows 自动 skip，
  已在 WSL（node 24）59/59 跑绿；CLI 用例钉死语言，不再随宿主 locale 漂移。

## 0.1.0 (2026-11-04)

- 首版：只读播报 + 包内独立清理脚本。
- `src/core.js`：cookie 库定位（win/mac/linux 惯例 + `DSH_USER_DATA` / `DSH_COOKIE_DB` / `--db` 覆盖）、
  只读统计（条数/过期数/host_key 分布/过期跨度）、`BEGIN IMMEDIATE` 独占写锁闸、
  `.bak` 备份 + 原子事务删除 + VACUUM，表结构自检不过即拒绝写入。
- `src/cli.js`（npm bin `dsh-cookie-cleaner`）：`--clean` / `--expired-only` / `--dry-run` / `--no-backup` / `--no-vacuum` / `--db`。
- `src/index.js`：`/cookie-cleaner` 命令（只读，输出可直接复制的清理命令）+ 三代设置 waist + `volatile` 配置面。
- 关键事实入档：客户端运行期该库被 Chromium 独占，宿主插件无法在启动时清理；
  因此写盘只可能落在客户端退出后的独立脚本里（本机 0.2.1-rc.5 实测）。
