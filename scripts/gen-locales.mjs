/**
 * scripts/gen-locales.mjs — 生成 locale/<lang>.json（9 语包元数据）。
 *
 * 单一真源就是本文件的 TABLE；`--check` 模式只校验磁盘与表一致（prepack 门禁挂它），
 * 避免「手改了 json 没同步表」或反之。宿主以 en.json 为锚，缺锚则整个 locale/ 被忽略。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'locale')

const TABLE = {
  zh: {
    title: 'Cookie 清理器',
    description: '只读播报桌面客户端 cookie 库里残留的 dsh-auth-* 本地登录凭据，随包分发「客户端完全退出后」可执行的清理命令；并提供 profile patch 的结构化体检与一键修复面板。',
  },
  en: {
    title: 'Cookie Cleaner',
    description: "Reports leftover dsh-auth-* entries in the desktop client's cookie store, ships a command that purges them once the client is fully closed, and adds a panel that checks and repairs the profile patch structure.",
  },
  ja: {
    title: 'Cookie クリーナー',
    description: 'デスクトップクライアントの cookie ストアに残った dsh-auth-* を読み取り専用で報告し、クライアントを完全終了後に消去するコマンドを同梱。さらに profile patch の構造点検とワンクリック修復のパネルも提供します。',
  },
  ko: {
    title: 'Cookie 정리 도구',
    description: '데스크톱 클라이언트 cookie 저장소에 남은 dsh-auth-*를 읽기 전용으로 보고하고, 클라이언트를 완전히 종료한 뒤 지우는 명령을 함께 배포하며, profile patch 구조 점검·원클릭 복구 패널도 제공합니다.',
  },
  fr: {
    title: 'Nettoyeur de cookies',
    description: "Signale les entrées dsh-auth-* restantes dans la base de cookies du client desktop, fournit une commande qui les purge une fois le client entièrement fermé et ajoute un panneau qui contrôle et répare la structure du patch de profil.",
  },
  de: {
    title: 'Cookie-Räumer',
    description: 'Meldet übrig gebliebene dsh-auth-* Einträge im Cookie-Speicher des Desktop-Clients, liefert einen Befehl, der sie nach vollständigem Beenden räumt, und zeigt ein Panel zur Prüfung und Korrektur der Profil-Patch-Struktur.',
  },
  it: {
    title: 'Pulitore di cookie',
    description: "Segnala le voci dsh-auth-* residue nell'archivio cookie del client desktop, fornisce un comando che le elimina dopo aver chiuso completamente il client e aggiunge un pannello che controlla e corregge la struttura del patch del profilo.",
  },
  ru: {
    title: 'Очистка cookie',
    description: 'Отчитывается об остатках dsh-auth-* в хранилище cookie десктопного клиента, поставляет команду очистки после полного выхода из клиента и добавляет панель проверки и исправления структуры патча профиля.',
  },
  es: {
    title: 'Limpiador de cookies',
    description: 'Informa de las entradas dsh-auth-* residuales en el almacén de cookies del cliente de escritorio, ofrece un comando que las purga tras cerrar del todo el cliente y añade un panel que revisa y repara la estructura del patch de perfil.',
  },
}

const langs = Object.keys(TABLE)
if (langs.length !== 9) throw new Error('locale 必须正好 9 语，当前 ' + langs.length)
if (!langs.includes('en')) throw new Error('缺 en 锚，宿主会忽略整个 locale/ 目录')

const check = process.argv.includes('--check')
const drift = []
fs.mkdirSync(OUT, { recursive: true })

for (const lang of langs) {
  const expected = JSON.stringify({ meta: TABLE[lang] }, null, 2) + '\n'
  const file = path.join(OUT, `${lang}.json`)
  if (check) {
    const actual = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
    if (actual === null) drift.push(`${lang}.json 缺失`)
    else if (actual !== expected) drift.push(`${lang}.json 与表不一致`)
  } else {
    fs.writeFileSync(file, expected, 'utf8')
  }
}

if (check) {
  if (drift.length > 0) {
    process.stderr.write('locale 漂移：\n - ' + drift.join('\n - ') + '\n运行 `node scripts/gen-locales.mjs` 修复。\n')
    process.exitCode = 1
  } else {
    process.stdout.write(`locale 9 语与表一致（锚 en 在位）\n`)
  }
} else {
  process.stdout.write(`已生成 ${langs.length} 份 locale/<lang>.json\n`)
}
