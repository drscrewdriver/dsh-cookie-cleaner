window.__ModuleLoader__.load({
	id: "dsh-cookie-cleaner",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		let react = require("react");
		react = __toESM(react, 1);
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/locales-patch.js
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
		const PATCH_LANGS = Object.freeze([
			"zh",
			"en",
			"ja",
			"ko",
			"fr",
			"de",
			"it",
			"ru",
			"es"
		]);
		/** 九语并排构造器：一行的顺序就是 PATCH_LANGS 的顺序。 */
		const t$1 = (zh, en, ja, ko, fr, de, it, ru, es) => Object.freeze({
			zh,
			en,
			ja,
			ko,
			fr,
			de,
			it,
			ru,
			es
		});
		/** 判定码 → 说明。参数在 `{}` 内。 */
		const PATCH_CODES = Object.freeze({
			P1: t$1("缺 connection 覆盖行，cookieMaxAgeDays 现为 {current}（目标 {target}）→ 历史凭据 cookie 会一直攒到过期", "no `connection` override row; cookieMaxAgeDays is {current} (target {target}) → stale credential cookies linger until they expire", "connection 上書き行がありません。cookieMaxAgeDays は {current}（目標 {target}）→ 過去の認証 cookie が期限まで残り続けます", "connection 재정의 행이 없습니다. cookieMaxAgeDays={current}(목표 {target}) → 이전 자격 증명 cookie가 만료까지 계속 쌓입니다", "aucune ligne de remplacement `connection` ; cookieMaxAgeDays = {current} (cible {target}) → les cookies de justification restent jusqu'à expiration", "keine `connection`-Override-Zeile; cookieMaxAgeDays = {current} (Ziel {target}) → alte Anmeldungs-Cookies bleiben bis zum Ablauf", "manca la riga `connection`; cookieMaxAgeDays è {current} (obiettivo {target}) → i cookie di credenziali restano fino alla scadenza", "нет строки переопределения `connection`; cookieMaxAgeDays = {current} (цель {target}) → устаревшие cookies-учётные данные живут до истечения", "falta la fila `connection`; cookieMaxAgeDays es {current} (objetivo {target}) → las cookies de credenciales quedan hasta caducar"),
			P2: t$1("覆盖行 name 是 {got}，宿主要求 {expected} → 整行被静默跳过，只在启动日志留一行 warn，配置实际未生效", "override row name is {got}, host expects {expected} → the whole row is silently skipped (boot-log warn only); the config never applies", "上書き行の name が {got}、宿主は {expected} を要求 → 行全体が黙ってスキップされ（起動ログに warn 一行）、設定は実際には効きません", "재정의 행의 name이 {got}, 호스트는 {expected} 요구 → 행 전체가 조용히 건너뛰기(부팅 로그 warn 한 줄), 설정이 실제로 적용되지 않음", "le nom de la ligne est {got}, l'hôte attend {expected} → la ligne entière est ignorée silencieusement (warn au journal de démarrage) ; la config ne s'applique pas", "Name der Override-Zeile ist {got}, Host erwartet {expected} → die ganze Zeile wird still übersprungen (nur Boot-Log-Warn); die Konfiguration gilt nicht", "il nome della riga è {got}, l'host richiede {expected} → l'intera riga viene saltata in silenzio (solo un warn nel log di avvio); la config non si applica", "имя строки переопределения {got}, хост ожидает {expected} → строка целиком молча пропускается (лишь warn в журнале запуска); настройка не действует", "el nombre de la fila es {got}, el host espera {expected} → la fila entera se omite en silencio (solo un warn en el log de arranque); la config no se aplica"),
			P3: t$1("cookieMaxAgeDays 当前 {current}，比你设定的目标 {target} 天更长", "cookieMaxAgeDays is {current}, longer than your target of {target} days", "cookieMaxAgeDays は現在 {current} で、設定した目標 {target} 日より長いです", "cookieMaxAgeDays가 현재 {current}로, 설정한 목표 {target}일보다 깁니다", "cookieMaxAgeDays vaut {current}, plus long que votre cible de {target} jours", "cookieMaxAgeDays ist {current}, länger als Ihr Ziel von {target} Tagen", "cookieMaxAgeDays è {current}, più lungo dei {target} giorni prefissati", "cookieMaxAgeDays = {current}, дольше заданной цели в {target} дней", "cookieMaxAgeDays es {current}, más largo que tu objetivo de {target} días"),
			P4: t$1("{key}={got} 不合法（必须 ≥{minimum} 的整数）——宿主 schema 会拒绝落盘，这里不试写", "{key}={got} is invalid (must be an integer ≥ {minimum}) — the host schema rejects it before disk, so nothing is attempted", "{key}={got} は不正（{minimum} 以上の整数が必要）——宿主 schema が書き込み前に拒否するため試みません", "{key}={got} 잘못됨({minimum} 이상의 정수 필요) — 호스트 스키마가 저장 전에 거부하므로 시도시도 하지 않음", "{key}={got} invalide (entier ≥ {minimum} requis) — le schéma de l'hôte le refuse avant disque, rien n'est tenté", "{key}={got} ungültig (Ganzzahl ≥ {minimum} nötig) — das Host-Schema verwirft es vor dem Schreiben, es wird nichts versucht", "{key}={got} non valido (serve intero ≥ {minimum}) — lo schema dell'host lo rifiuta prima del disco, non si tenta nulla", "{key}={got} недопустимо (нужно целое ≥ {minimum}) — схема хоста отклоняет до записи на диск, попыток нет", "{key}={got} no válido (debe ser entero ≥ {minimum}) — el esquema del host lo rechaza antes del disco, no se intenta"),
			P5: t$1("覆盖行少了 bundle 层已有的键：{dropped} → 浅赋值整块替换 config，这些键会落回插件 schema 默认，而不是 bundle 的值", "override row is missing keys the bundle layer sets: {dropped} → assignment replaces config wholesale, so those fall back to the plugin schema defaults, not the bundle values", "上書き行に bundle 行の键が欠落：{dropped} → 浅代入で config ごと置換されるため、插件 schema の既定値に落ち、bundle の値は失われます", "재정의 행에 bundle 행의 키가 빠짐: {dropped} → 얕은 대입이 config를 통째로 대체하므로 플러그인 스키마 기본값으로 떨어지고 bundle 값이 아님", "la ligne omitte des clés fixées par la couche bundle : {dropped} → l'affectation remplace config entier, elles retombent sur les défauts du schéma, pas sur les valeurs du bundle", "der Override-Zeile fehlen vom Bundle gesetzte Schlüssel: {dropped} → Zuweisung ersetzt config ganz, diese fallen auf Schema-Standards zurück, nicht auf die Bundle-Werte", "la riga omette chiavi impostate dal layer bundle: {dropped} → l'assegnazione sostituisce config intere, ricadono sui default dello schema, non sui valori del bundle", "в строке нет ключей, заданных слоем bundle: {dropped} → присваивание заменяет config целиком, они падают в default схемы плагина, а не в значения bundle", "a la fila le faltan claves de la capa bundle: {dropped} → la asignación reemplaza config completo, caen al default del esquema, no al valor del bundle"),
			P6: t$1("home 层（~/.dsh/cordis.patch.yml）或命令行 overlay 也写了 {rowId}，它比 profile 更晚应用 → profile 写了也会被盖", "the home layer (~/.dsh/cordis.patch.yml) or a CLI overlay also sets {rowId}, and it applies after the profile → the profile value gets shadowed", "home 層（~/.dsh/cordis.patch.yml）やコマンドライン overlay も {rowId} を設定しており、profile より後に適用されるため上書きされます", "home 레이어(~/.dsh/cordis.patch.yml)나 CLI overlay도 {rowId}를 설정 — profile보다 나중에 적용되어 덮어쓰임", "la couche home (~/.dsh/cordis.patch.yml) ou un overlay CLI définit aussi {rowId} et s'applique après le profil → la valeur du profil est éclipsée", "die Home-Ebene (~/.dsh/cordis.patch.yml) oder ein CLI-Overlay setzt ebenfalls {rowId} und greift nach dem Profil → der Profilwert wird überblendet", "anche il layer home (~/.dsh/cordis.patch.yml) o un overlay CLI impostano {rowId} e si applicano dopo il profilo → il valore del profilo viene oscurato", "домашний слой (~/.dsh/cordis.patch.yml) или overlay CLI тоже задаёт {rowId} и применяется после профиля → значение профиля перекрывается", "la capa home (~/.dsh/cordis.patch.yml) o un overlay de CLI también fijan {rowId} y se aplican tras el perfil → el valor del perfil queda eclipsado"),
			P7: t$1("文件里是 {file}，运行时生效的是 {effective}（上层覆盖或热应用未跟上）", "the file says {file} but the running value is {effective} (an upper layer wins, or the hot reload has not caught up)", "ファイルは {file}、実行時有効値は {effective}（上位レイヤー優先、またはホットリロード未反映）", "파일은 {file}인데 실행 값은 {effective} — 상위 레이어가 이기거나 핫 리로드가 따라오지 않음", "le fichier indique {file} mais la valeur active est {effective} (couche supérieure gagne, ou rechargement à chaud en retard)", "die Datei sagt {file}, der laufende Wert ist aber {effective} (obere Ebene gewinnt, oder Hot-Reload hinkt hinterher)", "il file dice {file} ma il valore attivo è {effective} (vince il layer superiore o l'hot reload non ha recuperato)", "в файле {file}, а действующее значение {effective} (верхний слой побеждает или горячая перезагрузка не успела)", "el archivo dice {file} pero el valor activo es {effective} (gana la capa superior o el recalentamiento no alcanzó)"),
			P8: t$1("webserver.port 是字面量 {port} → 现在生效的就是这个值，启动层传来的 `--port` 压不动它（实测：传了 `--port` 宿主仍起在这个端口）；要跟随启动参数就写成 !!js 表达式形式", "webserver.port is a literal {port} → this is the value in force; a port from the launch layer cannot override it (measured: the host still listened on this port after `--port` was passed). Use the !!js expression form to follow the launch argument", "webserver.port がリテラル {port} → これが有効値で、起動層が渡す `--port` は上書きできません（実測：`--port` を渡してもこのポートで起動）。追随するには !!js 式形式に", "webserver.port가 리터럴 {port} → 지금 유효한 값이고 시작 계층의 `--port`가 앞설 수 없음(실측: `--port` 전달에도 이 포트 기동). 추종하려면 !!js 표현식 형태로", "webserver.port est un littéral {port} → c'est la valeur en force, le `--port` du lancement ne la couvre pas (mesuré : l'hôte écoute encore ce port après `--port`) ; mettre la forme !!js pour suivre l'argument", "webserver.port ist Literal {port} → dieser Wert gilt, der `--port` des Starts überstimmt ihn nicht (gemessen: Host lauscht trotz `--port` auf diesem Port); für Folgsamkeit die !!js-Ausdrucksform", "webserver.port è un letterale {port} → questo è il valore effettivo, il `--port` del layer di avvio non lo scavalca (misurato: l'host ascolta comunque questa porta con `--port`); usare la forma !!js per seguirla", "webserver.port — литерал {port} → действует это значение, `--port` из слоя запуска его не перебивает (замерено: хост всё равно слушает этот порт при `--port`); чтобы следовать аргументу запуска — форма !!js", "webserver.port es literal {port} → ese es el valor en vigor, el `--port` de la capa de arranque no lo supera (medido: el host sigue escuchando este puerto pese a `--port`); use la forma !!js para seguirlo"),
			P9: t$1("{rowId} 的这些键在 bundle 层本是 !!js 表达式，覆盖层写成了字面量：{keys}（上游以后怎么改都不再跟进，值被钉死在抄下来的这一刻）", "these {rowId} keys are `!!js` expressions in the bundle layer but literals in the override: {keys} (later upstream changes no longer apply; the value is frozen at the moment it was copied)", "{rowId} のこれらの键は bundle 層では !!js 式ですが上書きではリテラル：{keys}（以後 upstream が変わっても追随せず、コピーした時点の値に固定されます）", "{rowId}의 이 키들은 bundle 레이어에선 !!js 표현식인데 재정의는 리터럴: {keys} — 이후 상류 설정이 바뀌어도 반영되지 않고 복사 시점 값에 고정됨", "ces clés {rowId} sont des expressions `!!js` dans le bundle mais des littéraux dans l'override : {keys} (les changements amont ne s'appliquent plus, la valeur reste figée au moment de la copie)", "diese {rowId}-Schlüssel sind im Bundle `!!js`-Ausdrücke, im Override aber Literale: {keys} (spätere Upstream-Änderungen greifen nicht mehr, der Wert ist seit dem Kopieren festgeschrieben)", "queste chiavi {rowId} sono espressioni `!!js` nel bundle ma letterali nell'override: {keys} (le modifiche a monte non si applicano più, il valore resta congelato al momento della copia)", "эти ключи {rowId} в слое bundle — выражения `!!js`, а в переопределении — литералы: {keys} (последующие изменения вышестоящего слоя не применятся — значение зафиксировано в момент копирования)", "estas claves de {rowId} son expresiones `!!js` en el bundle pero literales en la sobrescritura: {keys} (los cambios aguas arriba ya no se aplican; el valor queda congelado desde que se copió)"),
			P10: t$1("宿主树里找不到 id {rowId} → 该覆盖行被静默跳过（新增行要用 `- insert:`，不是裸 `- id:`）", "no entry with id {rowId} exists in the host tree → this override row is silently skipped (adding rows needs `- insert:`, not a bare `- id:`)", "宿主ツリーに id {rowId} が無い → この上書き行は黙ってスキップ（行追加は `- insert:` が要り、裸の `- id:` ではない）", "호스트 트리에 id {rowId}가 없음 → 이 재정의 행은 조용히 건너뜀(행 추가는 `- insert:`, 맨 `- id:` 아님)", "aucune entrée d'id {rowId} dans l'arbre de l'hôte → la ligne est ignorée en silence (ajouter demande `- insert:`, pas un `- id:` nu)", "in der Host-Tabelle existiert keine id {rowId} → diese Override-Zeile wird still übersprungen (neue Zeilen brauchen `- insert:`, nicht ein nacktes `- id:`)", "nessuna voce con id {rowId} nell'albero host → la riga viene saltata in silenzio (aggiungere righe richiede `- insert:`, non un `- id:` nudo)", "в дереве хоста нет записи с id {rowId} → строка молча пропущена (для добавления нужен `- insert:`, а не голое `- id:`)", "no existe ninguna entrada con id {rowId} en el árbol del host → la fila se omite en silencio (añadir filas requiere `- insert:`, no un `- id:` pelado)"),
			P11: t$1("patch 层整层 YAML 非法（{reason}）→ 所有覆盖全部失效，先修语法再谈配置", "the whole patch layer is invalid YAML ({reason}) → every override is dead; fix the syntax before discussing config", "patch 層全体の YAML が不正（{reason}）→ すべての上書きが無効。まず構文を直してください", "patch 레이어 전체의 YAML이 잘못됨({reason}) → 모든 재정의가 무효, 먼저 구문부터", "la couche de patch entière est un YAML invalide ({reason}) → tous les remplacements sont morts ; corrigez la syntaxe d'abord", "die gesamte Patch-Ebene ist ungültiges YAML ({reason}) → jeder Override ist tot; erst die Syntax reparieren", "l'intero layer di patch è YAML non valido ({reason}) → ogni override è morto; prima sistemare la sintassi", "весь слой патчей — невалидный YAML ({reason}) → все переопределения мертвы; сначала синтаксис", "toda la capa de patch es YAML inválido ({reason}) → cada sobrescritura está muerta; arregla la sintaxis primero"),
			P12: t$1("宿主正在热重载（HMR transactions cannot be nested），本次未写入；已自动重试一次仍失败，请片刻后再点", "the host is mid hot-reload (HMR transactions cannot be nested); nothing was written, one automatic retry already failed — try again shortly", "宿主がホットリロード中（HMR transactions cannot be nested）→ 書き込みなし。自動リトライ 1 回も失敗、稍後に再試行", "호스트가 핫 리로드 중(HMR transactions cannot be nested) → 기록 안 됨. 자동 재시도 1회도 실패, 잠시 후 다시 누르세요", "l'hôte est en rechargement à chaud (HMR transactions cannot be nested) ; rien n'a été écrit, une reprise automatique a déjà échoué — réessayez tout à l'heure", "der Host lädt gerade heiß (HMR transactions cannot be nested); es wurde nichts geschrieben, ein automatischer Versuch scheiterte bereits — gleich erneut klicken", "l'host è in hot-reload (HMR transactions cannot be nested); nulla è stato scritto, un ritentativo automatico è già fallito — riprova a breve", "хост сейчас в горячей перезагрузке (HMR transactions cannot be nested); ничего не записано, автоматический повтор уже не удался — попробуйте чуть позже", "el host está en recalentamiento (HMR transactions cannot be nested); no se escribió nada, un reintento automático ya falló — inténtalo en un momento")
		});
		/** 结果与结构文案。 */
		const PATCH_TEXT = Object.freeze({
			title: t$1("profile patch 体检", "profile patch check", "profile patch 体検", "profile patch 점검", "inspection du patch de profil", "Profil-Patch-Prüfung", "controllo del patch del profilo", "проверка патча профиля", "revisión del patch de perfil"),
			vOk: t$1("结构健康", "structurally sound", "構造は健全", "구조 정상", "structure saine", "strukturell in Ordnung", "struttura integra", "структура здорова", "estructura sana"),
			injectOk: t$1("补丁设置注入正常：覆盖行已被宿主采纳，键集与运行态一致", "patch settings are injected as written: the override rows are adopted by the host and match the live config", "パッチ設定は注入されています：上書き行がホストに採用され、実行時設定と一致しています", "패치 설정이 정상 주입됨: 재정의 행이 호스트에 채택되었고 실행 값과 일치합니다", "paramètres de patch injectés comme écrit : les lignes de réécriture sont adoptées par l'hôte et concordent avec la config active", "Patch-Einstellungen werden wie angegeben injiziert: die Override-Zeilen übernimmt der Host, sie stimmen mit der Laufzeit-Konfiguration überein", "impostazioni della patch iniettate come scritto: le righe di override sono adottate dall'host e corrispondono alla config attiva", "настройки патча применены как указано: строки переопределения приняты хостом и совпадают с рабочей конфигурацией", "ajustes del patch inyectados tal como están escritos: las filas de anulación las adopta el host y coinciden con la config activa"),
			vWarn: t$1("有偏差", "deviates", "偏差あり", "편차 있음", "dérive", "Abweichung", "in deviazione", "отклонение", "desviación"),
			vFail: t$1("会失效", "will not take effect", "効きません", "적용 안 됨", "sans effet", "wirkt nicht", "non avrà effetto", "не сработает", "no surtirá efecto"),
			vSkipped: t$1("无法判定", "cannot decide", "判定不能", "판단 불가", "indécidable", "nicht bestimmbar", "indecidibile", "нельзя определить", "indecidible"),
			rowConnection: t$1("connection（cookie 寿命所在）", "connection (where cookie lifetime lives)", "connection（cookie 寿命の設定場所）", "connection(cookie 수명 위치)", "connection (durée de vie des cookies)", "connection (Cookie-Lebensdauer)", "connection (durata dei cookie)", "connection (срок жизни cookies)", "connection (duración de las cookies)"),
			rowWebserver: t$1("webserver（只读体检）", "webserver (read-only check)", "webserver（読み取り専用）", "webserver(읽기 전용)", "webserver (lecture seule)", "webserver (nur Lesetest)", "webserver (solo lettura)", "webserver (только проверка)", "webserver (solo lectura)"),
			fixed: t$1("已写入：{changed}", "written: {changed}", "書き込み完了：{changed}", "기록됨: {changed}", "écrit : {changed}", "geschrieben: {changed}", "scritto: {changed}", "записано: {changed}", "escrito: {changed}"),
			auditLine: t$1("上次修复：{at}（修复前 {before} → 现在 {after}）", "last fix: {at} (was {before} → now {after})", "前回修復：{at}（修復前 {before} → 現在 {after}）", "마지막 복구: {at}(복구 전 {before} → 현재 {after})", "dernière réparation : {at} (de {before} à {after})", "letzte Korrektur: {at} (vorher {before} → jetzt {after})", "ultima correzione: {at} (da {before} a {after})", "последнее исправление: {at} (было {before} → стало {after})", "última reparación: {at} (de {before} a {after})"),
			auditLineNew: t$1("上次修复：{at}（此前无覆盖行 → 现在 {after}）", "last fix: {at} (there was no override row before → now {after})", "前回修復：{at}（それまでカバー行無し → 現在 {after}）", "마지막 복구: {at}(그전엔 덮어쓰기 행 없음 → 현재 {after})", "dernière réparation : {at} (aucune ligne de couverture avant → maintenant {after})", "letzte Korrektur: {at} (vorher keine Override-Zeile → jetzt {after})", "ultima correzione: {at} (prima nessuna riga di override → ora {after})", "последнее исправление: {at} (раньше строки переопределения не было → теперь {after})", "última reparación: {at} (antes no había fila de anulación → ahora {after})"),
			cookieLive: t$1("cookie 库实时读数：{count} 条 dsh-auth-*（共 {total} 条），请求头约 {bytes} B / 上限 {max} B（{pct}%），距 431 阈值还剩约 {remaining} 条", "live cookie reading: {count} dsh-auth-* rows ({total} total), request header ~{bytes} B of {max} B ({pct}%), roughly {remaining} more rows before 431", "cookie ライブ读数：dsh-auth-* {count} 件（合計 {total} 件）、リクエストヘッダ約 {bytes} B / 上限 {max} B（{pct}%）、431 まであと約 {remaining} 件", "cookie 실시간 수치: dsh-auth-* {count}건(총 {total}건), 요청 헤더 약 {bytes}B / 상한 {max}B({pct}%), 431까지 약 {remaining}건 남음", "lecture en direct des cookies : {count} entrées dsh-auth-* ({total} au total), en-tête ~{bytes} B sur {max} B ({pct} %), environ {remaining} entrées avant 431", "Live-Ableseung der Cookies: {count} dsh-auth-* Einträge ({total} gesamt), Header ~{bytes} B von {max} B ({pct} %), noch ~{remaining} Einträge bis 431", "lettura live dei cookie: {count} voci dsh-auth-* ({total} totali), header ~{bytes} B su {max} B ({pct}%), ancora ~{remaining} voci prima di 431", "текущее чтение cookie: {count} записей dsh-auth-* (всего {total}), заголовок ~{bytes} Б из {max} Б ({pct}%), до 431 остаётся ~{remaining} записей", "lectura en vivo de cookies: {count} filas dsh-auth-* ({total} en total), cabecera ~{bytes} B de {max} B ({pct} %), quedan ~{remaining} filas para 431"),
			cookieLiveSnapshot: t$1("cookie 库快照读数（借宿主句柄，非实时）：{count} 条 dsh-auth-*（共 {total} 条），请求头约 {bytes} B / 上限 {max} B（{pct}%），距 431 阈值还剩约 {remaining} 条", "cookie reading via a borrowed host handle (not live): {count} dsh-auth-* rows ({total} total), request header ~{bytes} B of {max} B ({pct}%), roughly {remaining} more rows before 431", "スナップショット读数（宿主のハンドル借用、非实时）：dsh-auth-* {count} 件（合計 {total} 件）、ヘッダ約 {bytes} B / 上限 {max} B（{pct}%）、431 まであと約 {remaining} 件", "스냅샷 수치(호스트 핸들 빌림, 비실시간): dsh-auth-* {count}건(총 {total}건), 헤더 약 {bytes}B / 상한 {max}B({pct}%), 431까지 약 {remaining}건", "lecture par instantané (poignée prêtée à l'hôte, non temps réel) : {count} entrées dsh-auth-* ({total} au total), en-tête ~{bytes} B sur {max} B ({pct} %), ~{remaining} entrées avant 431", "Schnappschuss-Ableseung (geliehener Host-Handle, nicht live): {count} dsh-auth-* Einträge ({total} gesamt), Header ~{bytes} B von {max} B ({pct} %), noch ~{remaining} Einträge bis 431", "lettura da istantanea (maniglia host prestata, non live): {count} voci dsh-auth-* ({total} totali), header ~{bytes} B su {max} B ({pct}%), ancora ~{remaining} voci prima di 431", "снимок (одалживаемый дескриптор хоста, не в реальном времени): {count} записей dsh-auth-* (всего {total}), заголовок ~{bytes} Б из {max} Б ({pct}%), до 431 остаётся ~{remaining} записей", "lectura por instantánea (asa del host prestada, no en vivo): {count} filas dsh-auth-* ({total} en total), cabecera ~{bytes} B de {max} B ({pct} %), quedan ~{remaining} filas para 431"),
			cookieMissing: t$1("cookie 库现状：没在预期位置找到库（安装方式可能不同），可用 --db=<完整路径> 指定", "cookie store: no database found at the expected locations (the install may differ); pass --db=<full path>", "cookie 庫：期待する場所に見つかりません（インストール形態の違いかも）。--db=<完全パス> で指定可", "cookie 저장소: 예상 위치에서 파일을 찾지 못함(설치 형태 차이 가능) → --db=<전체 경로> 로 지정", "base de cookies : aucune base aux emplacements attendus (installation différente ?) ; utilisez --db=<chemin complet>", "Cookie-Speicher: keine Datenbank an den erwarteten Orten (ggf. andere Installation) — --db=<vollständiger Pfad> verwenden", "archivio cookie: nessun database nei percorsi attesi (installazione diversa?) ; usare --db=<percorso completo>", "хранилище cookie: база не найдена в ожидаемых местах (возможно, другая установка) — укажите --db=<полный путь>", "almacén de cookies: no se encontró la base en las rutas esperadas (instalación distinta) ; use --db=<ruta completa>"),
			cookiePermission: t$1("cookie 库现状：当前用户读不了这个文件（权限/属主问题），不是客户端占用", "cookie store: the current user cannot read this file (permissions/owner), the client is not holding it", "cookie 庫：現ユーザーはこのファイルを読めません（権限/所有者の問題）で、クライアント占有ではない", "cookie 저장소: 현재 사용자 권한으로 읽을 수 없음(권한/소유자 문제), 클라이언트 점유 아님)", "base de cookies : l'utilisateur actuel ne peut pas lire ce fichier (permissions/propriétaire), ce n'est pas le client qui le retient", "Cookie-Speicher: dieser Benutzer kann die Datei nicht lesen (Rechte/Besitzer), nicht der Client hält sie", "archivio cookie: l'utente corrente non può leggere il file (permessi/proprietario), non lo trattiene il client", "хранилище cookie: текущий пользователь не может прочитать файл (права/владелец), это не блокировка клиентом", "almacén de cookies: el usuario actual no puede leer este archivo (permisos/propietario), no lo retiene el cliente"),
			cookieBusy: t$1("cookie 库现状：客户端运行期读不到（被 Chromium 独占），条数需关闭客户端后跑 CLI", "cookie store: unreadable while the client runs (Chromium holds it exclusively); count needs the CLI with the client closed", "cookie 庫の現状：クライアント起動中は読めません（Chromium が排他保持）、件数は終了後に CLI で", "cookie 저장소: 클라이언트 실행 중 읽기 불가(Chromium 배타 점유), 수는 종료 후 CLI로", "base de cookies : illisible pendant que le client tourne (Chromium la retient) ; le nombre exige la CLI client fermé", "Cookie-Speicher: während des Client-Laufs nicht lesbar (Chromium hält ihn exklusiv); die Zahl braucht die CLI bei geschlossenem Client", "archivio cookie: illeggibile mentre il client è attivo (Chromium lo trattiene); il conteggio richiede la CLI a client chiuso", "хранилище cookie: недоступно для чтения при запущенном клиенте (Chromium держит эксклюзивно); число требует CLI при закрытом клиенте", "almacén de cookies: ilegible mientras el cliente corre (Chromium lo retiene); el conteo requiere la CLI con el cliente cerrado"),
			noop: t$1("无需写入（已在目标档）", "nothing to write (already on target)", "書き込み不要（目標達成済み）", "기록 불필요(이미 목표)", "rien à écrire (déjà à la cible)", "nichts zu schreiben (bereits am Ziel)", "nulla da scrivere (già all'obiettivo)", "нечего писать (уже в цели)", "nada que escribir (ya en el objetivo)"),
			blocked: t$1("判定为不可动作，未写入（{codes}）", "judged not actionable; nothing written ({codes})", "動作不可と判定、書き込みなし（{codes}）", "조치 불가로 판정, 기록 없음({codes})", "jugé non exécutable ; rien écrit ({codes})", "als nicht ausführbar eingestuft; nichts geschrieben ({codes})", "giudicato non eseguibile; nulla scritto ({codes})", "признано невыполнимым; ничего не записано ({codes})", "juzgado no accionable; nada escrito ({codes})"),
			failed: t$1("写入失败：{message}", "write failed: {message}", "書き込み失敗：{message}", "기록 실패: {message}", "échec d'écriture : {message}", "Schreiben fehlgeschlagen: {message}", "scrittura fallita: {message}", "ошибка записи: {message}", "fallo de escritura: {message}"),
			reverted: t$1("已回到修复前的配置：{changed}", "restored to the pre-fix config: {changed}", "修復前の設定に戻しました：{changed}", "복구 전 설정으로 되돌림: {changed}", "retour à la config d'avant réparation : {changed}", "zurück auf die Konfiguration vor dem Fix: {changed}", "ritorno alla config pre-fix: {changed}", "возврат к конфигурации до исправления: {changed}", "restaurada la config previa a la reparación: {changed}"),
			noSnapshot: t$1("没有可回滚的快照（修复一次才会留一份）", "no snapshot to roll back to (one is kept on a successful fix)", "回滚用スナップショット無し（修復時に 1 件保存）", "롤백 스냅샷 없음(성공적 복구 시 1개 보관)", "aucun instantané à restaurer (un fix réussi en garde un)", "kein Snapshot zum Zurückrollen (ein erfolgreicher Fix hinterlässt einen)", "nessuno snapshot da ripristinare (un fix riuscito ne conserva uno)", "нет снимка для отката (успешное исправление сохраняет один)", "no hay instantánea a la que volver (una reparación correcta guarda una)"),
			planFor: t$1("把下面这段手工放进 {file}（若根是 flow `[]`，要先删掉那一行）：", "paste this block into {file} (if the root is a flow `[]`, delete that line first):", "以下のブロックを {file} に手動で置いてください（根が flow `[]` ならその行を削除）：", "아래 블록을 {file}에 직접 넣으세요(루트가 flow `[]`면 그 줄을 먼저 삭제):", "collez ce bloc dans {file} (si la racine est un `[]` en flux, supprimez d'abord cette ligne) :", "fügen Sie diesen Block in {file} ein (falls die Wurzel ein Fluss-`[]` ist, erst diese Zeile löschen):", "incolla questo blocco in {file} (se la radice è un `[]` in forma flow, prima cancella quella riga):", "вставьте этот блок в {file} (если корень — поток `[]`, сначала удалите эту строку):", "pega este bloque en {file} (si la raíz es un `[]` en flujo, borra primero esa línea):"),
			exprFrozenHint: t$1("要拿到跟随形态的粘贴块：把本插件设置里的 guardMode 切到 expression，再跑一次 patch plan", "to get a paste block in the following form: set guardMode to expression in this plugin's settings, then run patch plan again", "追随形态の貼り付け块が欲しい場合：本プラグイン設定の guardMode を expression に切り、patch plan を再実行", "추종 형태 블록을 받으려면: 이 플러그인 설정에서 guardMode를 expression으로 바꾸고 patch plan을 다시 실행", "pour obtenir un bloc au forme suiveuse : passez guardMode à expression dans les réglages de ce plugin, puis relancez patch plan", "für ein Block in Folgsamkeitsform: guardMode in den Einstellungen dieses Plugins auf expression setzen und patch plan erneut ausführen", "per ottenere un blocco in forma seguace: imposta guardMode su expression nelle impostazioni di questo plugin, poi riesegui patch plan", "чтобы получить блок в следящей форме: переведите guardMode в expression в настройках этого плагина и снова выполните patch plan", "para obtener un bloque en forma de seguimiento: pon guardMode en expression en los ajustes de este plugin y vuelve a ejecutar patch plan"),
			targetDaysLine: t$1("目标 cookie 绝对寿命：{days} 天（「修复」就写这个值；它是防 431 真正有效的一项）", "target cookie lifetime: {days} day(s) — what Fix writes; this is the part that actually prevents 431", "目標 cookie 絶対寿命：{days} 日（「修復」が書く値。431 防止に本当に効くのはここ）", "목표 cookie 절대 수명: {days}일 — \"복구\"가 쓰는 값이며, 431 방지에 실제로 효력이 있는 항목", "durée cible des cookies : {days} jour(s) — valeur écrite par Réparer ; c'est ce qui empêche vraiment 431", "Ziel-Lebensdauer der Cookies: {days} Tag(e) — der von Fix geschriebene Wert; das ist der Teil, der 431 wirklich verhindert", "durata target dei cookie: {days} giorno/i — il valore scritto da Correggi; è la cosa che evita davvero 431", "целевой срок cookie: {days} дн. — значение, которое пишет «Исправить»; именно это реально предотвращает 431", "vida útil objetivo de las cookies: {days} día(s) — el valor que escribe Reparar; es la parte que de verdad evita 431"),
			webserverNote: t$1("webserver 行只参与只读判定：本插件只改 cookie 有效期，端口属启动行为面，不由本工具改写", "the webserver row is read-only here: this plugin only changes the cookie lifetime - the port is a launch-behaviour decision we do not rewrite", "webserver 行は読み取り専用判定のみ：本プラグインは cookie 有効期だけ変更し、ポートは起動挙動の話で本ツールの対象外", "webserver 행은 읽기 전용 판정만: 이 플러그인은 cookie 유효기간만 변경하며 포트는 시작 동작 판단이라 본 도구가 바꾸지 않음", "la ligne webserver est en lecture seule ici : ce plugin ne change que la durée de vie des cookies - le port relève du lancement, nous ne le réécrivons pas", "die webserver-Zeile wird hier nur lesend geprüft: dieses Plugin ändert nur die Cookie-Lebensdauer — der Port ist Startverhalten, das wir nicht umschreiben", "la riga webserver qui è solo in lettura: questo plugin cambia soltanto la durata dei cookie - la porta riguarda l'avvio e non la riscriviamo", "строка webserver здесь только для чтения: этот плагин меняет лишь срок cookie — порт относится к запуску и нами не переписывается", "la fila webserver aquí es solo lectura: este plugin solo cambia la vida útil de las cookies - el puerto concierne al arranque y no lo reescribimos"),
			nextFix: t$1("下一步：面板点「修复」，或执行 /cookie-cleaner patch fix", "next: press Fix in the panel, or run /cookie-cleaner patch fix", "次の一手：パネルの「修復」を押すか /cookie-cleaner patch fix を実行", "다음: 패널에서 \"복구\"를 누르거나 /cookie-cleaner patch fix 실행", "étape suivante : « Réparer » dans le panneau, ou /cookie-cleaner patch fix", "nächster Schritt: im Panel „Fixen“, oder /cookie-cleaner patch fix", "passo successivo: «Correggi» nel pannello, oppure /cookie-cleaner patch fix", "следующий шаг: «Исправить» в панели или /cookie-cleaner patch fix", "siguiente paso: «Reparar» en el panel, o /cookie-cleaner patch fix"),
			noService: t$1("本机宿主没有 config-editor 服务（老线或未装配），体检无法在线进行", "this host has no config-editor service (older line or not assembled), so an online check is impossible", "この宿主に config-editor サービスが無いため（旧ライン/未装配）、オンライン検査は不可", "이 호스트에 config-editor 서비스가 없음(구 라인/미조립) → 온라인 점검 불가", "cet hôte n'a pas de service config-editor (ancienne ligne ou non assemblé), contrôle en ligne impossible", "dieser Host hat keinen config-editor-Dienst (ältere Zeile oder nicht montiert), Online-Prüfung unmöglich", "questo host non ha il servizio config-editor (linea vecchia o non assemblato), controllo online impossibile", "у этого хоста нет сервиса config-editor (старая линия или не собран), онлайн-проверка невозможна", "este host no tiene el servicio config-editor (línea antigua o no ensamblado), control en línea imposible"),
			missingProfile: t$1("该 profile 不存在（目录里没有 cordis.patch.yml 且上级目录也不在）——无据可判，不是配置有问题", "that profile does not exist (no cordis.patch.yml and its parent directory is missing) — nothing to judge, not a config defect", "その profile は存在しません（cordis.patch.yml 無く、親ディレクトリも無い）——判定根拠無し、設定不備ではない", "해당 프로필이 존재하지 않습니다(cordis.patch.yml 없음, 상위 디렉터리도 없음) — 판단 근거 없음, 설정 결함이 아님", "ce profil n'existe pas (pas de cordis.patch.yml et le dossier parent manque) — rien à juger, pas un défaut de config", "dieses Profil existiert nicht (kein cordis.patch.yml, auch das Elternverzeichnis fehlt) — keine Grundlage, kein Konfigurationsfehler", "quel profilo non esiste (nessun cordis.patch.yml e manca la cartella superiore) — nulla da giudicare, non un difetto di config", "этот профиль не существует (нет cordis.patch.yml и отсутствует родительский каталог) — нечего судить, это не дефект конфигурации", "ese perfil no existe (no hay cordis.patch.yml y falta el directorio padre) — nada que juzgar, no es un defecto de configuración"),
			offlineNote: t$1("（离线档）只能看到文件层；运行态与 bundle 层的对比（P5/P7/P9）需要启动客户端后面板/命令来查", "(offline mode) only the file layer is visible; the runtime/bundle-layer comparisons (P5/P7/P9) need the panel or command while the client runs", "（オフライン档）ファイル層のみ閲覧可。実行状態と bundle 層の比較（P5/P7/P9）はクライアント起動後にパネル/コマンドで", "(오프라인 모드) 파일 레이어만 보입니다. 런타임/bundle 레이어 비교(P5/P7/P9)는 클라이언트 실행 후 패널/명령으로", "(mode hors ligne) seule la couche fichier est visible ; les comparaisons runtime/bundle (P5/P7/P9) exigent le panneau ou la commande avec le client lancé", "(Offline-Modus) nur die Dateiebene ist sichtbar; die Vergleiche Laufzeit/Bundle-Ebene (P5/P7/P9) brauchen Panel oder Befehl bei laufendem Client", "(modalità offline) si vede solo il layer file; i confronti runtime/layer bundle (P5/P7/P9) richiedono pannello o comando a client attivo", "(офлайн-режим) виден только слой файла; сравнения рантайма и слоя bundle (P5/P7/P9) нужны панель или команда при запущенном клиенте", "(modo sin conexión) solo se ve la capa de archivo; las comparaciones runtime/capa bundle (P5/P7/P9) necesitan el panel o el comando con el cliente activo"),
			editedExternally: t$1("（提示）profile patch 也可被宿主插件管理器或手改变更，体检以当前运行树为准", "(note) the profile patch may also change via the host plugin manager or hand edits; the check reports the current running tree", "（参考）profile patch は宿主のプラグインマネージャーや手編集でも変わります。体検は現在の実行中ツリーを基準にします", "(참고) profile patch는 호스트 플러그인 관리자나 수동 편집으로도 바뀜. 점검은 현재 실행 트리를 기준으로 함", "(note) le patch de profil peut aussi évoluer via le gestionnaire de plugins ou à la main ; le contrôle rend l'arbre courant", "(Hinweis) der Profil-Patch kann sich auch über den Plugin-Manager oder per Hand ändern; die Prüfung meldet den laufenden Baum", "(nota) il patch del profilo può cambiare anche tramite il gestore plugin o a mano; il controllo riporta l'albero in esecuzione", "(примечание) патч профиля может меняться через менеджер плагинов или вручную; проверка даёт текущее дерево", "(nota) el patch del perfil también cambia vía el gestor de plugins o a mano; la revisión reporta el árbol en ejecución")
		});
		// src/client/locales.ts
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
		/** 字典命名空间 = npm 包名（与卡 id、桥路径同串）。 */
		const NS = "dsh-cookie-cleaner";
		/** 界面 chrome 文案（9 语并排，顺序同 PATCH_LANGS）。 */
		const t = (zh, en, ja, ko, fr, de, it, ru, es) => ({
			zh,
			en,
			ja,
			ko,
			fr,
			de,
			it,
			ru,
			es
		});
		const CHROME = {
			"section.title": t("Cookie 清理器", "Cookie Cleaner", "Cookie クリーナー", "Cookie 청소기", "Nettoyeur de cookies", "Cookie-Reiniger", "Pulitore cookie", "Очистка cookie", "Limpiador de cookies"),
			"card.title": t("profile patch 体检与修复", "Profile patch check & fix", "profile patch の点検と修復", "profile patch 점검 및 복구", "Contrôle et réparation du patch de profil", "Prüfung & Korrektur des Profil-Patches", "Controllo e correzione del patch del profilo", "Проверка и исправление патча профиля", "Revisión y reparación del patch de perfil"),
			"action.check": t("体检", "Check", "点検", "점검", "Contrôler", "Prüfen", "Controlla", "Проверить", "Revisar"),
			"action.fix": t("修复", "Fix", "修復", "복구", "Réparer", "Korrigieren", "Correggi", "Исправить", "Reparar"),
			"action.revert": t("回滚", "Revert", "戻す", "되돌리기", "Annuler", "Rückgängig", "Ripristina", "Отменить", "Revertir"),
			"state.busy": t("进行中…", "working…", "処理中…", "처리 중…", "en cours…", "läuft…", "in corso…", "выполняется…", "en curso…"),
			"state.failed": t("动作失败：{message}", "action failed: {message}", "アクション失敗：{message}", "동작 실패: {message}", "échec de l'action : {message}", "Aktion fehlgeschlagen: {message}", "azione fallita: {message}", "действие не удалось: {message}", "acción falló: {message}"),
			"state.offline": t("宿主未提供 config-editor（老线或未装配），本面板无法在线体检/修复", "the host exposes no config-editor (older line or not assembled); this panel cannot check or fix online", "宿主に config-editor が無く（旧ライン/未装配）、本パネルではオンライン点検・修復不可", "호스트에 config-editor가 없음(구 라인/미조립) → 이 패널에서 온라인 점검·복구 불가", "l'hôte n'expose pas de config-editor (ancienne ligne ou non assemblé) ; ce panneau ne peut ni contrôler ni réparer", "der Host stellt keinen config-editor bereit (ältere Zeile oder nicht montiert); dieses Panel kann nicht online prüfen oder korrigieren", "l'host non espone config-editor (linea vecchia o non assemblato); questo pannello non può controllare né correggere online", "хост не даёт config-editor (старая линия или не собран); эта панель не может проверять или исправлять онлайн", "el host no expone config-editor (línea antigua o no ensamblado); este panel no puede revisar ni reparar en línea"),
			"row.connection": t("connection（cookie 寿命）", "connection (cookie lifetime)", "connection（cookie 寿命）", "connection(cookie 수명)", "connection (durée de vie des cookies)", "connection (Cookie-Lebensdauer)", "connection (durata cookie)", "connection (срок жизни cookie)", "connection (duración de cookies)"),
			"row.webserver": t("webserver（启动面）", "webserver (launch surface)", "webserver（起動面）", "webserver(시작 면)", "webserver (surface de lancement)", "webserver (Startebene)", "webserver (livello di avvio)", "webserver (слой запуска)", "webserver (capa de arranque)"),
			"level.ok": t("结构健康", "structurally sound", "構造は健全", "구조 정상", "structure saine", "strukturell in Ordnung", "struttura integra", "структура здорова", "estructura sana"),
			"level.warn": t("有偏差", "deviates", "偏差あり", "편차 있음", "dérive", "Abweichung", "in deviazione", "отклонение", "desviación"),
			"level.fail": t("会失效", "will not take effect", "効きません", "적용 안 됨", "sans effet", "wirkt nicht", "non avrà effetto", "не сработает", "no surtirá efecto"),
			"level.skipped": t("无法判定", "cannot decide", "判定不能", "판단 불가", "indécidable", "nicht bestimmbar", "indecidibile", "нельзя определить", "indecidible"),
			"note.webserver": t("webserver 行只体检不自动写（端口钉死属启动行为面）", "the webserver row is checked but never auto-written (pinning the port is a launch-behaviour decision)", "webserver 行は体検のみ・自動書き込みなし（ポート固定は起動挙動の話）", "webserver 행은 점검만, 자동 기록 없음(포트 고정은 시작 동작 판단)", "la ligne webserver est contrôlée mais jamais écrite (figer le port relève du lancement)", "die webserver-Zeile wird nur geprüft, nie geschrieben (Portfestlegung ist Startverhalten)", "la riga webserver è solo controllata, mai scritta (fissare la porta riguarda l'avvio)", "строка webserver только проверяется, не пишется (фиксация порта — вопрос запуска)", "la fila webserver solo se revisa, nunca se escribe (fijar el puerto concierne al arranque)"),
			"fix.done": t("已写入：{changed}", "written: {changed}", "書き込み完了：{changed}", "기록됨: {changed}", "écrit : {changed}", "geschrieben: {changed}", "scritto: {changed}", "записано: {changed}", "escrito: {changed}"),
			"fix.noop": t("无需写入（已在目标档）", "nothing to write (already on target)", "書き込み不要（目標達成済み）", "기록 불필요(이미 목표)", "rien à écrire (déjà à la cible)", "nichts zu schreiben (bereits am Ziel)", "nulla da scrivere (già all'obiettivo)", "нечего писать (уже в цели)", "nada que escribir (ya en el objetivo)"),
			"fix.blocked": t("判定为不可动作（{codes}）：需按提示手工修文件", "judged not actionable ({codes}): fix the file by hand as suggested", "動作不可と判定（{codes}）：表示どおり手動でファイルを修正", "조치 불가({codes}): 안내대로 파일을 직접 수정", "jugé non exécutable ({codes}) : corrigez le fichier à la main", "als nicht ausführbar eingestuft ({codes}): Datei wie vorgeschlagen von Hand korrigieren", "giudicato non eseguibile ({codes}): correggere a mano il file come suggerito", "признано невыполнимым ({codes}): правьте файл вручную по подсказке", "juzgado no accionable ({codes}): corrige el archivo a mano como se sugiere"),
			"revert.done": t("已回滚：{changed}", "rolled back: {changed}", "ロールバック済み：{changed}", "되돌림: {changed}", "annulé : {changed}", "zurückgerollt: {changed}", "ripristinato: {changed}", "откатлено: {changed}", "revertido: {changed}"),
			"revert.none": t("没有可回滚的快照（修复一次才会留一份）", "no snapshot to roll back (a successful fix keeps one)", "回滚用スナップショット無し（修復成功時に 1 件保存）", "롤백 스냅샷 없음(복구 성공 시 1개 보관)", "aucun instantané à restaurer (une réparation réussie en garde un)", "kein Snapshot zum Zurückrollen (ein erfolgreicher Fix hinterlässt einen)", "nessuno snapshot da ripristinare (una correzione riuscita ne conserva uno)", "нет снимка для отката (успешное исправление сохраняет один)", "no hay instantánea a la que volver (una reparación correcta guarda una)"),
			"lastCheck": t("最近体检：{at}", "last check: {at}", "最近の点検：{at}", "마지막 점검: {at}", "dernier contrôle : {at}", "letzte Prüfung: {at}", "ultimo controllo: {at}", "последняя проверка: {at}", "última revisión: {at}")
		};
		/** 把共享判定表压平成 `p.P5` 形态的键（宿主只回 code，语言由界面决定）。 */
		function flatten(bucket, prefix) {
			const out = {};
			for (const [code, entry] of Object.entries(bucket)) out[`${prefix}${code}`] = entry;
			return out;
		}
		const MERGED = {
			...CHROME,
			...flatten(PATCH_CODES, "p."),
			...flatten(PATCH_TEXT, "x.")
		};
		/** 界面用到的全部键（测试用它核对 9 语逐键相等）。 */
		const UI_KEYS = Object.keys(MERGED);
		/** `locale.register(NS, dictionaries)` 的入参。 */
		const dictionaries = Object.fromEntries(PATCH_LANGS.map((lang) => [lang, Object.fromEntries(UI_KEYS.map((key) => [key, MERGED[key][lang]]))]));
		/** 本地插值（`{name}` 形态，与宿主字典同规则；缺参原样留形便于发现漏参）。 */
		function render(text, params = {}) {
			return text.replace(/\{(\w+)\}/g, (_m, name) => {
				const value = params[name];
				if (value === void 0) return `{${name}}`;
				return Array.isArray(value) ? value.join(", ") : String(value);
			});
		}
		// src/client/routes.ts
		const routes = {
			check: "/api/dsh-cookie-cleaner/patch/check",
			fix: "/api/dsh-cookie-cleaner/patch/fix",
			revert: "/api/dsh-cookie-cleaner/patch/revert"
		};
		/** POST 一跳；网络/解析失败都归成结构化错误，不让卡片白屏。 */
		async function postJson(path, body = {}) {
			const response = await fetch(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
			const reply = await response.json();
			if (reply.ok !== true) throw new Error(`${reply.code ?? "unknown"} ${reply.message ?? ""}`.trim());
			if (reply.value === void 0) throw new Error("empty reply value");
			return reply.value;
		}
		// src/client/card.tsx
		/**
		* 面板卡片：体检 / 修复 / 回滚三个按钮 + P1-P12 明细。
		*
		* 三条纪律：
		* 1. 文本全部走注入进来的 `t`（宿主 locale 服务），卡片自己不留一份语言常量；
		* 2. 颜色/字号只用宿主主题令牌（`--dsw-*`），不写死色值——宿主换肤时卡片必须跟着变；
		* 3. 动作结果一律**重跑体检回显**，不信「按钮点了=改好了」：修复后档位仍偏，就如实显示。
		*/
		const LEVEL_COLOR = {
			ok: "var(--dsw-color-success, var(--dsw-color-primary))",
			warn: "var(--dsw-color-warning)",
			fail: "var(--dsw-color-danger)",
			skipped: "var(--dsw-color-muted)"
		};
		function FindingLine({ finding, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					marginLeft: 14,
					fontSize: "0.9em",
					lineHeight: 1.5
				},
				children: ["· ", render(t(`p.${finding.code}`), finding.params ?? {})]
			});
		}
		function Row({ row, t }) {
			const label = row.rowId === "connection" ? "row.connection" : "row.webserver";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { marginTop: 8 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: 6
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"aria-label": "verdict",
							style: {
								width: 8,
								height: 8,
								borderRadius: 4,
								background: LEVEL_COLOR[row.level] ?? LEVEL_COLOR.skipped
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t(label) }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { color: LEVEL_COLOR[row.level] },
							children: t(`level.${row.level}`)
						})
					]
				}), (row.findings ?? []).map((finding, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FindingLine, {
					finding,
					t
				}, `${finding.code}-${String(index)}`))]
			});
		}
		/**
		* cookie 读数行。四档不得混用一句：
		* - 普通只读打开成功 → 实时值（条数 / 百分比 / 余量），过半转告警色、达阈值转危险色；
		* - 借宿主句柄拿的快照 → 同一组数字但明说「非实时」（说成实时就是谎报）；
		* - 读得到但无折算（旧宿主半）→ 只给条数，不编造百分比；
		* - 读不到 → 按原因分档：占用 / 权限 / 没找到。把后两者说成“被 Chromium 占”是误引导。
		*/
		function CookieLine({ cookie, t }) {
			if (cookie === void 0) return null;
			const muted = {
				fontSize: "0.85em",
				color: "var(--dsw-color-muted)"
			};
			if (cookie.verdict === "skipped" || cookie.reason === "busy" || cookie.reason === "permission" || cookie.reason === "missing") {
				const key = cookie.reason === "missing" ? "x.cookieMissing" : cookie.reason === "permission" ? "x.cookiePermission" : "x.cookieBusy";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: muted,
					children: t(key)
				});
			}
			const occupancy = cookie.header;
			if (occupancy === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: muted,
				children: `${String(cookie.authCookies ?? "?")} dsh-auth-* / ${String(cookie.totalCookies ?? "?")} total`
			});
			const color = occupancy.over || occupancy.remaining <= 0 ? "var(--dsw-color-danger)" : occupancy.pct >= 50 ? "var(--dsw-color-warning)" : "var(--dsw-color-muted)";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: "0.85em",
					color,
					lineHeight: 1.5
				},
				children: render(t(cookie.snapshot === true ? "x.cookieLiveSnapshot" : "x.cookieLive"), {
					count: String(cookie.authCookies ?? "?"),
					total: String(cookie.totalCookies ?? "?"),
					bytes: String(occupancy.bytes),
					max: String(occupancy.maxHeaderBytes),
					pct: String(occupancy.pct),
					remaining: String(occupancy.remaining)
				})
			});
		}
		function PatchCard({ t }) {
			const [state, setState] = react.useState(void 0);
			const [busy, setBusy] = react.useState("");
			const [note, setNote] = react.useState("");
			const mounted = react.useRef(true);
			react.useEffect(() => {
				mounted.current = true;
				run("check");
				return () => {
					mounted.current = false;
				};
			}, []);
			async function run(action) {
				setBusy(action);
				setNote("");
				try {
					if (action === "check") {
						const value = await postJson(routes.check, {});
						if (mounted.current) setState(value);
					} else {
						const value = await postJson(action === "fix" ? routes.fix : routes.revert, {});
						const fail = (message) => render(t("state.failed"), { message });
						const outcome = action === "fix" ? value.kind === "fixed" ? render(t("fix.done"), { changed: value.changed ?? [] }) : value.kind === "noop" ? t("fix.noop") : value.kind === "blocked" ? render(t("fix.blocked"), { codes: value.codes ?? [] }) : fail(value.message ?? value.kind) : value.kind === "reverted" ? render(t("revert.done"), { changed: value.changed ?? [] }) : value.kind === "no-snapshot" ? t("revert.none") : fail(value.message ?? value.kind);
						if (!mounted.current) return;
						setNote(outcome);
						const after = value.result ?? await postJson(routes.check, {});
						if (mounted.current) setState(after);
					}
				} catch (error) {
					if (mounted.current) setNote(render(t("state.failed"), { message: String(error.message ?? error) }));
				} finally {
					if (mounted.current) setBusy("");
				}
			}
			const offline = state?.reason === "no-config-editor";
			const conn = state?.rows?.find((row) => row.rowId === "connection");
			const canFix = offline !== true && conn?.actionable === true;
			const canRevert = offline !== true;
			const button = (action, disabled = false) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				disabled: busy !== "" || disabled,
				onClick: () => void run(action),
				style: {
					padding: "4px 10px",
					borderRadius: 6,
					border: "1px solid var(--dsw-color-border)",
					background: "var(--dsw-color-surface)",
					color: "var(--dsw-color-text)",
					cursor: busy === "" && !disabled ? "pointer" : "default"
				},
				children: busy === action ? t("state.busy") : t(`action.${action}`)
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "grid",
					gap: 6,
					padding: "4px 0"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { fontWeight: 600 },
						children: t("card.title")
					}),
					state?.documentPath ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						style: {
							fontSize: "0.85em",
							wordBreak: "break-all"
						},
						children: state.documentPath
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 8,
							alignItems: "center",
							flexWrap: "wrap"
						},
						children: [
							button("check"),
							button("fix", !canFix),
							button("revert", !canRevert)
						]
					}),
					note !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							color: "var(--dsw-color-primary)",
							whiteSpace: "pre-line"
						},
						children: note
					}) : null,
					offline ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("state.offline") }) : null,
					state?.level === "ok" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { color: LEVEL_COLOR.ok },
						children: t("x.injectOk")
					}) : (state?.rows ?? []).map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
						row,
						t
					}, row.rowId)),
					(state?.rows ?? []).some((row) => row.rowId === "webserver" && (row.findings ?? []).length > 0) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "0.85em",
							color: "var(--dsw-color-muted)"
						},
						children: t("note.webserver")
					}) : null,
					state?.targetDays !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "0.9em",
							color: "var(--dsw-color-text)"
						},
						children: render(t("x.targetDaysLine"), { days: String(state.targetDays) })
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CookieLine, {
						cookie: state?.cookie,
						t
					}),
					state?.lastFix ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "0.85em",
							color: "var(--dsw-color-muted)"
						},
						children: state.lastFix.beforeDays === void 0 || state.lastFix.beforeDays === null ? render(t("x.auditLineNew"), {
							at: state.lastFix.at ?? "?",
							after: state.lastFix.targetDays ?? "?"
						}) : render(t("x.auditLine"), {
							at: state.lastFix.at ?? "?",
							before: state.lastFix.beforeDays,
							after: state.lastFix.targetDays ?? "?"
						})
					}) : null,
					state?.checkedAt ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "0.85em",
							color: "var(--dsw-color-muted)"
						},
						children: render(t("lastCheck"), { at: state.checkedAt })
					}) : null
				]
			});
		}
		// src/client/index.ts
		/**
		* dsh-cookie-cleaner — 浏览器半。
		*
		* 装载契约（三条都是事故换来的）：
		* - bundle id 必须 = **npm 包名**（`client/modules/src/index.ts:1040` 用 `graphRow(packageName,…)`），
		*   注册 id 与宿主图不一致时 client 半从不加载；
		* - 注册必须发生在 apply 顶层：关在任何 inject 回调里的注册两代都会静默失活；
		* - 每个面单独 `safe()`：未知槽名在个别宿主线上同步抛错，而 cordis 会吞掉 inject 回调的
		*   异常，一个面失败会带走同一回调里的其它面。
		*
		* `configForms`（0.1.7+）/`settingsScope`（≤0.1.5）是代际互斥服务，绝不写进插件级 inject——
		* 那会让整个 client fiber 在另一代上停在 pending。这里只依赖 `slots` + `locale`（三代齐）。
		*/
		/** 插件级 inject 只声明三代都存在的服务。 */
		const inject = ["slots", "locale"];
		/** 当前语言的取词函数（注册后由 locale 服务提供；拿不到 bind 时回落 zh 字典）。 */
		let currentT = (key) => {
			return dictionaries.zh[key] ?? key;
		};
		/** 每个面的独立 try/catch：一面抛错不带走其它面。 */
		function safe(ctx, tag, fn) {
			try {
				fn();
			} catch (error) {
				var _ref;
				((_ref = globalThis).__dccSurf ?? (_ref.__dccSurf = [])).push(`${tag}: ${String(error?.message ?? error)}`);
				const logger = typeof ctx.get === "function" ? ctx.get("logger") : void 0;
				if (typeof logger?.warn === "function") logger.warn(`[dsh-cookie-cleaner] ${tag} failed: ${String(error?.message ?? error)}`);
			}
		}
		/**
		* 浏览器半入口。
		* @param ctx client context。
		*/
		function apply(ctx) {
			safe(ctx, "locale.register", () => {
				if (typeof ctx.locale?.register !== "function") throw new Error("locale service unavailable");
				ctx.locale.register(NS, dictionaries);
				const bind = ctx.locale.bind?.(NS);
				if (typeof bind === "function") currentT = (key) => bind(key);
			});
			safe(ctx, "settings.section", () => {
				const slots = ctx.slots;
				if (slots?.inject === void 0 || slots.register === void 0) throw new Error("slots service unavailable");
				slots.inject("settings.section", function* () {
					yield slots.register({
						name: "settings.section",
						id: NS,
						order: 45,
						label: () => currentT("section.title"),
						locale: NS,
						inject: () => ({ t: (key) => currentT(key) })
					}, PatchCard);
				});
			});
			safe(ctx, "plugins.bundle.config", () => {
				const slots = ctx.slots;
				if (slots?.inject === void 0 || slots.register === void 0) throw new Error("slots service unavailable");
				slots.inject("plugins.bundle.config", function* () {
					yield slots.register({
						name: "plugins.bundle.config",
						key: NS,
						order: 45,
						label: () => currentT("section.title"),
						locale: NS,
						inject: () => ({ t: (key) => currentT(key) })
					}, PatchCard);
				});
			});
			safe(ctx, "dictionary sanity", () => {
				const langs = Object.keys(dictionaries);
				if (langs.length !== 9) throw new Error(`expected 9 languages, got ${String(langs.length)}`);
				const missing = langs.filter((lang) => {
					const dict = dictionaries[lang];
					return UI_KEYS.some((key) => typeof dict[key] !== "string" || dict[key] === "");
				});
				if (missing.length > 0) throw new Error(`empty keys for ${missing.join(", ")}`);
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map