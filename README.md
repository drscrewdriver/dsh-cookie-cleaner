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
- 设置 `cookie-cleaner`：`userDataRoot`（覆盖 Electron userData 根）、`expiredOnly`（保守档措辞）、
  `lang`（钉住输出语言，留空=自动探测）。
- 没有 client 卡片：这是运维工具，界面交给终端；`locale/<lang>.json` 供宿主市场卡显示。

## 想让残留自动消失（不用手动清）

宿主内置寿命闸：把 `@deepseek-ai/dsh-client-connection` 的 `cookieMaxAgeDays`（默认 30，最小 1）
调到 1，Chromium 便会在启动时自行清掉过期行，历史条目不再堆积。代价是最后一次领取的 cookie
只有 1 天有效期，重启即续期。在 profile 的 `cordis.patch.yml` 追加：

```yaml
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    cookieMaxAgeDays: 1
```

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
