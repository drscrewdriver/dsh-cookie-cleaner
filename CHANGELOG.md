# Changelog

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
