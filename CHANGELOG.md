# Changelog

## 0.1.0 (2026-11-04)

- 首版：只读播报 + 包内独立清理脚本。
- `src/core.js`：cookie 库定位（win/mac/linux 惯例 + `DSH_USER_DATA` / `DSH_COOKIE_DB` / `--db` 覆盖）、
  只读统计（条数/过期数/host_key 分布/过期跨度）、`BEGIN IMMEDIATE` 独占写锁闸、
  `.bak` 备份 + 事务删除 + VACUUM，表结构自检不过即拒绝写入。
- `src/cli.js`（npm bin `dsh-cookie-cleaner`）：`--clean` / `--expired-only` / `--dry-run` / `--no-backup` / `--no-vacuum` / `--db`。
- `src/index.js`：`/cookie-cleaner` 命令（只读，输出可直接复制的清理命令）+ 三代设置 waist + `volatile` 配置面。
- 关键事实入档：客户端运行期该库被 Chromium 独占，宿主插件无法在启动时清理；
  因此写盘只可能落在客户端退出后的独立脚本里（本机 0.2.1-rc.5 实测）。
