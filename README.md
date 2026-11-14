# dsh-cookie-cleaner

清理 DSH（DeepSeek Harness）**桌面客户端** cookie 库里堆积的本地登录凭据 cookie（`dsh-auth-*`），
解决的现象是启动报 `desktop welcome: Web authentication failed`（HTTP 431，约 70 次随机端口启动后必现，见下文因果链），
并把「为什么**直连 SQLite 那条清理路径**只能在客户端关闭时进行」讲清楚——不用每次再去问一遍 AI。

**两条互补路径，本插件都提供**：① **运行期守护**（可选，`runtimeGuard` 默认关）——抬监听器头部预算，
并在握手响应里下发 `Set-Cookie Max-Age=0` 让浏览器自己退休陈旧 cookie，**不碰 SQLite、客户端不用关**；
② **离线整清**（`--clean`）——客户端完全退出后直连 SQLite 一次性删干净，覆盖“已被 431 锁死 / 换 profile”这类急救场景。

输出支持 9 种语言（zh / en / ja / ko / fr / de / it / ru / es），跟随系统 locale。

## 它是什么 / 为什么长这样

桌面客户端每次启动都会在 Electron 的 cookie 库里留下一条
`dsh-auth-<base64url(sha256(host:port))>`。名字按 **host:port** 哈希，端口一变就多一条，
各带 30 天有效期，于是历史记录长期堆积。

这些记录**不影响登录**，也**不涉及账号凭据**：

- 主窗口的 HTTP/WS 请求走内存态凭据（宿主换发后由桌面层直接注入请求头），不经 cookie jar；
- 鉴权只按当前 authority 派生的**那一个名字**取值，其余同名前缀条目本就永远读不到；
- 每次启动都会用 launch token 重新换发。

**关键约束（Windows 与 Linux 实测过 busy 与权限两种形态）**：`Network/Cookies` 这块 SQLite 在客户端运行期间**常常**被 Chromium 独占打不开，
而宿主插件跑在 Electron 的纯 Node 模式子进程里也拿不到 `session.cookies`。所以**直连 SQLite 的写盘路径**只能在客户端已完全退出时跑：

> **本仓库插件半的离线写盘动作不可能由「插件在启动时」完成**——它只能发生在客户端已完全退出的时间窗里，
> 而那个时刻宿主插件本身并不存在。因此离线执行体是**包内独立脚本**（`src/cli.js`），
> 插件半默认只做只读播报和命令指引，**永不直连 SQLite 写库**。
>
> **但运行期守护走的不是 SQLite，而是 HTTP**：宿主在自己跟浏览器的握手上发 `Set-Cookie: dsh-auth-<hash>=; Max-Age=0; Path=/`，
> 让**浏览器自己**把陈旧启动 cookie 从 jar 与磁盘库删掉，插件不打开那个文件。
> 这层**可选**（`runtimeGuard`，默认关），开启后仍不碰 `Network/Cookies`；
> 详见 [运行期守护](#运行期守护可选)。
>
> 读数不是这样：面板与命令面会先尝试只读打开（`readOnly`），打开成功就给实时值
> （条数 / 请求头字节 / 占用百分比 / 距 431 还剩多少），打不开才明说读不到。
> 两者不拿同一个结论互相绑死：读不到之时的 busy 分支仍然保留，但不再当成必然。

堆积的根源是「每次启动一个随机端口」，而上游已有三份独立报告钉到同一条因果链
（[#11366](https://github.com/deepseek-ai/deepseek-harness/discussions/11366)、
[#11410](https://github.com/deepseek-ai/deepseek-harness/discussions/11410)、
[#11650](https://github.com/deepseek-ai/deepseek-harness/discussions/11650)，约 70 次启动后必现 HTTP 431）。
它们给出的两条用户侧规避里，**调小 `connection.cookieMaxAgeDays` 是面板「修复」真正写的那一项**；
固定 `webserver.port` 属于启动行为面，只保留在命令面（面板不提供端口控件）。
完整关联见该章的
[为什么要固定端口](#为什么要固定端口上游三条-discussion-是同一条因果链)。

## 各平台的库位置与退出方式

| 平台 | cookie 库默认位置 | 完全退出客户端的方式 |
|---|---|---|
| **Windows** | `%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies` | 托盘图标 → 退出；确认任务管理器里没有 `DeepSeek Harness` |
| **macOS** | `~/Library/Application Support/@deepseek-ai/dsh-desktop/Network/Cookies` | `Cmd+Q` 或菜单 → Quit；Dock 图标消失**不等于**已退出，用 `ps aux \| grep -i deepseek` 确认 |
| **Linux** | `~/.config/@deepseek-ai/dsh-desktop/Network/Cookies`（`XDG_CONFIG_HOME` 优先） | 关闭主窗口后用 `pgrep -af 'DeepSeek Harness\|dsh-desktop'` 确认没有残留 |

更早的 Chromium 布局把库直接放在 `<userData>/Cookies`（不带 `Network/`），工具两种都会试。
位置不对时用 `--db=<完整路径>`，或设 `DSH_USER_DATA` / `DSH_COOKIE_DB` 环境变量。
flatpak / snap 安装的客户端路径在常规位置之外，通常需要 `--db` 手动指。

## 运行期读数：借宿主自己已打开的句柄（仅 Windows）

客户端在跑时，`Network\Cookies` 被 Chromium 以**不给共享读**的方式开着。本机实测：
`fs.openSync('r')`、`copyFileSync`、`DatabaseSync(readOnly)`、`?immutable=1` 全部失败（`EBUSY` /
`ERR_SQLITE_ERROR`）。但目标进程自己手里就有一个可用句柄，于是读数阶梯是：

```
普通只读打开 → 成功就是实时值
           → busy 且是 win32 → 借句柄快照（NtQuerySystemInformation 枚举 → OpenProcess → DuplicateHandle → ReadFile）
                          → 还是不成 → 诚实地说读不到（绝不把“没读到”洗成 0 条）
```

边界与代价，全部写清楚：

- **只读**：不写、不改共享模式、只关自己 dup 出来的那份句柄；
- **仅 Windows**：非 win32 直接走 busy 档（不尝试任何原生调用）；
- **快照不是实时**：借来的结果带 `snapshot:true`，面板单独一句「快照读数（借宿主句柄，非实时）」；
- **只在宿主进程内有效**：目标进程靠“与自身同一镜像名 + 父进程”识别，所以插件在桌面端里能命中；
  独立跑 CLI 时镜像名不同，会诚实回到 busy（要数字就关客户端再跑）；
- **有预算**：每个 PID 只 `OpenProcess` 一次、命中即返、默认上限 2 万次尝试 / 1200ms，超了就报
  `scan-budget`；同一库 60 秒内复用上次快照结果，失败也至少隔 5 秒再试；
- **不新增依赖**：复用宿主自带的 `koffi`（扫安装位置解析，可用 `DSH_KOFFI_PATH` 指定），
  找不到就当能力不存在，不报错不阻断其他功能。

## 安装

分两半，各装各的：

### ① 插件半（`/cookie-cleaner` 命令 + 面板卡片 + 设置项）

DSH Desktop 的 profile 由**客户端独占管理**，命令行
`dsh plugin --profile desktop add` **会被硬拒**
（`profile "desktop" is managed exclusively by the Electron application`），
连 `dsh --profile desktop --dump-config`（boot 期检查）都被同一闸拦下——**不要走这条路**。
正确装法二选一：

- **推荐 · GUI 装**：客户端里 → 插件管理 → 搜 `dsh-cookie-cleaner` → 安装；重启客户端生效。
- **手动 · CLI 装**（客户端**已完全退出**，`Get-Process | ? ProcessName -match 'DeepSeek|dsh'` 为空再动，
  避开文件锁；agent 若跑在 Qoder 而非 DSH 内，关闭 desktop 不影响会话）：

  ```powershell
  # Windows · 已发 npm 版：走 registry
  pnpm --dir "$env:USERPROFILE\.dsh\profiles\desktop" add dsh-cookie-cleaner

  # Windows · 未发 npm 的本地 tgz：走 file:（file: 依赖通常不受 minimumReleaseAgeExclude 发布年龄闸约束）
  pnpm --dir "$env:USERPROFILE\.dsh\profiles\desktop" add file:E:\path\to\dsh-cookie-cleaner-0.2.1.tgz
  ```

  ```shell
  # macOS / Linux
  pnpm --dir ~/.dsh/profiles/desktop add dsh-cookie-cleaner
  # 本地未发版：pnpm --dir ~/.dsh/profiles/desktop add file:/path/to/dsh-cookie-cleaner-0.2.1.tgz
  ```

  **首次挂载**要手动把包名 `dsh-cookie-cleaner` 追加到 profile `package.json` 里的 `dsh.profile.bundles` 数组，
  否则 bundle 不会被装载；**升级同一包不需要**再动（数组已含）。改完重启客户端生效。

  > 改 profile 目录里的 YAML/JSON（工作区之外）建议用 Node 脚本读写、UTF-8 无 BOM，
  > pwsh `Set-Content` 默认带 BOM 会卡住 YAML 校验。装前务必备份
  > `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `cordis.patch.yml`。
  > `cordis.patch.yml` 含自定义标签 `!<tag:yaml.org,2002:js>`（把 `port ?? 34568` 这类当 JS 求值），
  > **校验结构要用 `yaml` 包（`parseAllDocuments`）而不是 `js-yaml` 严格 `load`**，
  > 后者会在自定义标签处误报 unknown tag。desktop profile 有 300+ 插件，
  > `pnpm peers check` 的 peer WARN 多为既有噪声，按包名过滤确认自家包无关即可。

### ② CLI 清理工具半（客户端**关闭时**独立跑的清理脚本）

清理动作只能发生在客户端已完全退出的时间窗，所以工具与插件装载解耦。任选其一：

```shell
# A. 全局安装：拿到全局命令 `dsh-cookie-cleaner`（与插件半无关，不装 profile 也能跑）
npm i -g dsh-cookie-cleaner

# B. 不装全局：走 profile 别名或包内脚本
# Windows（插件半已装进 profile 后可用）
%USERPROFILE%\.dsh\profiles\desktop\node_modules\.bin\dsh-cookie-cleaner.cmd --clean
# macOS / Linux
~/.dsh/profiles/desktop/node_modules/.bin/dsh-cookie-cleaner --clean
node ~/.dsh/profiles/desktop/node_modules/dsh-cookie-cleaner/src/cli.js --clean
```

> **两半互不依赖**：只做清理不需要插件半；只跑 `/cookie-cleaner` 播报不需要全局命令。

别名路径速查（走 profile 里的 `.bin` 时）：

```shell
# Windows
%USERPROFILE%\.dsh\profiles\desktop\node_modules\.bin\dsh-cookie-cleaner.cmd
# macOS / Linux
~/.dsh/profiles/desktop/node_modules/.bin/dsh-cookie-cleaner
```

## 用法

```text
dsh-cookie-cleaner                        查看现状：库在哪、多少条 dsh-auth-*、多少已过期
dsh-cookie-cleaner --clean                删除回环域(127.0.0.1/localhost/[::1])下全部 dsh-auth-*
dsh-cookie-cleaner --clean --expired-only 保守档：只删已过期的
dsh-cookie-cleaner --clean --older-than=24 只删创建超过 N 小时的（按 creation_utc，可小数如 0.5=30 分钟）
dsh-cookie-cleaner --clean --dry-run      只看会删几条，不写盘
dsh-cookie-cleaner --db=<完整路径>         手动指定 cookie 库
dsh-cookie-cleaner --lang=de              指定输出语言（缺省跟随系统 locale）
```

退出码：`0` 成功；`1` 失败（被占用 / 无权限 / 找不到 / 参数非法）。

### Windows

```powershell
# 1) 先退出客户端（托盘 → 退出），确认没有残留进程
Get-Process | Where-Object { $_.ProcessName -match 'DeepSeek|dsh' }

# 2) 试跑再实删
dsh-cookie-cleaner --clean --dry-run
dsh-cookie-cleaner --clean
```

### macOS

```shell
# 1) Cmd+Q 退出后确认
ps aux | grep -i '[D]eepSeek Harness'

# 2) 试跑再实删
dsh-cookie-cleaner --clean --dry-run
dsh-cookie-cleaner --clean

# 没装全局命令时：
node ~/.dsh/profiles/desktop/node_modules/dsh-cookie-cleaner/src/cli.js --clean
```

### Linux

```shell
# 1) 关闭主窗口后确认
pgrep -af 'DeepSeek Harness|dsh-desktop'

# 2) 试跑再实删
dsh-cookie-cleaner --clean --dry-run
dsh-cookie-cleaner --clean

# 只删已过期的：
dsh-cookie-cleaner --clean --expired-only
```

### 成功输出长这样

```
Deleted 3 dsh-auth-* entries (all)
  Database: ~/.config/@deepseek-ai/dsh-desktop/Network/Cookies  20480 B → 8192 B
  Backup: ~/.config/@deepseek-ai/dsh-desktop/Network/Cookies.bak-20261104-061512 (incl. -wal, -shm)
  Account credentials, sessions and plugin configuration were not touched; the local cookie is re-issued on next start.
```

## 安全设计

- **独占写锁即闸门**——`BEGIN IMMEDIATE` 拿不到就拒绝执行并给出对应档位的处置文案；
- **失败归因不猜错误码**：实测 `node:sqlite` 在 POSIX 权限不足时只报
  `unable to open database file`（不给 EACCES），所以工具自己探文件——
  不存在 / 读不了 / 属于别人 / 被占用，四档各说各话，不会一律让你「去关客户端」；
- 写盘前先拷 `.bak-<时间戳>`，**主库副本失败即整单放弃**（全有或全无）；
  `-wal`/`-shm`/`-journal` sidecar 一并带走（POSIX 用 WAL，只拷主文件是个残副本），
  但 sidecar 拷不上只记为跳过，不拦停清理；
- 删除语句只由 `host_key` 白名单 + 名称前缀构成，两者都过字符校验，时间戳走 BigInt 绑定参数；
- 表结构自检：库里没有 `cookies` 表或缺关键列，一律拒绝，绝不对未知库执行写语句。

Node ≥ 22.19（用到 `node:sqlite`；Electron 44 内置的 Node 24 亦可）。
Node 22 上会有一条 `ExperimentalWarning: SQLite`，可用 `node --no-warnings` 消掉。

## 语言

优先级：`--lang` > `DSH_COOKIE_LANG` / `DSH_LANG` > `LC_ALL` / `LC_MESSAGES` / `LANG` > 系统 locale > `zh`。
`LANG=C.UTF-8` / `POSIX` 这类中性 locale 判为英文（Linux 上很常见，不该给你看中文）。
认不出的语言落 `zh`，不会因此报错。插件侧同一套字典，可用设置项 `lang` 钉住。

## 插件面

- 命令 `/cookie-cleaner` `[status|clean]`：**只读**。输出当前统计 + 可直接复制执行的清理命令。
- 命令 `/cookie-cleaner patch` `[check|fix|revert|plan]`：体检 / 修复 profile 的 `cordis.patch.yml` 结构。
- 设置 `dsh-cookie-cleaner`：`userDataRoot`（覆盖 Electron userData 根）、`expiredOnly`（保守档措辞）、
  `lang`（钉住输出语言，留空=自动探测）、`guardDays`（cookie 寿命目标档，修复按钮写这个值）、
  `guardMode`（`literal` 只动目标键 / `expression` 同时把 bundle 层的 `!!js` 表达式还原回去）、
  `runtimeGuard`（运行期守护开关，默认关）、`maxHeaderBytes`（守护抬升的头部预算，默认 64 KiB）、
  `keep`（守护保留的尾部 cookie 条数，默认 4）、`retireAbove`（阈值触发：条目数 > 此值才退休，默认 0=不设阈值）。启运行期守护的细节见 [运行期守护（可选）](#运行期守护可选)。
- 浏览器卡片：设置页顶级节「Cookie 清理器」与插件页配置卡各一处，三个按钮（体检 / 修复 / 回滚）。

## profile patch 体检与修复

cookie 会不会堆积，取决于 profile 的 `cordis.patch.yml` 里那两行写得对不对。这个面板把
「对不对」变成机器判定，并提供一键修复：

| 按钮 | 做什么 | 落在哪 |
|---|---|---|
| 体检 | 只读：列出每条判定（P1-P12）与档位 | — |
| 修复 | 走宿主官方 `configEditor` 写 `connection` 行 | 写前经该插件自己的 Config schema 校验，失败自动回滚 |
| 回滚 | 回到修复前的配置 | 单层快照（修复成功时才留） |

命令行等价物（无 UI 也能做同样的事）：

```powershell
/cookie-cleaner patch check      # 宿主内命令，能修
node src/cli.js patch check      # 离线只读（客户端关着也能跑）
node src/cli.js patch plan       # 输出可直接粘贴的覆盖行
```

离线档只看得到文件层：运行态与 bundle 层的对比（P5/P7/P9）需要客户端起来后由面板或
`/cookie-cleaner patch check` 来查。**CLI 一律不写 profile**——写只有一把刀，就是宿主那个带校验与回滚的。

### 为什么要固定端口：上游三条 discussion 是同一条因果链

桌面宿主每次启动都用**随机端口**：`apps/desktop-host/src/index.ts` 里 host 的启动参数是
`['--no-open', '--host', '127.0.0.1', '--port', '0']`。而认证 cookie 的名字是
`dsh-auth-` + base64url(sha256(authority))，http 下 authority 取 `url.host`（**含端口**），
见 `packages/client/connection/src/browser-auth.ts:79-84,117`。RFC 6265 里 cookie 不按端口隔离，
所以 127.0.0.1 下所有历史端口的 `dsh-auth-*` 会被一并发送；写入带 `Max-Age`，默认
`cookieMaxAgeDays = 30`，mint 路径上**没有任何删除逻辑**（同文件 :138）。

这是一条能算出来的定时炸弹：单条约 229 B，Node 默认 `--max-http-header-size` 是 16384，
`16384 / 229 ≈ 71.5` → **约 70 次启动后必然失败**。失败落在启动第二步：第一步
`authenticateWebHost` 走 undici（不带 jar）永远拿到 303，第二步 `connectDesktopWelcome` 走
Electron `net.fetch`（带 jar）把 71 条全带上 → 服务端 431 → 被 `if (!response.ok)` 归因成
`desktop welcome: Web authentication failed`。重装无效（cookie 存在 Application Support 下），
与第三方插件无关，rc.2 → rc.5 认证路径源码未变。

同一根因的三份独立报告（跨 Windows / macOS，跨 rc.2 / rc.3 / rc.5）：

| discussion | 侧重 | 给出的用户侧规避 |
|---|---|---|
| [#11366](https://github.com/deepseek-ai/deepseek-harness/discussions/11366) | 首发：71 条 / 16,188 B 现场 + 4 行客户端清理补丁的前后对照 | 删 `Cookies` 文件（有数约顶 70 次启动） |
| [#11410](https://github.com/deepseek-ai/deepseek-harness/discussions/11410) | 把规避落到**配置层**：profile patch 固定 `webserver.port` → authority 恒定 → cookie 由 71 条降为 1 条（已验证） | 固定端口 |
| [#11650](https://github.com/deepseek-ai/deepseek-harness/discussions/11650) | 补上代码级根因与阈值公式；另一条规避是把 `connection.cookieMaxAgeDays` 调小（3 天 → 稳定态约 15 条 / 3.4 KB，已验证） | 调小 cookie 寿命 |

**两条规避里只有一条能被安全自动化**：#11650 动的 `connection` 行（cookie 寿命）由「修复」写入；
#11410 动的 `webserver` 行（端口）**只参与只读判定**，本工具不替你改。手改 profile 里那几千行 YAML
很容易踩两个坑，而这两个坑在本插件里都有编号：

- **浅赋值**：#11650 自己就提醒「patch 对 `config` 是整体替换而不是深合并，所以 `trustedHosts`
  必须跟着写全」——漏键会落回 schema 默认（P5），把 bundle 层的 `!!js` 表达式抄成字面量则不再跟随（P9）；
- **字面量端口会夺走 `--port`**：#11410 的规避写的是 `port: 34567` 字面量，代价是启动旗标失效（P8，
  本机实测：传 `--port 4200` 仍起在钉住的端口）。

所以固定端口那条规避应该写成表达式形式 `ctx.webStartup.port ?? +<你选的数>`：authority 恒定（cookie
不再按端口累积）与 `--port` 优先，两者都要。**这一行由你自己写进 profile，本工具不代写**（见下一节）。

一句边界：这是**诊断与规避层**，不是根治。真正的修法在上游（cookie 用固定名 / mint 时清理 / welcome
复用第一步已拿到的 cookie 头 / 报错带上状态码）；上游修好后，本面板的价值退化为「检查你 profile 里
那两行还写不写得对」。

### 端口：本插件不写（只保留只读判定 P8）

`port` 钉成字面量会让 `--port` 旗标失效（启动层传来的端口压不动它），那是**启动行为**决策，
不在本工具职责内。2026-11-05 裁决把端口写入能力**整体删除**：

- 面板没有端口输入框与按钮；命令面没有 `patch port` 子命令；HTTP 没有 `/api/.../patch/port` 写端点
  （没人调的写端点只是攻击面）；设置项 `guardPort` 也已删——插件不代用户存默认端口。
- 保留的是**只读判定**：`webserver.port` 被写成字面量时仍报 P8，并说明「现在生效的就是你钉的值，
  启动层传来的 `--port` 压不动它」——**看到但不替你改**。
- 要固定端口就按 [#11410](https://github.com/deepseek-ai/deepseek-harness/discussions/11410) 自己写进
  profile，推荐表达式形式 `ctx.webStartup.port ?? +<你的数>`（保住 `--port` 旗标权）；
  `patch plan` 输出的粘贴块也不会替你动 `webserver` 行。

本插件能替你做的只有一件：把 `connection.cookieMaxAgeDays` 写到你定的目标档（可回滚）。

### patch 语义速记（判定从这三条来）

1. **浅赋值整块替换**：patch 行按顶层键赋值（`cordis-plugin-include/src/index.ts:120-123`），
   所以 `config:` 是整块替换。漏写的键落回该插件的 **schema 默认**，不是 bundle 层的值
   （`webserver.compression` 默认就是 `none`）——这就是覆盖行要写全键的原因。
2. **name 不匹配 = 整行静默跳过**：只在启动日志留一行 warn，UI 毫无信号。这是
   「配了但没生效」的头号成因（P2）。
3. **层顺序**：bundle layers → profile → **home**（`~/.dsh/cordis.patch.yml`）→ `--patch` 覆盖。
   home 在 profile 之后应用，所以 home 里同 id 行会盖掉 profile 的写（P6）。

另两条踩过的坑：裸 `- id: <不存在的 id>` 会被静默跳过（新增行必须用 `- insert:`，P10）；
模板根是 flow 形式的 `[]`，在它后面直接追分块行会让**整层** YAML 失效（P11）。

### 档位与噪声口径（什么时候说什么）

- **ok**：覆盖行已被宿主采纳且键集与运行态一致 → 只说一句「补丁设置注入正常」，不逐行刷档位。
- **warn / fail**：只报**能用数据证明**的偏差。丢键（P5）要求运行态与 bundle 层不同值、且至少一边真有内容
  才算丢了（`{}` 对缺省这种形式差异不是丢；默认键的缺席也不是）；`--port` 被字面量夺走旗标权（P8）
  实测复现过，保留（它只说明“现在生效的就是你钉的这个值”，不猜你打算怎么部署）。
- **表达式被抄成字面量（P9）不在体检里刷屏**：插件无权求值那个表达式，「以后上游变了不跟」是假想后果
  而不是现状故障，所以它不改档位也不开修复按钮，只在 `patch plan` 的处方里说一句（并告诉你把 `guardMode`
  切到 `expression` 就能拿到跟随形态的粘贴块）。
- **skipped**：无据（宿主没有 configEditor、profile 目录都不存在、cookie 库被 Chromium 独占）——
  中性陈述，绝不冒充异常，也不参与聚合。

### 为什么改完不用重启

HMR 监视 profile 与 home 两级 patch 文件并热 reconcile（`packages/boot/hmr/src/index.ts:215,235`），
写完几秒内 `effective` 就跟上新值。若正逢热重载，`configEditor` 会拒一次嵌套事务，
本工具自动退避重试一次，仍失败就提示「稍后再点」而不是谎报成功。

## 开发与发版

```shell
npm run sync-hosts    # 把 scripts/hosts.mjs 的宿主线刷进双清单
npm run gen-locales   # 由 scripts/gen-locales.mjs 的表生成 locale/*.json（9 语）
npm run gate          # 双清单 check + locale check + eslint + 全部测试
npm run prepack       # 发布前自动跑 gate
```

跨平台验证：测试套件同时要求在 Windows 与 Linux（含 `chmod 000` 归因用例，
在 Windows 上自动 skip）跑绿；POSIX 语义在 WSL/原生 Linux 实测过。

## 运行期守护（可选）

默认关。开了以后，插件在宿主 `webServer` 就绪时挂两层防御，**全程只走 HTTP，不打开 `Network/Cookies`**：

| 层 | 行为 | 默认值 |
|---|---|---|
| 头部预算 | 抬 `server.maxHeaderSize`（Node 每 accept 新连接时才读该属性，运行时赋值对新连接当场生效）| `maxHeaderBytes: 65536`（夹到 16 KiB – 1 MiB）|
| 退休旧 cookie | 每个请求只读 Cookie 头里的**名字**（`dsh-auth-<43 base64url>`），保留尾部 `keep` 条 + 当前端口那一条，其余 `Set-Cookie Max-Age=0; Path=/` 从浏览器 jar 删除（每响应最多 96 条，约 12 KiB）| `keep: 4`（夹到 1 – 64）|
| 触发阈值 | 启动 cookie 条数 **> `retireAbove`** 才开始退休（≤ 阈值时完全不动、不发 Set-Cookie）；`0` = 不设阈值（每次按 keep 收敛）| `retireAbove: 0`（夹到 0 – 10000）|

### 为什么两层都要

- **只抬预算**：约 350 次启动后依旧撞墙，只是把 72 次变成 350 次；
- **只清理而不抬预算**：431 在 Node 的 HTTP 解析层就被拒了，请求根本进不到 `'request'` 事件，清理逻辑跑不到。

### 怎么开

**面板（推荐）**：设置页「Cookie 清理器」卡片里有「运行期守护」一块——勾「启用运行期守护」、填 `retireAbove` / `keep`，点「保存守护设置」。写走宿主 `configEditor`（目标插件 Config schema 校验 + 原子写 + HMR 热生效），写后回显生效值。

**或手写 profile patch**（`maxHeaderBytes` 一般不调）：

```yaml
- id: cookie-cleaner
  name: dsh-cookie-cleaner
  config:
    runtimeGuard: true
    maxHeaderBytes: 65536   # 可选，默认值
    keep: 4                 # 可选，默认值
    retireAbove: 40         # 可选：条目数 >40 才退休（默认 0 = 每次收敛）
```

### 边界（写清楚，不留想象空间）

- **只读名字与顺序，不解 cookie 值**：值是 DSH 的签名会话载荷（authority/issuedAt/expiresAt），
  这些 cookie 都是 `Path=/`，浏览器按创建时间从旧到新发送（RFC 6265 §5.4），名字足够定位，值既不参与保留判断也不再被解析/记录/使用。
- **保留当前端口那条**：即使 `keep` 配得很小、或系统时钟回拨，也不会把正在使用的那条删掉。
- **对异常格式零影响**：只匹配 `dsh-auth-` + 43 位 base64url 的精确形状；若未来 cookie 名字格式变化，退化结果是「预算提升、不再清理」，而不是破坏会话。
- **同 host 多实例**：浏览器 cookie 按 host 共享，插件会退休「最新 `keep` 条 + 当前端口」之外的启动 cookie；同一份 profile 同时跑多个实例时，较旧实例的登录可能被清理，需要重新走一次欢迎页握手。当前实例自己的 cookie 始终保留。
- **头部预算的副作用**：默认把监听器的 `maxHeaderSize` 提到 64 KiB。默认回环监听下这只影响本机；如果把 DSH 绑到回环之外，远端请求可以多占每连接头部内存——对外暴露时应加反向代理/访问控制，或把 `maxHeaderBytes` 调低。
- **与第三方 `dsh-auth-cookie-guard` 二选一**：两者语义不冲突，但同时开会双份下发删除行、日志重复。具体分工见 [与运行期守护的分工](#与运行期守护的分工)。
- **卸载时还原**：dispose 会把 `maxHeaderSize` 还原到装载前的值（等值判断，不踩别的插件的新值），并摘掉 `request` 监听。

## 与运行期守护的分工

上游修复 431 有两条**语义互补、互不遮蔽**的路径：本插件的 `runtimeGuard`（运行期 HTTP 路径）与
**离线 `--clean`**（停机 SQLite 直连），以及第三方的
[`dsh-auth-cookie-guard`](https://github.com/jitianjiyan/dsh-auth-cookie-guard)（与本插件的运行期守护同构）：

| 能力 | 本插件 · 离线 `--clean` | 本插件 · `runtimeGuard` / 第三方 guard |
|---|---|---|
| 何时动手 | **停机窗**（客户端已完全退出）| **运行期**（每次 HTTP 请求/响应）|
| 动谁 | 直连 `Network/Cookies` SQLite，DELETE 行 | 响应头 `Set-Cookie Max-Age=0`，让浏览器自己退休 jar |
| 是否需要抬 `server.maxHeaderSize` | 否 | 是，抬到 64 KiB（否则 431 卡在解析层，清理代码进不到应用层）|
| 覆盖场景 | 已被 431 锁死无法握手 / 换 profile / 一次性大扫除 | 日常防堆积，无需用户操作 |
| 卸载后行为 | 无残留（本来就是外部脚本）| dispose 时还原 `maxHeaderSize`、摘 `request` 监听 |

**叠加规则**：

- 本插件 `runtimeGuard` **与第三方 `dsh-auth-cookie-guard` 同时开**会双份下发删除行、日志重复。
  同一 profile 建议二选一：要么用第三方常驻做运行期收敛、本插件只在**急救**时临时跑 `--clean`；
  要么只装本插件，`runtimeGuard: true` 或定期停机 `--clean` 二择其一。
- 本插件 `runtimeGuard` **与离线 `--clean` 不冲突**：前者日常收敛、后者急救，完全可共存。

## License

MIT

## TUI 终端面（dsh-tui）

dsh-tui 不加载插件的 client 半边（面板/卡片/设置页），也调不到插件自有 RPC；工具调用只显示一行摘要。人可读、人可操作的面只剩宿主斜杠命令。输出约定：单行 ≤100 字符、总行 ≤40、无 ANSI、两空格对齐；写操作默认 dry、加 `--yes` 才执行；`--json` 输出单行 JSON。

> 水位从哪来（重要）：真正会撞 431 的是**浏览器实际发出的 Cookie 头**（内存 jar）。插件在 `webServer` 的 `request` 上挂一个**只读观测臂** `installCookieObserver()`，它**与 `runtimeGuard` 开关无关**——守护关掉时水位照样看得见。读数优先级：请求头实时观测 > 借句柄快照 > 普通只读。磁盘 jar 只在优雅退出时落盘，强杀/崩溃后会停在旧快照甚至 0 条，所以它只作辅证，输出里会标「非实时」。借句柄扫描只在宿主进程启用（`shouldUseLiveLadder()`）；独立 TUI/CLI 进程不空转扫全机句柄表。可用 `DSH_COOKIE_LIVE_LADDER=1|on|0|off` 显式覆盖；`--json` 的 `ladder` / `source` / `observed` 字段会告诉你这次用的是哪一档。

| 命令 | 作用 |
|---|---|
| `/cookie-cleaner status` | 既有命令：本地登录凭据（dsh-auth-*）报告 |
| `/cookie-cleaner clean` | 既有命令：清理（需先完全退出客户端） |
| `/cookie-cleaner patch check|fix|revert|plan` | 既有命令：cordis.patch.yml 体检/修复 |

命令由插件自己在宿主侧注册（`ctx.inject(['commands'], …)`）：命令服务缺席的老宿主线上不激活、不报错。
