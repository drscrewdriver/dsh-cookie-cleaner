# Changelog

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
