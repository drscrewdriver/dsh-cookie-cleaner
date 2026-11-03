# dsh-cookie-cleaner

清理 DSH（DeepSeek Harness）**桌面客户端** cookie 库里堆积的本地登录凭据 cookie（`dsh-auth-*`），
并解释清楚「为什么只能在客户端关闭时清理」——不用每次再去问一遍 AI。

## 它是什么 / 为什么长这样

桌面客户端每次启动都会在 Electron 的 cookie 库（`%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies`）
里留下一条 `dsh-auth-<base64url(sha256(host:port))>`。名字按 **host:port** 哈希，端口一变就多一条，
各带 30 天有效期，于是历史记录长期堆积。

这些记录**不影响登录**，也**不涉及账号凭据**：

- 主窗口的 HTTP/WS 请求走的是内存态凭据（宿主换发后由桌面层直接注入请求头），不经 cookie jar；
- 鉴权只按当前 authority 派生的**那一个名字**取值，其余同名前缀条目本就永远读不到；
- 每次启动都会用 launch token 重新换发。

**关键约束（实测，非猜测）**：这个库在客户端运行期间被 Chromium 独占。
宿主插件跑在 Electron 的纯 Node 模式子进程里，既拿不到 `session.cookies`，
也无法在运行期打开该库（只读打开都会失败）。所以：

> 清理动作不可能由「插件在启动时」完成——它只能发生在客户端已完全退出的时间窗里，
> 而那个时刻宿主插件本身并不存在。因此本仓库把执行体做成**包内独立脚本**，
> 插件半只做只读播报和命令指引，**永不写库**。

## 安装

```shell
# 作为 DSH 插件（提供 /cookie-cleaner 只读播报）
dsh plugin add dsh-cookie-cleaner

# 清理工具随包分发，装完即可在终端调用
npm i -g dsh-cookie-cleaner        # 之后直接 `dsh-cookie-cleaner`
# 或不安装，用宿主装好的包体直接跑：
node "<包目录>/src/cli.js"
```

## 用法

```text
dsh-cookie-cleaner                        查看现状：库在哪、多少条 dsh-auth-*、多少已过期
dsh-cookie-cleaner --clean                删除回环域(127.0.0.1/localhost/[::1])下全部 dsh-auth-*
dsh-cookie-cleaner --clean --expired-only 保守档：只删已过期的
dsh-cookie-cleaner --clean --dry-run      只看会删几条，不写盘
dsh-cookie-cleaner --db=<完整路径>         手动指定 cookie 库
```

可选 `--no-backup`（不产出 `.bak` 副本）、`--no-vacuum`（不做 VACUUM 收缩）。
退出码：`0` 成功；`1` 库被占用 / 没找到 / 参数非法。

安全设计：

- **独占写锁即闸门**——`BEGIN IMMEDIATE` 拿不到就拒绝执行并给出人话处置，不做任何"也许能写"的尝试；
- 写盘前先 `copyFileSync` 落 `Cookies.bak-<时间戳>`，备份失败即放弃（全有或全无）；
- 删除语句只由 `host_key` 白名单 + 名称前缀构成，两者都过字符校验，时间戳走 BigInt 绑定参数；
- 表结构自检：库里没有 `cookies` 表或缺关键列，一律拒绝，绝不对未知库执行写语句。

Node ≥ 22.19（用到 `node:sqlite`，Electron 44 内置的 Node 24 亦可）。
在 Node 22 上会打印一条 `ExperimentalWarning: SQLite`，可 `node --no-warnings` 消除。

## 插件面

- 命令 `/cookie-cleaner` `[status|clean]`：**只读**。输出当前统计 + 可直接复制执行的清理命令。
- 设置 `cookie-cleaner`：`userDataRoot`（覆盖 Electron userData 根，多实例/非默认安装用）、
  `expiredOnly`（保守档，影响提示措辞）。
- 没有 client 卡片：这是一个运维工具，界面交给终端。

## 想让残留自动消失（不用手动清）

宿主内置一个寿命闸：把 `@deepseek-ai/dsh-client-connection` 的 `cookieMaxAgeDays`（默认 30，最小 1）
调到 1，Chromium 便会在启动时自行清掉过期行，历史条目不再堆积。代价是最后一次领取的 cookie
只有 1 天有效期，重启即续期。在 profile 的 `cordis.patch.yml` 追加：

```yaml
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    cookieMaxAgeDays: 1
```

## 兼容性

逐 rc 单列于 `scripts/hosts.mjs`（单一真源），`npm run sync-hosts` 同步进
`package.json#engines.dsh`、`package.json#dsh.compatibility.dshReleases`、`dsh.plugin.json#engines.dsh`；
`prepack` 会以 `--check` 拦截不一致。

## License

MIT
