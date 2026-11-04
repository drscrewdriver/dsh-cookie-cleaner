# dsh-cookie-cleaner

清理 DSH（DeepSeek Harness）**桌面客户端** cookie 库里堆积的本地登录凭据 cookie（`dsh-auth-*`），
并把「为什么只能在客户端关闭时清理」讲清楚——不用每次再去问一遍 AI。

输出支持 9 种语言（zh / en / ja / ko / fr / de / it / ru / es），跟随系统 locale。

## 它是什么 / 为什么长这样

桌面客户端每次启动都会在 Electron 的 cookie 库里留下一条
`dsh-auth-<base64url(sha256(host:port))>`。名字按 **host:port** 哈希，端口一变就多一条，
各带 30 天有效期，于是历史记录长期堆积。

这些记录**不影响登录**，也**不涉及账号凭据**：

- 主窗口的 HTTP/WS 请求走内存态凭据（宿主换发后由桌面层直接注入请求头），不经 cookie jar；
- 鉴权只按当前 authority 派生的**那一个名字**取值，其余同名前缀条目本就永远读不到；
- 每次启动都会用 launch token 重新换发。

**关键约束（Windows 与 Linux 双端实测）**：这个库在客户端运行期间被 Chromium 独占，
而宿主插件跑在 Electron 的纯 Node 模式子进程里，拿不到 `session.cookies`。所以：

> 清理动作不可能由「插件在启动时」完成——它只能发生在客户端已完全退出的时间窗里，
> 而那个时刻宿主插件本身并不存在。因此本仓库把执行体做成**包内独立脚本**，
> 插件半只做只读播报和命令指引，**永不写库**。

堆积的根源是「每次启动一个随机端口」，而上游已有三份独立报告钉到同一条因果链
（[#11366](https://github.com/deepseek-ai/deepseek-harness/discussions/11366)、
[#11410](https://github.com/deepseek-ai/deepseek-harness/discussions/11410)、
[#11650](https://github.com/deepseek-ai/deepseek-harness/discussions/11650)，约 70 次启动后必现 HTTP 431）。
它们给出的两条用户侧规避（固定 `webserver.port` / 调小 `connection.cookieMaxAgeDays`）就是
下面「profile patch 体检与修复」面板存在的理由，完整关联见该章的
[为什么面板要能固定端口](#为什么面板要能固定端口上游三条-discussion-是同一条因果链)。

## 各平台的库位置与退出方式

| 平台 | cookie 库默认位置 | 完全退出客户端的方式 |
|---|---|---|
| **Windows** | `%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies` | 托盘图标 → 退出；确认任务管理器里没有 `DeepSeek Harness` |
| **macOS** | `~/Library/Application Support/@deepseek-ai/dsh-desktop/Network/Cookies` | `Cmd+Q` 或菜单 → Quit；Dock 图标消失**不等于**已退出，用 `ps aux \| grep -i deepseek` 确认 |
| **Linux** | `~/.config/@deepseek-ai/dsh-desktop/Network/Cookies`（`XDG_CONFIG_HOME` 优先） | 关闭主窗口后用 `pgrep -af 'DeepSeek Harness\|dsh-desktop'` 确认没有残留 |

更早的 Chromium 布局把库直接放在 `<userData>/Cookies`（不带 `Network/`），工具两种都会试。
位置不对时用 `--db=<完整路径>`，或设 `DSH_USER_DATA` / `DSH_COOKIE_DB` 环境变量。
flatpak / snap 安装的客户端路径在常规位置之外，通常需要 `--db` 手动指。

## 安装

```shell
# 作为 DSH 插件（提供 /cookie-cleaner 只读播报）
dsh --profile desktop plugin add dsh-cookie-cleaner

# 清理工具随包分发；装完即可用 profile 里的别名，或全局安装后直接敲命令
npm i -g dsh-cookie-cleaner
```

> desktop profile 由客户端自己管理，命令行 `dsh plugin add` 可能被拒
> （`profile "desktop" is managed exclusively by the Electron application`）——
> 那种情况下在客户端的插件管理界面里装；**清理脚本本身是独立的**，
> 全局 npm 安装或 `node <包目录>/src/cli.js` 都能跑，不依赖宿主装载。

别名路径（装进 profile 后）：

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
  `guardMode`（`literal` 只动目标键 / `expression` 同时把 bundle 层的 `!!js` 表达式还原回去）。
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

### 为什么面板要能固定端口：上游三条 discussion 是同一条因果链

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

**面板就是把这两条规避做成可检查、可回滚的操作**：#11410 动的是 `webserver` 行，#11650 动的是
`connection` 行——正好是本插件受管的两行。手改 profile 里那几千行 YAML 很容易踩两个坑，而这两个
坑在本插件里都有编号：

- **浅赋值**：#11650 自己就提醒「patch 对 `config` 是整体替换而不是深合并，所以 `trustedHosts`
  必须跟着写全」——漏键会落回 schema 默认（P5），把 bundle 层的 `!!js` 表达式抄成字面量则不再跟随（P9）；
- **字面量端口会夺走 `--port`**：#11410 的规避写的是 `port: 34567` 字面量，代价是启动旗标失效（P8，
  本机实测：传 `--port 4200` 仍起在钉住的端口）。

所以面板写端口时用的是表达式形式 `ctx.webStartup.port ?? +<你填的数>`：**authority 恒定（cookie 不再
按端口累积）与 `--port` 优先，两者都要**。

一句边界：这是**诊断与规避层**，不是根治。真正的修法在上游（cookie 用固定名 / mint 时清理 / welcome
复用第一步已拿到的 cookie 头 / 报错带上状态码）；上游修好后，本面板的价值退化为「检查你 profile 里
那两行还写不写得对」。

### 端口：不自动改，但可一键应用（固定 authority，并避开代理工具常用端口）

`port` 钉成字面量会让 `--port` 旗标失效（启动层传来的端口压不动它），这是**启动行为**决策。
所以「修复」永远不动 `webserver` 行；但面板提供了一个**显式**的「应用端口」动作（命令行为
`/cookie-cleaner patch port <n>`）：

- 写进去的是**表达式**而非字面量：已有表达式就只换末尾回落值（`... ?? 3080` → `... ?? 4300`），
  没有才用 `ctx.webStartup.port > 0 ? ctx.webStartup.port : <你填的数>`——**`--port` 仍优先**，不自己造 P8。
- 本插件**不预填也不内置任何默认端口**（`guardPort` 默认 0=未设定）；没填就拒写，端口只能来自你的输入。
- 写前用 `net.connect` 探针看目标端口在本机是否已被占（占用就不写）；写后“监听到底在哪个端口”
  也由探针回答，分**热生效 / 下次启动生效 / 无据**三档，不拿配置猜。
- 快照按行存，一次「回滚」把 cookie 寿命与端口各自退回各自动作前的值。

只想要粘贴块而不点按钮：`patch plan` 或面板里的提示。

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

## License

MIT
