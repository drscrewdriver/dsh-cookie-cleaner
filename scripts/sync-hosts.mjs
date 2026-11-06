/**
 * dsh-cookie-cleaner — 双清单同步 / 校验。
 *
 *   node scripts/sync-hosts.mjs          写入（幂等）
 *   node scripts/sync-hosts.mjs --check  只校验，不一致即 exit 1（prepack 门禁）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOSTS, STATUS, orRange, ENGINES_RANGE } from './hosts.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
const range = orRange(HOSTS)
const releases = Object.fromEntries(HOSTS.map((host) => [host, STATUS]))
const failures = []

const pkgPath = path.join(ROOT, 'package.json')
const manifestPath = path.join(ROOT, 'dsh.plugin.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

/**
 * client 半声明的包必须逐个有 optional peer 背书（包核验器 V3）。
 * 单一真源就取 `dsh.client.inject`：inject 列表与 peer 清单同源于 hosts.mjs 的 range，
 * 手写两处必然漂移；也没必要再给没引用的包占 peer（所以 renderer 自动退场）。
 */
const clientPeers = [...new Set((pkg.dsh?.client?.inject ?? []).filter((name) => typeof name === 'string' && name !== pkg.name))]

function compare(label, actual, expected) {
  if (actual === expected) return
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  failures.push(`${label}: 与 scripts/hosts.mjs 不一致\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`)
}

compare('package.json#engines.dsh', pkg.engines?.dsh, ENGINES_RANGE)
compare('package.json#dsh.compatibility.dshReleases', pkg.dsh?.compatibility?.dshReleases, releases)
compare('dsh.plugin.json#engines.dsh', manifest.engines?.dsh, ENGINES_RANGE)
compare('dsh.plugin.json#version', manifest.version, pkg.version)
// 兼容性闸门只读 @deepseek-ai/dsh* 前缀的 peer range（不读 engines.dsh），
// 一个都不能漏：少了宿主换代时不会拒载，而是装载后运行期报错。
for (const name of clientPeers) {
  compare(`package.json#peerDependencies[${name}]`, pkg.peerDependencies?.[name], range)
  if (pkg.peerDependenciesMeta?.[name]?.optional !== true) {
    failures.push(`package.json#peerDependenciesMeta[${name}].optional 应为 true（宿主提供，不是 npm 安装物）`)
  }
}
if (!Object.keys(pkg.peerDependencies ?? {}).some((name) => name.startsWith('@deepseek-ai/dsh'))) {
  failures.push('package.json#peerDependencies 缺 @deepseek-ai/dsh* 项：兼容性闸门将永远判兼容（假绿）')
}

if (check) {
  if (failures.length > 0) {
    process.stderr.write('双清单校验失败：\n' + failures.map((f) => ' - ' + f).join('\n') + '\n运行 `node scripts/sync-hosts.mjs` 修复。\n')
    process.exitCode = 1
  } else {
    process.stdout.write(`双清单一致（${HOSTS.length} 条宿主线）\n`)
  }
} else if (failures.length > 0) {
  // 版本号以 package.json 为源，把同号刷进 dsh.plugin.json（不然改版本必遗漏一处，V1 闸抓不到）
  pkg.engines = { ...pkg.engines, dsh: ENGINES_RANGE }
  pkg.dsh = { ...pkg.dsh, compatibility: { ...pkg.dsh?.compatibility, dshReleases: releases } }
  // peer 表重建：保留非 dsh-scope 的 peer（如 cordis），dsh* 项一律等于 client.inject 集合与同一 range
  const kept = Object.fromEntries(Object.entries(pkg.peerDependencies ?? {}).filter(([name]) => !name.startsWith('@deepseek-ai/dsh')))
  for (const name of clientPeers) kept[name] = range
  pkg.peerDependencies = kept
  const meta = Object.fromEntries(Object.entries(pkg.peerDependenciesMeta ?? {}).filter(([name]) => !name.startsWith('@deepseek-ai/dsh')))
  for (const name of clientPeers) meta[name] = { ...meta[name], optional: true }
  pkg.peerDependenciesMeta = meta
  manifest.engines = { ...manifest.engines, dsh: ENGINES_RANGE }
  if (manifest.version !== pkg.version) {
    manifest.version = pkg.version
    process.stdout.write(`dsh.plugin.json#version 同步为 ${pkg.version}\n`)
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  process.stdout.write(`已同步 ${HOSTS.length} 条宿主线到 package.json / dsh.plugin.json\n`)
} else {
  process.stdout.write(`已是最新（${HOSTS.length} 条宿主线）\n`)
}
