/**
 * dsh-cookie-cleaner — client 半的界面文案（9 语）。
 *
 * 为什么在浏览器侧自己渲染文本，而不是显示宿主算好的句子：
 * 浏览器语言与宿主进程语言可以不同（宿主跟 LANG 走，UI 跟设置走），
 * 面板显示服务端文案会让「中文宿主 + 英文界面」这种常见组合输出半中英。
 * 所以宿主只回 `{code, params}`，卡片按 `locale` 服务的当前语言渲染。
 *
 * P1-P12 判定码复用 `src/locales-patch.js`（宿主半与 CLI 同源），这里只加界面 chrome
 * 并把两张表压平成 `locale.register` 需要的 key→string 形态——加规则时不用改两处。
 */
import { PATCH_CODES, PATCH_LANGS, PATCH_TEXT } from '../locales-patch.js'

export type PatchLang = typeof PATCH_LANGS[number]

/** 字典命名空间 = npm 包名（与卡 id、桥路径同串）。 */
export const NS = 'dsh-cookie-cleaner'

/** 界面 chrome 文案（9 语并排，顺序同 PATCH_LANGS）。 */
const t = (zh: string, en: string, ja: string, ko: string, fr: string, de: string, it: string, ru: string, es: string) =>
  ({ zh, en, ja, ko, fr, de, it, ru, es }) as Record<PatchLang, string>

const CHROME: Record<string, Record<PatchLang, string>> = {
  'section.title': t('Cookie 清理器', 'Cookie Cleaner', 'Cookie クリーナー', 'Cookie 청소기', 'Nettoyeur de cookies', 'Cookie-Reiniger', 'Pulitore cookie', 'Очистка cookie', 'Limpiador de cookies'),
  'card.title': t('profile patch 体检与修复', 'Profile patch check & fix', 'profile patch の点検と修復', 'profile patch 점검 및 복구', 'Contrôle et réparation du patch de profil', 'Prüfung & Korrektur des Profil-Patches', 'Controllo e correzione del patch del profilo', 'Проверка и исправление патча профиля', 'Revisión y reparación del patch de perfil'),
  'action.check': t('体检', 'Check', '点検', '점검', 'Contrôler', 'Prüfen', 'Controlla', 'Проверить', 'Revisar'),
  'action.fix': t('修复', 'Fix', '修復', '복구', 'Réparer', 'Korrigieren', 'Correggi', 'Исправить', 'Reparar'),
  'action.revert': t('回滚', 'Revert', '戻す', '되돌리기', 'Annuler', 'Rückgängig', 'Ripristina', 'Отменить', 'Revertir'),
  'action.port': t('应用端口', 'Apply port', 'ポート適用', '포트 적용', 'Appliquer le port', 'Port anwenden', 'Applica porta', 'Применить порт', 'Aplicar puerto'),
  'port.input': t('目标端口', 'target port', '対象ポート', '대상 포트', 'port cible', 'Ziel-Port', 'porta di destinazione', 'целевой порт', 'puerto de destino'),
  // 不预填默认端口：这里只说“要填一个”，不说“默认是几”。
  'port.help': t('留空则不改；填一个 1-65535 的端口后点「应用端口」，只改 webserver 行的 port 表达式（`--port` 仍优先）', 'leave empty to change nothing; type a port 1-65535 and press Apply port - only the webserver row\'s port expression is rewritten (`--port` still wins)', '空なら変更なし。1-65535 のポートを入れて「ポート適用」を押すと webserver 行の port 式のみ書き換わります（`--port` 優先）', '비워두면 변경 없음. 1-65535 포트를 넣고 "포트 적용"을 누르면 webserver 행의 port 표현식만 다시 씁니다(`--port` 우선)', 'laissez vide pour ne rien changer ; saisissez un port 1-65535 puis « Appliquer le port » - seule l\'expression du port de la ligne webserver est réécrite (`--port` gagne)', 'leer lassen ändert nichts; Port 1-65535 eingeben und „Port anwenden“ - nur der port-Ausdruck der webserver-Zeile wird umgeschrieben (`--port` bleibt oben)', 'lasciare vuoto per non cambiare nulla; inserire una porta 1-65535 e premere Applica porta - viene riscritta solo l\'espressione port della riga webserver (`--port` vince)', 'оставьте пустым чтобы не менять; введите порт 1-65535 и нажмите Применить порт — переписывается только выражение port строки webserver (`--port` важнее)', 'deje vacío para no cambiar nada; escriba un puerto 1-65535 y pulse Aplicar puerto: solo se reescribe la expresión port de la fila webserver (`--port` gana)'),
  'port.audit': t('上次端口：{at}（{before} → 现在 {port}）', 'last port: {at} ({before} → now {port})', '前回のポート：{at}（{before} → 現在 {port}）', '마지막 포트: {at}({before} → 현재 {port})', 'dernier port : {at} ({before} → maintenant {port})', 'letzter Port: {at} ({before} → jetzt {port})', 'ultima porta: {at} ({before} → ora {port})', 'последний порт: {at} ({before} → теперь {port})', 'último puerto: {at} ({before} → ahora {port})'),
  'state.busy': t('进行中…', 'working…', '処理中…', '처리 중…', 'en cours…', 'läuft…', 'in corso…', 'выполняется…', 'en curso…'),
  'state.failed': t('动作失败：{message}', 'action failed: {message}', 'アクション失敗：{message}', '동작 실패: {message}', 'échec de l\'action : {message}', 'Aktion fehlgeschlagen: {message}', 'azione fallita: {message}', 'действие не удалось: {message}', 'acción falló: {message}'),
  'state.offline': t('宿主未提供 config-editor（老线或未装配），本面板无法在线体检/修复', 'the host exposes no config-editor (older line or not assembled); this panel cannot check or fix online', '宿主に config-editor が無く（旧ライン/未装配）、本パネルではオンライン点検・修復不可', '호스트에 config-editor가 없음(구 라인/미조립) → 이 패널에서 온라인 점검·복구 불가', 'l\'hôte n\'expose pas de config-editor (ancienne ligne ou non assemblé) ; ce panneau ne peut ni contrôler ni réparer', 'der Host stellt keinen config-editor bereit (ältere Zeile oder nicht montiert); dieses Panel kann nicht online prüfen oder korrigieren', 'l\'host non espone config-editor (linea vecchia o non assemblato); questo pannello non può controllare né correggere online', 'хост не даёт config-editor (старая линия или не собран); эта панель не может проверять или исправлять онлайн', 'el host no expone config-editor (línea antigua o no ensamblado); este panel no puede revisar ni reparar en línea'),
  'row.connection': t('connection（cookie 寿命）', 'connection (cookie lifetime)', 'connection（cookie 寿命）', 'connection(cookie 수명)', 'connection (durée de vie des cookies)', 'connection (Cookie-Lebensdauer)', 'connection (durata cookie)', 'connection (срок жизни cookie)', 'connection (duración de cookies)'),
  'row.webserver': t('webserver（启动面）', 'webserver (launch surface)', 'webserver（起動面）', 'webserver(시작 면)', 'webserver (surface de lancement)', 'webserver (Startebene)', 'webserver (livello di avvio)', 'webserver (слой запуска)', 'webserver (capa de arranque)'),
  'level.ok': t('结构健康', 'structurally sound', '構造は健全', '구조 정상', 'structure saine', 'strukturell in Ordnung', 'struttura integra', 'структура здорова', 'estructura sana'),
  'level.warn': t('有偏差', 'deviates', '偏差あり', '편차 있음', 'dérive', 'Abweichung', 'in deviazione', 'отклонение', 'desviación'),
  'level.fail': t('会失效', 'will not take effect', '効きません', '적용 안 됨', 'sans effet', 'wirkt nicht', 'non avrà effetto', 'не сработает', 'no surtirá efecto'),
  'level.skipped': t('无法判定', 'cannot decide', '判定不能', '판단 불가', 'indécidable', 'nicht bestimmbar', 'indecidibile', 'нельзя определить', 'indecidible'),
  'note.webserver': t('webserver 行只体检不自动写（端口钉死属启动行为面）', 'the webserver row is checked but never auto-written (pinning the port is a launch-behaviour decision)', 'webserver 行は体検のみ・自動書き込みなし（ポート固定は起動挙動の話）', 'webserver 행은 점검만, 자동 기록 없음(포트 고정은 시작 동작 판단)', 'la ligne webserver est contrôlée mais jamais écrite (figer le port relève du lancement)', 'die webserver-Zeile wird nur geprüft, nie geschrieben (Portfestlegung ist Startverhalten)', 'la riga webserver è solo controllata, mai scritta (fissare la porta riguarda l\'avvio)', 'строка webserver только проверяется, не пишется (фиксация порта — вопрос запуска)', 'la fila webserver solo se revisa, nunca se escribe (fijar el puerto concierne al arranque)'),
  'fix.done': t('已写入：{changed}', 'written: {changed}', '書き込み完了：{changed}', '기록됨: {changed}', 'écrit : {changed}', 'geschrieben: {changed}', 'scritto: {changed}', 'записано: {changed}', 'escrito: {changed}'),
  'fix.noop': t('无需写入（已在目标档）', 'nothing to write (already on target)', '書き込み不要（目標達成済み）', '기록 불필요(이미 목표)', 'rien à écrire (déjà à la cible)', 'nichts zu schreiben (bereits am Ziel)', 'nulla da scrivere (già all\'obiettivo)', 'нечего писать (уже в цели)', 'nada que escribir (ya en el objetivo)'),
  'fix.blocked': t('判定为不可动作（{codes}）：需按提示手工修文件', 'judged not actionable ({codes}): fix the file by hand as suggested', '動作不可と判定（{codes}）：表示どおり手動でファイルを修正', '조치 불가({codes}): 안내대로 파일을 직접 수정', 'jugé non exécutable ({codes}) : corrigez le fichier à la main', 'als nicht ausführbar eingestuft ({codes}): Datei wie vorgeschlagen von Hand korrigieren', 'giudicato non eseguibile ({codes}): correggere a mano il file come suggerito', 'признано невыполнимым ({codes}): правьте файл вручную по подсказке', 'juzgado no accionable ({codes}): corrige el archivo a mano como se sugiere'),
  'revert.done': t('已回滚：{changed}', 'rolled back: {changed}', 'ロールバック済み：{changed}', '되돌림: {changed}', 'annulé : {changed}', 'zurückgerollt: {changed}', 'ripristinato: {changed}', 'откатлено: {changed}', 'revertido: {changed}'),
  'revert.none': t('没有可回滚的快照（修复一次才会留一份）', 'no snapshot to roll back (a successful fix keeps one)', '回滚用スナップショット無し（修復成功時に 1 件保存）', '롤백 스냅샷 없음(복구 성공 시 1개 보관)', 'aucun instantané à restaurer (une réparation réussie en garde un)', 'kein Snapshot zum Zurückrollen (ein erfolgreicher Fix hinterlässt einen)', 'nessuno snapshot da ripristinare (una correzione riuscita ne conserva uno)', 'нет снимка для отката (успешное исправление сохраняет один)', 'no hay instantánea a la que volver (una reparación correcta guarda una)'),
  'lastCheck': t('最近体检：{at}', 'last check: {at}', '最近の点検：{at}', '마지막 점검: {at}', 'dernier contrôle : {at}', 'letzte Prüfung: {at}', 'ultimo controllo: {at}', 'последняя проверка: {at}', 'última revisión: {at}'),
}

/** 把共享判定表压平成 `p.P5` 形态的键（宿主只回 code，语言由界面决定）。 */
function flatten(bucket: Record<string, Record<PatchLang, string>>, prefix: string) {
  const out: Record<string, Record<PatchLang, string>> = {}
  for (const [code, entry] of Object.entries(bucket)) out[`${prefix}${code}`] = entry
  return out
}

const MERGED: Record<string, Record<PatchLang, string>> = {
  ...CHROME,
  ...flatten(PATCH_CODES, 'p.'),
  ...flatten(PATCH_TEXT, 'x.'),
}

/** 界面用到的全部键（测试用它核对 9 语逐键相等）。 */
export const UI_KEYS: readonly string[] = Object.keys(MERGED)

/** `locale.register(NS, dictionaries)` 的入参。 */
export const dictionaries = Object.fromEntries(
  PATCH_LANGS.map((lang) => [lang, Object.fromEntries(UI_KEYS.map((key) => [key, MERGED[key][lang]]))]),
) as Record<PatchLang, Record<string, string>>

/** 本地插值（`{name}` 形态，与宿主字典同规则；缺参原样留形便于发现漏参）。 */
export function render(text: string, params: Record<string, unknown> = {}): string {
  return text.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = params[name]
    if (value === undefined) return `{${name}}`
    return Array.isArray(value) ? value.join(', ') : String(value)
  })
}
