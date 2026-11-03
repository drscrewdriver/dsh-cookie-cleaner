/**
 * dsh-cookie-cleaner — 双清单同步 / 校验。
 *
 *   node scripts/sync-hosts.mjs          写入（幂等）
 *   node scripts/sync-hosts.mjs --check  只校验，不一致即 exit 1（prepack 门禁）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOSTS, STATUS, orRange } from './hosts.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
const range = orRange(HOSTS)
const releases = Object.fromEntries(HOSTS.map((host) => [host, STATUS]))
const failures = []

const pkgPath = path.join(ROOT, 'package.json')
const manifestPath = path.join(ROOT, 'dsh.plugin.json')
const RENDERER = '@deepseek-ai/dsh-client-ui-renderer'
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

function compare(label, actual, expected) {
  if (actual === expected) return
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  failures.push(`${label}: 与 scripts/hosts.mjs 不一致\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`)
}

compare('package.json#engines.dsh', pkg.engines?.dsh, range)
compare('package.json#dsh.compatibility.dshReleases', pkg.dsh?.compatibility?.dshReleases, releases)
compare('dsh.plugin.json#engines.dsh', manifest.engines?.dsh, range)
compare('dsh.plugin.json#version', manifest.version, pkg.version)
// 兼容性闸门只读 @deepseek-ai/dsh* 前缀的 peer range（不读 engines.dsh），
// 所以这张卡漏不得：少了它宿主换代时不会拒载，而是装载后运行期报错。
compare('package.json#peerDependencies[renderer]', pkg.peerDependencies?.[RENDERER], range)

if (check) {
  if (failures.length > 0) {
    process.stderr.write('双清单校验失败：\n' + failures.map((f) => ' - ' + f).join('\n') + '\n运行 `node scripts/sync-hosts.mjs` 修复。\n')
    process.exitCode = 1
  } else {
    process.stdout.write(`双清单一致（${HOSTS.length} 条宿主线）\n`)
  }
} else if (failures.length > 0) {
  // 版本号以 package.json 为源，把同号刷进 dsh.plugin.json（不然改版本必遗漏一处，V1 闸抓不到）
  pkg.engines = { ...pkg.engines, dsh: range }
  pkg.dsh = { ...pkg.dsh, compatibility: { ...pkg.dsh?.compatibility, dshReleases: releases } }
  pkg.peerDependencies = { ...pkg.peerDependencies, [RENDERER]: range }
  manifest.engines = { ...manifest.engines, dsh: range }
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
