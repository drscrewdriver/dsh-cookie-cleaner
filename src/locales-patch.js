/**
 * dsh-cookie-cleaner — patch 体检/修复文案表（9 语并排）。
 *
 * 为什么单独成表而不塞进 `i18n.js` 的 dictionaries：判定码（P1-P12）与结果码的数量
 * 会随规则增长，而 `registerDictionary` 要求 8 语与 zh **逐键相等**，把易变键集塞进
 * 主字典会让每次加规则都要改 4 个文件。这里用「一码 × 九语」的并排表，
 * `tests/locales-patch.test.js` 机械核对九格齐备、占位符一致、拉丁语系无汉字假名。
 *
 * 约定：`{xxx}` 是插值位，任何语言都不许改名；未列出的语言回落 zh。
 */

/** 支持语言（与 `i18n.js` 的 LANGS 同序）。 */
export const PATCH_LANGS = Object.freeze(['zh', 'en', 'ja', 'ko', 'fr', 'de', 'it', 'ru', 'es'])

/** 九语并排构造器：一行的顺序就是 PATCH_LANGS 的顺序。 */
const t = (zh, en, ja, ko, fr, de, it, ru, es) => Object.freeze({ zh, en, ja, ko, fr, de, it, ru, es })

/** 判定码 → 说明。参数在 `{}` 内。 */
export const PATCH_CODES = Object.freeze({
  P1: t(
    '缺 connection 覆盖行，cookieMaxAgeDays 现为 {current}（目标 {target}）→ 历史凭据 cookie 会一直攒到过期',
    'no `connection` override row; cookieMaxAgeDays is {current} (target {target}) → stale credential cookies linger until they expire',
    'connection 上書き行がありません。cookieMaxAgeDays は {current}（目標 {target}）→ 過去の認証 cookie が期限まで残り続けます',
    'connection 재정의 행이 없습니다. cookieMaxAgeDays={current}(목표 {target}) → 이전 자격 증명 cookie가 만료까지 계속 쌓입니다',
    'aucune ligne de remplacement `connection` ; cookieMaxAgeDays = {current} (cible {target}) → les cookies de justification restent jusqu\'à expiration',
    'keine `connection`-Override-Zeile; cookieMaxAgeDays = {current} (Ziel {target}) → alte Anmeldungs-Cookies bleiben bis zum Ablauf',
    'manca la riga `connection`; cookieMaxAgeDays è {current} (obiettivo {target}) → i cookie di credenziali restano fino alla scadenza',
    'нет строки переопределения `connection`; cookieMaxAgeDays = {current} (цель {target}) → устаревшие cookies-учётные данные живут до истечения',
    'falta la fila `connection`; cookieMaxAgeDays es {current} (objetivo {target}) → las cookies de credenciales quedan hasta caducar'),
  P2: t(
    '覆盖行 name 是 {got}，宿主要求 {expected} → 整行被静默跳过，只在启动日志留一行 warn，配置实际未生效',
    'override row name is {got}, host expects {expected} → the whole row is silently skipped (boot-log warn only); the config never applies',
    '上書き行の name が {got}、宿主は {expected} を要求 → 行全体が黙ってスキップされ（起動ログに warn 一行）、設定は実際には効きません',
    '재정의 행의 name이 {got}, 호스트는 {expected} 요구 → 행 전체가 조용히 건너뛰기(부팅 로그 warn 한 줄), 설정이 실제로 적용되지 않음',
    'le nom de la ligne est {got}, l\'hôte attend {expected} → la ligne entière est ignorée silencieusement (warn au journal de démarrage) ; la config ne s\'applique pas',
    'Name der Override-Zeile ist {got}, Host erwartet {expected} → die ganze Zeile wird still übersprungen (nur Boot-Log-Warn); die Konfiguration gilt nicht',
    'il nome della riga è {got}, l\'host richiede {expected} → l\'intera riga viene saltata in silenzio (solo un warn nel log di avvio); la config non si applica',
    'имя строки переопределения {got}, хост ожидает {expected} → строка целиком молча пропускается (лишь warn в журнале запуска); настройка не действует',
    'el nombre de la fila es {got}, el host espera {expected} → la fila entera se omite en silencio (solo un warn en el log de arranque); la config no se aplica'),
  P3: t(
    'cookieMaxAgeDays 当前 {current}，比你设定的目标 {target} 天更长',
    'cookieMaxAgeDays is {current}, longer than your target of {target} days',
    'cookieMaxAgeDays は現在 {current} で、設定した目標 {target} 日より長いです',
    'cookieMaxAgeDays가 현재 {current}로, 설정한 목표 {target}일보다 깁니다',
    'cookieMaxAgeDays vaut {current}, plus long que votre cible de {target} jours',
    'cookieMaxAgeDays ist {current}, länger als Ihr Ziel von {target} Tagen',
    'cookieMaxAgeDays è {current}, più lungo dei {target} giorni prefissati',
    'cookieMaxAgeDays = {current}, дольше заданной цели в {target} дней',
    'cookieMaxAgeDays es {current}, más largo que tu objetivo de {target} días'),
  P4: t(
    '{key}={got} 不合法（必须 ≥{minimum} 的整数）——宿主 schema 会拒绝落盘，这里不试写',
    '{key}={got} is invalid (must be an integer ≥ {minimum}) — the host schema rejects it before disk, so nothing is attempted',
    '{key}={got} は不正（{minimum} 以上の整数が必要）——宿主 schema が書き込み前に拒否するため試みません',
    '{key}={got} 잘못됨({minimum} 이상의 정수 필요) — 호스트 스키마가 저장 전에 거부하므로 시도시도 하지 않음',
    '{key}={got} invalide (entier ≥ {minimum} requis) — le schéma de l\'hôte le refuse avant disque, rien n\'est tenté',
    '{key}={got} ungültig (Ganzzahl ≥ {minimum} nötig) — das Host-Schema verwirft es vor dem Schreiben, es wird nichts versucht',
    '{key}={got} non valido (serve intero ≥ {minimum}) — lo schema dell\'host lo rifiuta prima del disco, non si tenta nulla',
    '{key}={got} недопустимо (нужно целое ≥ {minimum}) — схема хоста отклоняет до записи на диск, попыток нет',
    '{key}={got} no válido (debe ser entero ≥ {minimum}) — el esquema del host lo rechaza antes del disco, no se intenta'),
  P5: t(
    '覆盖行少了 bundle 层已有的键：{dropped} → 浅赋值整块替换 config，这些键会落回插件 schema 默认，而不是 bundle 的值',
    'override row is missing keys the bundle layer sets: {dropped} → assignment replaces config wholesale, so those fall back to the plugin schema defaults, not the bundle values',
    '上書き行に bundle 行の键が欠落：{dropped} → 浅代入で config ごと置換されるため、插件 schema の既定値に落ち、bundle の値は失われます',
    '재정의 행에 bundle 행의 키가 빠짐: {dropped} → 얕은 대입이 config를 통째로 대체하므로 플러그인 스키마 기본값으로 떨어지고 bundle 값이 아님',
    'la ligne omitte des clés fixées par la couche bundle : {dropped} → l\'affectation remplace config entier, elles retombent sur les défauts du schéma, pas sur les valeurs du bundle',
    'der Override-Zeile fehlen vom Bundle gesetzte Schlüssel: {dropped} → Zuweisung ersetzt config ganz, diese fallen auf Schema-Standards zurück, nicht auf die Bundle-Werte',
    'la riga omette chiavi impostate dal layer bundle: {dropped} → l\'assegnazione sostituisce config intere, ricadono sui default dello schema, non sui valori del bundle',
    'в строке нет ключей, заданных слоем bundle: {dropped} → присваивание заменяет config целиком, они падают в default схемы плагина, а не в значения bundle',
    'a la fila le faltan claves de la capa bundle: {dropped} → la asignación reemplaza config completo, caen al default del esquema, no al valor del bundle'),
  P6: t(
    'home 层（~/.dsh/cordis.patch.yml）或命令行 overlay 也写了 {rowId}，它比 profile 更晚应用 → profile 写了也会被盖',
    'the home layer (~/.dsh/cordis.patch.yml) or a CLI overlay also sets {rowId}, and it applies after the profile → the profile value gets shadowed',
    'home 層（~/.dsh/cordis.patch.yml）やコマンドライン overlay も {rowId} を設定しており、profile より後に適用されるため上書きされます',
    'home 레이어(~/.dsh/cordis.patch.yml)나 CLI overlay도 {rowId}를 설정 — profile보다 나중에 적용되어 덮어쓰임',
    'la couche home (~/.dsh/cordis.patch.yml) ou un overlay CLI définit aussi {rowId} et s\'applique après le profil → la valeur du profil est éclipsée',
    'die Home-Ebene (~/.dsh/cordis.patch.yml) oder ein CLI-Overlay setzt ebenfalls {rowId} und greift nach dem Profil → der Profilwert wird überblendet',
    'anche il layer home (~/.dsh/cordis.patch.yml) o un overlay CLI impostano {rowId} e si applicano dopo il profilo → il valore del profilo viene oscurato',
    'домашний слой (~/.dsh/cordis.patch.yml) или overlay CLI тоже задаёт {rowId} и применяется после профиля → значение профиля перекрывается',
    'la capa home (~/.dsh/cordis.patch.yml) o un overlay de CLI también fijan {rowId} y se aplican tras el perfil → el valor del perfil queda eclipsado'),
  P7: t(
    '文件里是 {file}，运行时生效的是 {effective}（上层覆盖或热应用未跟上）',
    'the file says {file} but the running value is {effective} (an upper layer wins, or the hot reload has not caught up)',
    'ファイルは {file}、実行時有効値は {effective}（上位レイヤー優先、またはホットリロード未反映）',
    '파일은 {file}인데 실행 값은 {effective} — 상위 레이어가 이기거나 핫 리로드가 따라오지 않음',
    'le fichier indique {file} mais la valeur active est {effective} (couche supérieure gagne, ou rechargement à chaud en retard)',
    'die Datei sagt {file}, der laufende Wert ist aber {effective} (obere Ebene gewinnt, oder Hot-Reload hinkt hinterher)',
    'il file dice {file} ma il valore attivo è {effective} (vince il layer superiore o l\'hot reload non ha recuperato)',
    'в файле {file}, а действующее значение {effective} (верхний слой побеждает или горячая перезагрузка не успела)',
    'el archivo dice {file} pero el valor activo es {effective} (gana la capa superior o el recalentamiento no alcanzó)'),
  P8: t(
    'webserver.port 是字面量 {port} → 现在生效的就是这个值，启动层传来的 `--port` 压不动它（实测：传了 `--port` 宿主仍起在这个端口）；要跟随启动参数就写成 !!js 表达式形式',
    'webserver.port is a literal {port} → this is the value in force; a port from the launch layer cannot override it (measured: the host still listened on this port after `--port` was passed). Use the !!js expression form to follow the launch argument',
    'webserver.port がリテラル {port} → これが有効値で、起動層が渡す `--port` は上書きできません（実測：`--port` を渡してもこのポートで起動）。追随するには !!js 式形式に',
    'webserver.port가 리터럴 {port} → 지금 유효한 값이고 시작 계층의 `--port`가 앞설 수 없음(실측: `--port` 전달에도 이 포트 기동). 추종하려면 !!js 표현식 형태로',
    'webserver.port est un littéral {port} → c\'est la valeur en force, le `--port` du lancement ne la couvre pas (mesuré : l\'hôte écoute encore ce port après `--port`) ; mettre la forme !!js pour suivre l\'argument',
    'webserver.port ist Literal {port} → dieser Wert gilt, der `--port` des Starts überstimmt ihn nicht (gemessen: Host lauscht trotz `--port` auf diesem Port); für Folgsamkeit die !!js-Ausdrucksform',
    'webserver.port è un letterale {port} → questo è il valore effettivo, il `--port` del layer di avvio non lo scavalca (misurato: l\'host ascolta comunque questa porta con `--port`); usare la forma !!js per seguirla',
    'webserver.port — литерал {port} → действует это значение, `--port` из слоя запуска его не перебивает (замерено: хост всё равно слушает этот порт при `--port`); чтобы следовать аргументу запуска — форма !!js',
    'webserver.port es literal {port} → ese es el valor en vigor, el `--port` de la capa de arranque no lo supera (medido: el host sigue escuchando este puerto pese a `--port`); use la forma !!js para seguirlo'),
  P9: t(
    '{rowId} 的这些键在 bundle 层本是 !!js 表达式，覆盖层写成了字面量：{keys}（上游以后怎么改都不再跟进，值被钉死在抄下来的这一刻）',
    'these {rowId} keys are `!!js` expressions in the bundle layer but literals in the override: {keys} (later upstream changes no longer apply; the value is frozen at the moment it was copied)',
    '{rowId} のこれらの键は bundle 層では !!js 式ですが上書きではリテラル：{keys}（以後 upstream が変わっても追随せず、コピーした時点の値に固定されます）',
    '{rowId}의 이 키들은 bundle 레이어에선 !!js 표현식인데 재정의는 리터럴: {keys} — 이후 상류 설정이 바뀌어도 반영되지 않고 복사 시점 값에 고정됨',
    'ces clés {rowId} sont des expressions `!!js` dans le bundle mais des littéraux dans l\'override : {keys} (les changements amont ne s\'appliquent plus, la valeur reste figée au moment de la copie)',
    'diese {rowId}-Schlüssel sind im Bundle `!!js`-Ausdrücke, im Override aber Literale: {keys} (spätere Upstream-Änderungen greifen nicht mehr, der Wert ist seit dem Kopieren festgeschrieben)',
    'queste chiavi {rowId} sono espressioni `!!js` nel bundle ma letterali nell\'override: {keys} (le modifiche a monte non si applicano più, il valore resta congelato al momento della copia)',
    'эти ключи {rowId} в слое bundle — выражения `!!js`, а в переопределении — литералы: {keys} (последующие изменения вышестоящего слоя не применятся — значение зафиксировано в момент копирования)',
    'estas claves de {rowId} son expresiones `!!js` en el bundle pero literales en la sobrescritura: {keys} (los cambios aguas arriba ya no se aplican; el valor queda congelado desde que se copió)'),
  P10: t(
    '宿主树里找不到 id {rowId} → 该覆盖行被静默跳过（新增行要用 `- insert:`，不是裸 `- id:`）',
    'no entry with id {rowId} exists in the host tree → this override row is silently skipped (adding rows needs `- insert:`, not a bare `- id:`)',
    '宿主ツリーに id {rowId} が無い → この上書き行は黙ってスキップ（行追加は `- insert:` が要り、裸の `- id:` ではない）',
    '호스트 트리에 id {rowId}가 없음 → 이 재정의 행은 조용히 건너뜀(행 추가는 `- insert:`, 맨 `- id:` 아님)',
    'aucune entrée d\'id {rowId} dans l\'arbre de l\'hôte → la ligne est ignorée en silence (ajouter demande `- insert:`, pas un `- id:` nu)',
    'in der Host-Tabelle existiert keine id {rowId} → diese Override-Zeile wird still übersprungen (neue Zeilen brauchen `- insert:`, nicht ein nacktes `- id:`)',
    'nessuna voce con id {rowId} nell\'albero host → la riga viene saltata in silenzio (aggiungere righe richiede `- insert:`, non un `- id:` nudo)',
    'в дереве хоста нет записи с id {rowId} → строка молча пропущена (для добавления нужен `- insert:`, а не голое `- id:`)',
    'no existe ninguna entrada con id {rowId} en el árbol del host → la fila se omite en silencio (añadir filas requiere `- insert:`, no un `- id:` pelado)'),
  P11: t(
    'patch 层整层 YAML 非法（{reason}）→ 所有覆盖全部失效，先修语法再谈配置',
    'the whole patch layer is invalid YAML ({reason}) → every override is dead; fix the syntax before discussing config',
    'patch 層全体の YAML が不正（{reason}）→ すべての上書きが無効。まず構文を直してください',
    'patch 레이어 전체의 YAML이 잘못됨({reason}) → 모든 재정의가 무효, 먼저 구문부터',
    'la couche de patch entière est un YAML invalide ({reason}) → tous les remplacements sont morts ; corrigez la syntaxe d\'abord',
    'die gesamte Patch-Ebene ist ungültiges YAML ({reason}) → jeder Override ist tot; erst die Syntax reparieren',
    'l\'intero layer di patch è YAML non valido ({reason}) → ogni override è morto; prima sistemare la sintassi',
    'весь слой патчей — невалидный YAML ({reason}) → все переопределения мертвы; сначала синтаксис',
    'toda la capa de patch es YAML inválido ({reason}) → cada sobrescritura está muerta; arregla la sintaxis primero'),
  P12: t(
    '宿主正在热重载（HMR transactions cannot be nested），本次未写入；已自动重试一次仍失败，请片刻后再点',
    'the host is mid hot-reload (HMR transactions cannot be nested); nothing was written, one automatic retry already failed — try again shortly',
    '宿主がホットリロード中（HMR transactions cannot be nested）→ 書き込みなし。自動リトライ 1 回も失敗、稍後に再試行',
    '호스트가 핫 리로드 중(HMR transactions cannot be nested) → 기록 안 됨. 자동 재시도 1회도 실패, 잠시 후 다시 누르세요',
    'l\'hôte est en rechargement à chaud (HMR transactions cannot be nested) ; rien n\'a été écrit, une reprise automatique a déjà échoué — réessayez tout à l\'heure',
    'der Host lädt gerade heiß (HMR transactions cannot be nested); es wurde nichts geschrieben, ein automatischer Versuch scheiterte bereits — gleich erneut klicken',
    'l\'host è in hot-reload (HMR transactions cannot be nested); nulla è stato scritto, un ritentativo automatico è già fallito — riprova a breve',
    'хост сейчас в горячей перезагрузке (HMR transactions cannot be nested); ничего не записано, автоматический повтор уже не удался — попробуйте чуть позже',
    'el host está en recalentamiento (HMR transactions cannot be nested); no se escribió nada, un reintento automático ya falló — inténtalo en un momento'),
})

/** 结果与结构文案。 */
export const PATCH_TEXT = Object.freeze({
  title: t('profile patch 体检', 'profile patch check', 'profile patch 体検', 'profile patch 점검', 'inspection du patch de profil', 'Profil-Patch-Prüfung', 'controllo del patch del profilo', 'проверка патча профиля', 'revisión del patch de perfil'),
  vOk: t('结构健康', 'structurally sound', '構造は健全', '구조 정상', 'structure saine', 'strukturell in Ordnung', 'struttura integra', 'структура здорова', 'estructura sana'),
  // 结构无差异时的**肯定结论**：过去只说「结构健康」，用户看不出「注入没注入」这层——
  // 而这一层才是他反复检查 1+1 想确认的事。无偏差就该一句话说完，不逐行刷档位。
  injectOk: t('补丁设置注入正常：覆盖行已被宿主采纳，键集与运行态一致', 'patch settings are injected as written: the override rows are adopted by the host and match the live config', 'パッチ設定は注入されています：上書き行がホストに採用され、実行時設定と一致しています', '패치 설정이 정상 주입됨: 재정의 행이 호스트에 채택되었고 실행 값과 일치합니다', 'paramètres de patch injectés comme écrit : les lignes de réécriture sont adoptées par l\'hôte et concordent avec la config active', 'Patch-Einstellungen werden wie angegeben injiziert: die Override-Zeilen übernimmt der Host, sie stimmen mit der Laufzeit-Konfiguration überein', 'impostazioni della patch iniettate come scritto: le righe di override sono adottate dall\'host e corrispondono alla config attiva', 'настройки патча применены как указано: строки переопределения приняты хостом и совпадают с рабочей конфигурацией', 'ajustes del patch inyectados tal como están escritos: las filas de anulación las adopta el host y coinciden con la config activa'),
  vWarn: t('有偏差', 'deviates', '偏差あり', '편차 있음', 'dérive', 'Abweichung', 'in deviazione', 'отклонение', 'desviación'),
  vFail: t('会失效', 'will not take effect', '効きません', '적용 안 됨', 'sans effet', 'wirkt nicht', 'non avrà effetto', 'не сработает', 'no surtirá efecto'),
  vSkipped: t('无法判定', 'cannot decide', '判定不能', '판단 불가', 'indécidable', 'nicht bestimmbar', 'indecidibile', 'нельзя определить', 'indecidible'),
  rowConnection: t('connection（cookie 寿命所在）', 'connection (where cookie lifetime lives)', 'connection（cookie 寿命の設定場所）', 'connection(cookie 수명 위치)', 'connection (durée de vie des cookies)', 'connection (Cookie-Lebensdauer)', 'connection (durata dei cookie)', 'connection (срок жизни cookies)', 'connection (duración de las cookies)'),
  rowWebserver: t('webserver（只读体检）', 'webserver (read-only check)', 'webserver（読み取り専用）', 'webserver(읽기 전용)', 'webserver (lecture seule)', 'webserver (nur Lesetest)', 'webserver (solo lettura)', 'webserver (только проверка)', 'webserver (solo lectura)'),
  fixed: t('已写入：{changed}', 'written: {changed}', '書き込み完了：{changed}', '기록됨: {changed}', 'écrit : {changed}', 'geschrieben: {changed}', 'scritto: {changed}', 'записано: {changed}', 'escrito: {changed}'),
  auditLine: t('上次修复：{at}（修复前 {before} → 现在 {after}）', 'last fix: {at} (was {before} → now {after})', '前回修復：{at}（修復前 {before} → 現在 {after}）', '마지막 복구: {at}(복구 전 {before} → 현재 {after})', 'dernière réparation : {at} (de {before} à {after})', 'letzte Korrektur: {at} (vorher {before} → jetzt {after})', 'ultima correzione: {at} (da {before} a {after})', 'последнее исправление: {at} (было {before} → стало {after})', 'última reparación: {at} (de {before} a {after})'),
  auditLineNew: t('上次修复：{at}（此前无覆盖行 → 现在 {after}）', 'last fix: {at} (there was no override row before → now {after})', '前回修復：{at}（それまでカバー行無し → 現在 {after}）', '마지막 복구: {at}(그전엔 덮어쓰기 행 없음 → 현재 {after})', 'dernière réparation : {at} (aucune ligne de couverture avant → maintenant {after})', 'letzte Korrektur: {at} (vorher keine Override-Zeile → jetzt {after})', 'ultima correzione: {at} (prima nessuna riga di override → ora {after})', 'последнее исправление: {at} (раньше строки переопределения не было → теперь {after})', 'última reparación: {at} (antes no había fila de anulación → ahora {after})'),
  // 实时读数（读得到才给）：条数、折算的请求头字节、占用百分比、距 431 阈值的余量。
  // 百分比是估算（value 列存的是密文，明文长度按上游报告一致值），文案里用「约」不假装精确。
  cookieLive: t('cookie 库实时读数：{count} 条 dsh-auth-*（共 {total} 条），请求头约 {bytes} B / 上限 {max} B（{pct}%），距 431 阈值还剩约 {remaining} 条', 'live cookie reading: {count} dsh-auth-* rows ({total} total), request header ~{bytes} B of {max} B ({pct}%), roughly {remaining} more rows before 431', 'cookie ライブ读数：dsh-auth-* {count} 件（合計 {total} 件）、リクエストヘッダ約 {bytes} B / 上限 {max} B（{pct}%）、431 まであと約 {remaining} 件', 'cookie 실시간 수치: dsh-auth-* {count}건(총 {total}건), 요청 헤더 약 {bytes}B / 상한 {max}B({pct}%), 431까지 약 {remaining}건 남음', 'lecture en direct des cookies : {count} entrées dsh-auth-* ({total} au total), en-tête ~{bytes} B sur {max} B ({pct} %), environ {remaining} entrées avant 431', 'Live-Ableseung der Cookies: {count} dsh-auth-* Einträge ({total} gesamt), Header ~{bytes} B von {max} B ({pct} %), noch ~{remaining} Einträge bis 431', 'lettura live dei cookie: {count} voci dsh-auth-* ({total} totali), header ~{bytes} B su {max} B ({pct}%), ancora ~{remaining} voci prima di 431', 'текущее чтение cookie: {count} записей dsh-auth-* (всего {total}), заголовок ~{bytes} Б из {max} Б ({pct}%), до 431 остаётся ~{remaining} записей', 'lectura en vivo de cookies: {count} filas dsh-auth-* ({total} en total), cabecera ~{bytes} B de {max} B ({pct} %), quedan ~{remaining} filas para 431'),
  // 借宿主已打开的句柄拿到的快照：数字是真的，但不是实时。说成实时就是谎报。
  cookieLiveSnapshot: t('cookie 库快照读数（借宿主句柄，非实时）：{count} 条 dsh-auth-*（共 {total} 条），请求头约 {bytes} B / 上限 {max} B（{pct}%），距 431 阈值还剩约 {remaining} 条', 'cookie reading via a borrowed host handle (not live): {count} dsh-auth-* rows ({total} total), request header ~{bytes} B of {max} B ({pct}%), roughly {remaining} more rows before 431', 'スナップショット读数（宿主のハンドル借用、非实时）：dsh-auth-* {count} 件（合計 {total} 件）、ヘッダ約 {bytes} B / 上限 {max} B（{pct}%）、431 まであと約 {remaining} 件', '스냅샷 수치(호스트 핸들 빌림, 비실시간): dsh-auth-* {count}건(총 {total}건), 헤더 약 {bytes}B / 상한 {max}B({pct}%), 431까지 약 {remaining}건', 'lecture par instantané (poignée prêtée à l\'hôte, non temps réel) : {count} entrées dsh-auth-* ({total} au total), en-tête ~{bytes} B sur {max} B ({pct} %), ~{remaining} entrées avant 431', 'Schnappschuss-Ableseung (geliehener Host-Handle, nicht live): {count} dsh-auth-* Einträge ({total} gesamt), Header ~{bytes} B von {max} B ({pct} %), noch ~{remaining} Einträge bis 431', 'lettura da istantanea (maniglia host prestata, non live): {count} voci dsh-auth-* ({total} totali), header ~{bytes} B su {max} B ({pct}%), ancora ~{remaining} voci prima di 431', 'снимок (одалживаемый дескриптор хоста, не в реальном времени): {count} записей dsh-auth-* (всего {total}), заголовок ~{bytes} Б из {max} Б ({pct}%), до 431 остаётся ~{remaining} записей', 'lectura por instantánea (asa del host prestada, no en vivo): {count} filas dsh-auth-* ({total} en total), cabecera ~{bytes} B de {max} B ({pct} %), quedan ~{remaining} filas para 431'),
  // 读不到的三种原因必须分开：把“路径没找到/权限不够”说成“被 Chromium 占”会误引导。
  cookieMissing: t('cookie 库现状：没在预期位置找到库（安装方式可能不同），可用 --db=<完整路径> 指定', 'cookie store: no database found at the expected locations (the install may differ); pass --db=<full path>', 'cookie 庫：期待する場所に見つかりません（インストール形態の違いかも）。--db=<完全パス> で指定可', 'cookie 저장소: 예상 위치에서 파일을 찾지 못함(설치 형태 차이 가능) → --db=<전체 경로> 로 지정', 'base de cookies : aucune base aux emplacements attendus (installation différente ?) ; utilisez --db=<chemin complet>', 'Cookie-Speicher: keine Datenbank an den erwarteten Orten (ggf. andere Installation) — --db=<vollständiger Pfad> verwenden', 'archivio cookie: nessun database nei percorsi attesi (installazione diversa?) ; usare --db=<percorso completo>', 'хранилище cookie: база не найдена в ожидаемых местах (возможно, другая установка) — укажите --db=<полный путь>', 'almacén de cookies: no se encontró la base en las rutas esperadas (instalación distinta) ; use --db=<ruta completa>'),
  cookiePermission: t('cookie 库现状：当前用户读不了这个文件（权限/属主问题），不是客户端占用', 'cookie store: the current user cannot read this file (permissions/owner), the client is not holding it', 'cookie 庫：現ユーザーはこのファイルを読めません（権限/所有者の問題）で、クライアント占有ではない', 'cookie 저장소: 현재 사용자 권한으로 읽을 수 없음(권한/소유자 문제), 클라이언트 점유 아님)', 'base de cookies : l\'utilisateur actuel ne peut pas lire ce fichier (permissions/propriétaire), ce n\'est pas le client qui le retient', 'Cookie-Speicher: dieser Benutzer kann die Datei nicht lesen (Rechte/Besitzer), nicht der Client hält sie', 'archivio cookie: l\'utente corrente non può leggere il file (permessi/proprietario), non lo trattiene il client', 'хранилище cookie: текущий пользователь не может прочитать файл (права/владелец), это не блокировка клиентом', 'almacén de cookies: el usuario actual no puede leer este archivo (permisos/propietario), no lo retiene el cliente'),
  cookieBusy: t('cookie 库现状：客户端运行期读不到（被 Chromium 独占），条数需关闭客户端后跑 CLI', 'cookie store: unreadable while the client runs (Chromium holds it exclusively); count needs the CLI with the client closed', 'cookie 庫の現状：クライアント起動中は読めません（Chromium が排他保持）、件数は終了後に CLI で', 'cookie 저장소: 클라이언트 실행 중 읽기 불가(Chromium 배타 점유), 수는 종료 후 CLI로', 'base de cookies : illisible pendant que le client tourne (Chromium la retient) ; le nombre exige la CLI client fermé', 'Cookie-Speicher: während des Client-Laufs nicht lesbar (Chromium hält ihn exklusiv); die Zahl braucht die CLI bei geschlossenem Client', 'archivio cookie: illeggibile mentre il client è attivo (Chromium lo trattiene); il conteggio richiede la CLI a client chiuso', 'хранилище cookie: недоступно для чтения при запущенном клиенте (Chromium держит эксклюзивно); число требует CLI при закрытом клиенте', 'almacén de cookies: ilegible mientras el cliente corre (Chromium lo retiene); el conteo requiere la CLI con el cliente cerrado'),
  noop: t('无需写入（已在目标档）', 'nothing to write (already on target)', '書き込み不要（目標達成済み）', '기록 불필요(이미 목표)', 'rien à écrire (déjà à la cible)', 'nichts zu schreiben (bereits am Ziel)', 'nulla da scrivere (già all\'obiettivo)', 'нечего писать (уже в цели)', 'nada que escribir (ya en el objetivo)'),
  blocked: t('判定为不可动作，未写入（{codes}）', 'judged not actionable; nothing written ({codes})', '動作不可と判定、書き込みなし（{codes}）', '조치 불가로 판정, 기록 없음({codes})', 'jugé non exécutable ; rien écrit ({codes})', 'als nicht ausführbar eingestuft; nichts geschrieben ({codes})', 'giudicato non eseguibile; nulla scritto ({codes})', 'признано невыполнимым; ничего не записано ({codes})', 'juzgado no accionable; nada escrito ({codes})'),
  failed: t('写入失败：{message}', 'write failed: {message}', '書き込み失敗：{message}', '기록 실패: {message}', 'échec d\'écriture : {message}', 'Schreiben fehlgeschlagen: {message}', 'scrittura fallita: {message}', 'ошибка записи: {message}', 'fallo de escritura: {message}'),
  reverted: t('已回到修复前的配置：{changed}', 'restored to the pre-fix config: {changed}', '修復前の設定に戻しました：{changed}', '복구 전 설정으로 되돌림: {changed}', 'retour à la config d\'avant réparation : {changed}', 'zurück auf die Konfiguration vor dem Fix: {changed}', 'ritorno alla config pre-fix: {changed}', 'возврат к конфигурации до исправления: {changed}', 'restaurada la config previa a la reparación: {changed}'),
  noSnapshot: t('没有可回滚的快照（修复一次才会留一份）', 'no snapshot to roll back to (one is kept on a successful fix)', '回滚用スナップショット無し（修復時に 1 件保存）', '롤백 스냅샷 없음(성공적 복구 시 1개 보관)', 'aucun instantané à restaurer (un fix réussi en garde un)', 'kein Snapshot zum Zurückrollen (ein erfolgreicher Fix hinterlässt einen)', 'nessuno snapshot da ripristinare (un fix riuscito ne conserva uno)', 'нет снимка для отката (успешное исправление сохраняет один)', 'no hay instantánea a la que volver (una reparación correcta guarda una)'),
  planFor: t('把下面这段手工放进 {file}（若根是 flow `[]`，要先删掉那一行）：', 'paste this block into {file} (if the root is a flow `[]`, delete that line first):', '以下のブロックを {file} に手動で置いてください（根が flow `[]` ならその行を削除）：', '아래 블록을 {file}에 직접 넣으세요(루트가 flow `[]`면 그 줄을 먼저 삭제):', 'collez ce bloc dans {file} (si la racine est un `[]` en flux, supprimez d\'abord cette ligne) :', 'fügen Sie diesen Block in {file} ein (falls die Wurzel ein Fluss-`[]` ist, erst diese Zeile löschen):', 'incolla questo blocco in {file} (se la radice è un `[]` in forma flow, prima cancella quella riga):', 'вставьте этот блок в {file} (если корень — поток `[]`, сначала удалите эту строку):', 'pega este bloque en {file} (si la raíz es un `[]` en flujo, borra primero esa línea):'),
  // 表达式被抄成字面量（P9）不再进体检结论，只在处方里提一句；这里给的是“拿到跟随形态”的动作。
  exprFrozenHint: t('要拿到跟随形态的粘贴块：把本插件设置里的 guardMode 切到 expression，再跑一次 patch plan', 'to get a paste block in the following form: set guardMode to expression in this plugin\'s settings, then run patch plan again', '追随形态の貼り付け块が欲しい場合：本プラグイン設定の guardMode を expression に切り、patch plan を再実行', '추종 형태 블록을 받으려면: 이 플러그인 설정에서 guardMode를 expression으로 바꾸고 patch plan을 다시 실행', 'pour obtenir un bloc au forme suiveuse : passez guardMode à expression dans les réglages de ce plugin, puis relancez patch plan', 'für ein Block in Folgsamkeitsform: guardMode in den Einstellungen dieses Plugins auf expression setzen und patch plan erneut ausführen', 'per ottenere un blocco in forma seguace: imposta guardMode su expression nelle impostazioni di questo plugin, poi riesegui patch plan', 'чтобы получить блок в следящей форме: переведите guardMode в expression в настройках этого плагина и снова выполните patch plan', 'para obtener un bloque en forma de seguimiento: pon guardMode en expression en los ajustes de este plugin y vuelve a ejecutar patch plan'),
  // 端口动作的结果句式。三档热生效状态由探针给出，无据就明说无据，不拿配置猜。
  portApplied: t('已写入端口表达式：port = !!js {expr}', 'wrote the port expression: port = !!js {expr}', 'ポート式を書き込みました：port = !!js {expr}', '포트 표현식을 기록함: port = !!js {expr}', 'expression de port écrite : port = !!js {expr}', 'Port-Ausdruck geschrieben: port = !!js {expr}', 'espressione della porta scritta: port = !!js {expr}', 'выражение порта записано: port = !!js {expr}', 'expresión de puerto escrita: port = !!js {expr}'),
  portHot: t('新端口已在监听（本次已热生效）', 'the new port is already listening (applied live)', '新しいポートが既に受信しています（今回ホット反映）', '새 포트가 이미 수신 중(이번에 열반영)', 'le nouveau port écoute déjà (appliqué à chaud)', 'der neue Port lauscht bereits (heiß angewendet)', 'la nuova porta è già in ascolto (applicata a caldo)', 'новый порт уже слушает (применено сразу)', 'el nuevo puerto ya está escuchando (aplicado en caliente)'),
  portRestart: t('配置已写但监听仍在旧端口 → 下次启动生效', 'config written, the live listener is still on the old port → takes effect at next launch', '設定は書き込みましたがまだ旧ポートで受信しています → 次回起動時に有効', '설정은 기록됐지만 아직 옛 포트에서 수신 중 → 다음 시작 때 적용', 'config écrite, l\'écoute est encore sur l\'ancien port → effet au prochain lancement', 'Konfiguration geschrieben, das Lauschen bleibt am alten Port → wirksam beim nächsten Start', 'config scritta, l\'ascolto resta sulla porta vecchia → effettivo al prossimo avvio', 'конфигурация записана, но слушает старый порт → вступит в силу при следующем запуске', 'config escrita, pero sigue escuchando el puerto viejo → efectivo en el próximo arranque'),
  portUnknown: t('是否热生效无据（探针未能定论），新值会在下次启动生效', 'whether it applied live is undetermined (the probe was inconclusive); the new value takes effect at next launch', 'ホット反映されたかは判定不能（プローブが結論できず）。新値は次回起動時に有効', '열반영 여부는 판단 불가(프로브가 결론 못 냄), 새 값은 다음 시작 때 적용', 'l\'effet à chaud est indécidable (sonde non concluante) ; la nouvelle valeur s\'applique au prochain lancement', 'ob heiß angewendet ist unklar (Sonde nicht eindeutig); der neue Wert gilt beim nächsten Start', 'se sia applicata a caldo è indecidibile (sonda inconcludente); il nuovo valore vale al prossimo avvio', 'применено ли горячо — не определено (зонд не дал ответа); новое значение вступит в силу при следующем запуске', 'si se aplicó en caliente es indecidible (la sonda no fue concluyente); el nuevo valor rige en el próximo arranque'),
  portBusy: t('目标端口 {port} 在本机已被占用（探针看到有人监听），未写入——换一个端口再试', 'the target port {port} is already occupied on this host (the probe saw a listener), nothing was written — pick another port', '対象ポート {port} はこのマシンで使用中（プローブが受信者を検知）。書き込みません — 別のポートで再試行', '대상 포트 {port}가 이 기기에서 사용 중(프로브가 수신자 감지) → 기록하지 않음, 다른 포트으로 다시 시도', 'le port cible {port} est déjà occupé sur cette machine (la sonde a vu un écouteur), rien n\'a été écrit — choisissez un autre port', 'der Ziel-Port {port} ist auf diesem Rechner belegt (Sonde sah einen Lauscher), nichts geschrieben — anderen Port wählen', 'la porta di destinazione {port} è già occupata su questa macchina (la sonda ha visto un ascoltatore), nulla scritto — scegli un\'altra porta', 'целевой порт {port} на этой машине уже занят (зонд увидел слушателя), ничего не записано — выберите другой порт', 'el puerto de destino {port} ya está ocupado en esta máquina (la sonda vio un oyente), no se escribió nada — elija otro puerto'),
  portInvalid: t('端口必须是 {minimum}-{maximum} 的整数，收到 {got}；本插件不替你定默认端口', 'the port must be an integer {minimum}-{maximum}, got {got}; this plugin does not pick a default port for you', 'ポートは {minimum}-{maximum} の整数が必要、受信 {got}；本プラグインは既定ポートを決めません', '포트는 {minimum}-{maximum} 정수여 함, 입력 {got}; 이 플러그인은 기본 포트를 정하지 않음', 'le port doit être un entier {minimum}-{maximum}, reçu {got} ; ce plugin ne choisit pas de port par défaut', 'der Port muss eine Ganzzahl {minimum}-{maximum} sein, erhalten {got}; dieses Plugin setzt keinen Standardport für Sie', 'la porta deve essere un intero {minimum}-{maximum}, ricevuto {got}; questo plugin non sceglie una porta predefinita', 'порт должен быть целым {minimum}-{maximum}, получено {got}; этот плагин не выбирает порт по умолчанию', 'el puerto debe ser un entero {minimum}-{maximum}, se recibió {got}; este plugin no elige un puerto predeterminado'),
  // 端口热生效会立刻把旧端口页面踢下线：必须在输入框旁常驻提醒，否则用户会被自己锁在门外。
  portSwitchWarn: t('⚠ 端口改完立即生效：旧端口的当前页面会失联，必须马上用新端口地址重新访问（或重启客户端），server 与 browser 的端口号要同步改', '⚠ the port takes effect immediately: this page on the old port will drop, so re-open it at the new port right away (or restart the client) — keep the server and browser ports in sync', '⚠ ポートは即座に有効化：旧ポートの現ページは切断されます。直ちに新ポート地址で開き直すかクライアントを再起動してください（server と browser のポートを揃える）', '⚠ 포트가 즉시 반영됨: 옛 포트의 현재 페이지가 끊깁니다. 새 포트 주소로 즉시 다시 열거나 클라이언트를 재시작하세요(server와 browser 포트 동기화)', '⚠ le port prend effet immédiatement : cette page sur l\'ancien port se déconnecte, rouvrez-la tout de suite sur le nouveau port (ou redémarrez le client) — alignez les ports server et browser', '⚠ der Port wirkt sofort: diese Seite am alten Port trennt sich — öffnen Sie sie sogleich über den neuen Port (oder starten Sie den Client neu), server- und Browser-Port müssen übereinstimmen', '⚠ la porta ha effetto immediato: questa pagina sulla porta vecchia si disconnette; riapritela subito al nuovo port (o riavvia il client) — allinea le porte di server e browser', '⚠ порт применяется сразу: эта страница на старом порту отвалится — немедленно откройте по новому порту (или перезапустите клиент); порты server и browser должны совпадать', '⚠ el puerto surte efecto de inmediato: esta página en el puerto viejo se desconecta; ábrala de nuevo en el puerto nuevo (o reinicie el cliente) — alinee los puertos de server y navegador'),
  webserverNote: t('webserver 行不被「修复」自动改写：端口属启动行为面，要改请用面板的「应用端口」（只写表达式形式，`--port` 仍优先）', 'the webserver row is never auto-written by Fix: the port is a launch-behaviour decision - use the panel\'s Apply port instead (written as an expression, so `--port` still wins)', 'webserver 行は「修復」で自動改写されません：ポートは起動挙動の話、パネルの「ポート適用」を使ってください（表达式形式のみ、`--port` が優先されます）', 'webserver 행은 "복구"로 자동 기록되지 않음: 포트는 시작 동작 판단이니 패널의 "포트 적용"을 쓰세요(표현식 형태만 기록, `--port` 우선)', 'la ligne webserver n\'est jamais écrite par Réparer : le port relève du lancement, utilisez « Appliquer le port » du panneau (écrit en expression, `--port` gagne toujours)', 'die webserver-Zeile wird durch Fixen nie automatisch geschrieben: der Port ist Startverhalten, nutzen Sie „Port anwenden" im Panel (als Ausdruck geschrieben, `--port` bleibt oben)', 'la riga webserver non è mai scritta da Correggi: la porta riguarda l\'avvio, usa «Applica porta» nel pannello (scritta come espressione, `--port` continua a vincere)', 'строка webserver не пишется кнопкой «Исправить»: порт — вопрос запуска, используйте «Применить порт» в панели (пишется выражением, `--port` по-прежнему важнее)', 'la fila webserver nunca la escribe Reparar: el puerto concierne al arranque, usa «Aplicar puerto» en el panel (se escribe como expresión, `--port` sigue ganando)'),
  nextFix: t('下一步：面板点「修复」，或执行 /cookie-cleaner patch fix', 'next: press Fix in the panel, or run /cookie-cleaner patch fix', '次の一手：パネルの「修復」を押すか /cookie-cleaner patch fix を実行', '다음: 패널에서 "복구"를 누르거나 /cookie-cleaner patch fix 실행', 'étape suivante : « Réparer » dans le panneau, ou /cookie-cleaner patch fix', 'nächster Schritt: im Panel „Fixen“, oder /cookie-cleaner patch fix', 'passo successivo: «Correggi» nel pannello, oppure /cookie-cleaner patch fix', 'следующий шаг: «Исправить» в панели или /cookie-cleaner patch fix', 'siguiente paso: «Reparar» en el panel, o /cookie-cleaner patch fix'),
  noService: t('本机宿主没有 config-editor 服务（老线或未装配），体检无法在线进行', 'this host has no config-editor service (older line or not assembled), so an online check is impossible', 'この宿主に config-editor サービスが無いため（旧ライン/未装配）、オンライン検査は不可', '이 호스트에 config-editor 서비스가 없음(구 라인/미조립) → 온라인 점검 불가', 'cet hôte n\'a pas de service config-editor (ancienne ligne ou non assemblé), contrôle en ligne impossible', 'dieser Host hat keinen config-editor-Dienst (ältere Zeile oder nicht montiert), Online-Prüfung unmöglich', 'questo host non ha il servizio config-editor (linea vecchia o non assemblato), controllo online impossibile', 'у этого хоста нет сервиса config-editor (старая линия или не собран), онлайн-проверка невозможна', 'este host no tiene el servicio config-editor (línea antigua o no ensamblado), control en línea imposible'),
  missingProfile: t('该 profile 不存在（目录里没有 cordis.patch.yml 且上级目录也不在）——无据可判，不是配置有问题', 'that profile does not exist (no cordis.patch.yml and its parent directory is missing) — nothing to judge, not a config defect', 'その profile は存在しません（cordis.patch.yml 無く、親ディレクトリも無い）——判定根拠無し、設定不備ではない', '해당 프로필이 존재하지 않습니다(cordis.patch.yml 없음, 상위 디렉터리도 없음) — 판단 근거 없음, 설정 결함이 아님', 'ce profil n\'existe pas (pas de cordis.patch.yml et le dossier parent manque) — rien à juger, pas un défaut de config', 'dieses Profil existiert nicht (kein cordis.patch.yml, auch das Elternverzeichnis fehlt) — keine Grundlage, kein Konfigurationsfehler', 'quel profilo non esiste (nessun cordis.patch.yml e manca la cartella superiore) — nulla da giudicare, non un difetto di config', 'этот профиль не существует (нет cordis.patch.yml и отсутствует родительский каталог) — нечего судить, это не дефект конфигурации', 'ese perfil no existe (no hay cordis.patch.yml y falta el directorio padre) — nada que juzgar, no es un defecto de configuración'),
  offlineNote: t('（离线档）只能看到文件层；运行态与 bundle 层的对比（P5/P7/P9）需要启动客户端后面板/命令来查', '(offline mode) only the file layer is visible; the runtime/bundle-layer comparisons (P5/P7/P9) need the panel or command while the client runs', '（オフライン档）ファイル層のみ閲覧可。実行状態と bundle 層の比較（P5/P7/P9）はクライアント起動後にパネル/コマンドで', '(오프라인 모드) 파일 레이어만 보입니다. 런타임/bundle 레이어 비교(P5/P7/P9)는 클라이언트 실행 후 패널/명령으로', '(mode hors ligne) seule la couche fichier est visible ; les comparaisons runtime/bundle (P5/P7/P9) exigent le panneau ou la commande avec le client lancé', '(Offline-Modus) nur die Dateiebene ist sichtbar; die Vergleiche Laufzeit/Bundle-Ebene (P5/P7/P9) brauchen Panel oder Befehl bei laufendem Client', '(modalità offline) si vede solo il layer file; i confronti runtime/layer bundle (P5/P7/P9) richiedono pannello o comando a client attivo', '(офлайн-режим) виден только слой файла; сравнения рантайма и слоя bundle (P5/P7/P9) нужны панель или команда при запущенном клиенте', '(modo sin conexión) solo se ve la capa de archivo; las comparaciones runtime/capa bundle (P5/P7/P9) necesitan el panel o el comando con el cliente activo'),
  editedExternally: t('（提示）profile patch 也可被宿主插件管理器或手改变更，体检以当前运行树为准', '(note) the profile patch may also change via the host plugin manager or hand edits; the check reports the current running tree', '（参考）profile patch は宿主のプラグインマネージャーや手編集でも変わります。体検は現在の実行中ツリーを基準にします', '(참고) profile patch는 호스트 플러그인 관리자나 수동 편집으로도 바뀜. 점검은 현재 실행 트리를 기준으로 함', '(note) le patch de profil peut aussi évoluer via le gestionnaire de plugins ou à la main ; le contrôle rend l\'arbre courant', '(Hinweis) der Profil-Patch kann sich auch über den Plugin-Manager oder per Hand ändern; die Prüfung meldet den laufenden Baum', '(nota) il patch del profilo può cambiare anche tramite il gestore plugin o a mano; il controllo riporta l\'albero in esecuzione', '(примечание) патч профиля может меняться через менеджер плагинов или вручную; проверка даёт текущее дерево', '(nota) el patch del perfil también cambia vía el gestor de plugins o a mano; la revisión reporta el árbol en ejecución'),
})

/**
 * 取一条文案。
 * @param {'code'|'text'} bucket 判定表还是结果表
 * @param {string} key
 * @param {string} lang
 * @param {Record<string, unknown>} [params]
 */
export function patchText(bucket, key, lang, params = {}) {
  const table = bucket === 'code' ? PATCH_CODES : PATCH_TEXT
  const entry = table[key]
  if (entry === undefined) return `${key}`
  const raw = entry[lang] ?? entry.zh
  return String(raw).replace(/\{(\w+)\}/g, (_m, name) => {
    const value = params[name]
    if (value === undefined) return `{${name}}`
    return Array.isArray(value) ? value.join(', ') : String(value)
  })
}
