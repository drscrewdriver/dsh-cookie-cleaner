/**
 * dsh-cookie-cleaner — 「文件属于别的用户」这一档的 9 语文案（单文件集中放，便于核对）。
 *
 * 触发条件见 core.js 的 classifyOpenFailure：POSIX 上 stat.uid ≠ process.getuid()。
 * 实测 node:sqlite 在权限不足时**不报 EACCES**（只报 unable to open database file），
 * 所以这一档不能靠错误码判定，只能自己探属主。
 */

/** @type {Record<string,string>} */
export const ADVISE_OWNER = {
  zh: '  处置：这个文件属于另一个用户（不是跑本命令的你）。用那个账号跑，或用 --db=<完整路径> 指向你自己那份库。',
  en: '  What to do: this file belongs to another user, not the one running this command. Run it as that account, or point at your own store with --db=<full path>.',
  ja: '  対処：このファイルは別ユーザーの所有です（本コマンドの実行者ではありません）。そのアカウントで実行するか、--db=<フルパス> で自身のデータベースを指定してください。',
  ko: '  조치: 이 파일은 다른 사용자의 소유입니다(본 명령의 실행자가 아님). 해당 계정으로 실행하거나 --db=<전체 경로>로 자신의 데이터베이스를 지정하세요.',
  fr: '  À faire : ce fichier appartient à un autre utilisateur que celui qui lance la commande. Exécutez-le sous ce compte, ou désignez votre propre base avec --db=<chemin complet>.',
  de: '  Vorgehen: diese Datei gehört einem anderen Nutzer als dem, der diesen Befehl ausführt. Führen Sie ihn als diesen Nutzer aus, oder zeigen Sie mit --db=<vollständiger Pfad> auf Ihre eigene Datenbank.',
  it: '  Cosa fare: questo file appartiene a un utente diverso da chi esegue il comando. Esegilo come quell’account, oppure indica il tuo archivio con --db=<percorso completo>.',
  ru: '  Что делать: этот файл принадлежит другому пользователю, а не тому, кто запускает команду. Запустите её от того аккаунта или укажите свою базу через --db=<полный путь>.',
  es: '  Qué hacer: este archivo pertenece a otro usuario, no al que ejecuta este comando. Ejecútalo con esa cuenta, o señala tu propio almacén con --db=<ruta completa>.',
}

/**
 * 「读不到 = 库里没这个文件」的统计行（9 语）。跟 classifyOpenFailure 的 missing 档配对；
 * 实测：首次使用前的空目录、自定义安装位置都会落在这里，归成 busy 就是误报。
 */
/** @type {Record<string,string>} */
export const STAT_MISSING = {
  zh: 'cookie 库不在这个位置（客户端从未起过、或装在了别处）：{path}',
  en: 'No cookie database at this location (the client never ran, or it lives elsewhere): {path}',
  ja: 'この位置に cookie データベースがありません（クライアント未起動、か別の場所にあります）：{path}',
  ko: '이 위치에 cookie 데이터베이스가 없습니다(클라이언트를 실행한 적 없거나 다른 곳에 있습니다): {path}',
  fr: 'Pas de base de cookies à cet emplacement (le client n’a jamais tourné, ou elle est ailleurs) : {path}',
  de: 'Keine Cookie-Datenbank an diesem Ort (der Client lief nie, oder sie liegt woanders): {path}',
  it: 'Nessun database dei cookie in questa posizione (il client non è mai partito, oppure sta altrove): {path}',
  ru: 'Базы cookie в этом месте нет (клиент не запускался или хранится elsewhere): {path}',
  es: 'No hay base de cookies en esta ubicación (el cliente nunca se ejecutó, o está en otro sitio): {path}',
}
// ru 文案里的英文残留清掉
STAT_MISSING.ru = STAT_MISSING.ru.replace('хранится elsewhere', 'лежит в другом месте')
