(() => {
  "use strict";

  /* ==========================================================================
   * 資料層
   * ======================================================================== */

  const STORAGE_KEY = "course-notice-tool.v2";
  const LEGACY_KEY = "course-notice-tool.v1";   // v1 只存單張公告，開檔時自動搬移
  const MAX_NOTICES = 6;
  const DRAG_HOLD_MS = 140;
  const DRAG_START_DISTANCE = 7;
  const MAX_SHEETS = 8;
  const HISTORY_LIMIT = 20;
  const UNDO_TIMEOUT = 8000;
  const IO_MESSAGE_TIMEOUT = 8000;
  const IMAGE_EXPORT_SCALE = 2;       // 約 192 dpi，兼顧印刷清晰度與檔案大小
  const EXPORT_FORMAT = "course-notice-tool";   // 匯出檔的識別字串
  const FONT_ASSETS = {
    sans: {
      family: "Course Notice Sans",
      file: "fonts/NotoSansTC-Variable.woff2",
      fallbackScript: "fonts/sans.data.js",
      weight: "100 900"
    },
    serif: {
      family: "Course Notice Serif",
      file: "fonts/NotoSerifTC-Variable.woff2",
      fallbackScript: "fonts/serif.data.js",
      weight: "200 900"
    }
  };

  const STATUS_LABELS = {
    cancelled: "停課",
    normal: "照常上課",
    rescheduled: "時間調整",
    relocated: "教室異動",
    general: "一般公告"
  };

  const COURSE_LEVEL_LABELS = {
    bachelor: "學士班",
    master: "碩士班"
  };

  /*
   * 有些狀態光講「教室異動」不夠，一定要說改到哪裡，
   * 以前只能塞進備註。這張表決定哪些狀態要多出一個補充欄位、
   * 欄位怎麼標示，以及印在公告上時前面帶什麼字。
   * 不需要補充欄位的狀態不要列進來，欄位就會自動隱藏。
   */
  const STATUS_TARGETS = {
    relocated: { label: "改至教室", placeholder: "例如 R106", prefix: "改至", list: "history-classrooms" },
    rescheduled: { label: "改至時間", placeholder: "例如 10/17（五）14:00", prefix: "改至", list: "" }
  };

  const ORIENTATIONS = ["landscape", "portrait"];
  const TEMPLATES = ["standard", "large", "compact"];
  const THEMES = ["classic", "friendly", "geometric", "contemporary", "official", "newsprint", "frontier"];
  const ORIENTATION_LABELS = { landscape: "橫式", portrait: "直式" };
  const TEMPLATE_LABELS = { standard: "標準排版", large: "醒目大字", compact: "多則緊湊" };
  const THEME_LABELS = { classic: "經典編輯", friendly: "校園手札", geometric: "幾何學院", contemporary: "當代展演", official: "校務公文", newsprint: "黑白報刊", frontier: "前線工業" };

  const SAMPLE_SHEET = {
    classroom: "R212",
    footer: "※ 遠距課程依授課老師公告為準",
    orientation: "landscape",
    template: "standard",
    notices: [
      { date: "9/7（一）、9/14（一）", course: "視覺互動程式設計", teacher: "王連晟", status: "cancelled", note: "" },
      { date: "9/10（四）", course: "聲音藝術", teacher: "王福瑞", status: "cancelled", note: "" }
    ]
  };

  const elements = {
    sheetTabs: document.querySelector("#sheet-tabs"),
    sheetHint: document.querySelector("#sheet-hint"),
    addSheet: document.querySelector("#add-sheet"),
    deleteSheet: document.querySelector("#delete-sheet"),
    exportSheets: document.querySelector("#export-sheets"),
    importSheets: document.querySelector("#import-sheets"),
    importFile: document.querySelector("#import-file"),
    ioMessage: document.querySelector("#io-message"),
    classroom: document.querySelector("#classroom"),
    footer: document.querySelector("#footer-text"),
    appearanceDetails: document.querySelector("#appearance-details"),
    appearanceSummary: document.querySelector("#appearance-summary"),
    orientationInputs: [...document.querySelectorAll('input[name="orientation"]')],
    templateInputs: [...document.querySelectorAll('input[name="template"]')],
    layoutGuidance: document.querySelector("#layout-guidance"),
    themeInputs: [...document.querySelectorAll('input[name="theme"]')],
    backgroundArtToggle: document.querySelector("#background-art-toggle"),
    addNotice: document.querySelector("#add-notice"),
    resetAll: document.querySelector("#reset-all"),
    exportImage: document.querySelector("#export-image"),
    exportImageLabel: document.querySelector("#export-image-label"),
    printNotice: document.querySelector("#print-notice"),
    overflowWarning: document.querySelector("#overflow-warning"),
    editorBody: document.querySelector("#editor-body"),
    editors: document.querySelector("#notice-editors"),
    noticeCount: document.querySelector("#notice-count"),
    limitMessage: document.querySelector("#limit-message"),
    reorderStatus: document.querySelector("#reorder-status"),
    undoBar: document.querySelector("#undo-bar"),
    undoText: document.querySelector("#undo-text"),
    undoButton: document.querySelector("#undo-delete"),
    historyClassrooms: document.querySelector("#history-classrooms"),
    historyCourses: document.querySelector("#history-courses"),
    historyTeachers: document.querySelector("#history-teachers"),
    previewStage: document.querySelector("#preview-stage"),
    previewPaperMeta: document.querySelector("#preview-paper-meta"),
    sheet: document.querySelector("#notice-sheet"),
    sheetBackgroundArt: document.querySelector("#sheet-background-art"),
    previewClassroom: document.querySelector("#preview-classroom"),
    previewNotices: document.querySelector("#preview-notices"),
    previewFooter: document.querySelector("#preview-footer"),
    saveStatus: document.querySelector("#save-status"),
    editorTemplate: document.querySelector("#notice-editor-template"),
    previewTemplate: document.querySelector("#preview-notice-template")
  };

  let state = loadState();
  let saveTimer;
  let undoState = null;      // { notice, index, label }
  let undoTimer;
  let ioTimer;
  let dragState = null;
  const fontDataPromises = new Map();
  const runtimeFontPromises = new Map();

  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function emptyNotice() {
    return { id: createId("notice"), date: "", level: "", course: "", teacher: "", status: "cancelled", target: "", note: "" };
  }

  function emptySheet(base = {}) {
    return {
      id: createId("sheet"),
      classroom: base.classroom ?? "",
      footer: base.footer ?? "※ 遠距課程依授課老師公告為準",
      orientation: base.orientation ?? "landscape",
      template: "standard",
      backgroundEnabled: base.backgroundEnabled ?? true,
      notices: [emptyNotice()]
    };
  }

  function sampleSheet() {
    const sheet = emptySheet();
    Object.assign(sheet, {
      classroom: SAMPLE_SHEET.classroom,
      footer: SAMPLE_SHEET.footer,
      orientation: SAMPLE_SHEET.orientation,
      template: SAMPLE_SHEET.template,
      // 走一次 sanitizeNotice，讓欄位順序與其他路徑一致（存檔內容才不會無謂變動）
      notices: SAMPLE_SHEET.notices.map((notice) => sanitizeNotice({ ...notice, id: createId("notice") }))
    });
    return sheet;
  }

  function defaultState() {
    const sheet = sampleSheet();
    return {
      theme: "classic",
      appearanceOpen: true,
      activeSheetId: sheet.id,
      sheets: [sheet],
      history: { classrooms: [], courses: [], teachers: [] }
    };
  }

  /* 目前正在編輯的那一張。所有讀寫都經過它，不要直接摸 state.sheets[0]。 */
  function activeSheet() {
    return state.sheets.find((sheet) => sheet.id === state.activeSheetId) || state.sheets[0];
  }

  function sanitizeNotice(notice) {
    const value = notice && typeof notice === "object" ? notice : {};
    return {
      id: typeof value.id === "string" ? value.id : createId("notice"),
      date: String(value.date ?? "").slice(0, 50),
      level: typeof value.level === "string" && Object.hasOwn(COURSE_LEVEL_LABELS, value.level) ? value.level : "",
      course: String(value.course ?? "").slice(0, 80),
      teacher: String(value.teacher ?? "").slice(0, 40),
      status: typeof value.status === "string" && Object.hasOwn(STATUS_LABELS, value.status) ? value.status : "general",
      target: String(value.target ?? "").slice(0, 30),
      note: String(value.note ?? "").slice(0, 100)
    };
  }

  function sanitizeSheet(sheet) {
    const value = sheet && typeof sheet === "object" ? sheet : {};
    const notices = Array.isArray(value.notices) ? value.notices.slice(0, MAX_NOTICES) : [];
    return {
      id: typeof value.id === "string" ? value.id : createId("sheet"),
      classroom: typeof value.classroom === "string" ? value.classroom.slice(0, 18) : "",
      footer: typeof value.footer === "string" ? value.footer.slice(0, 80) : "",
      orientation: ORIENTATIONS.includes(value.orientation) ? value.orientation : "landscape",
      template: TEMPLATES.includes(value.template) ? value.template : "standard",
      backgroundEnabled: value.backgroundEnabled !== false,
      notices: (notices.length ? notices : [emptyNotice()]).map(sanitizeNotice)
    };
  }

  function sanitizeHistoryList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const text = String(item ?? "").trim().slice(0, 80);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length >= HISTORY_LIMIT) break;
    }
    return out;
  }

  /*
   * 唯一的資料入口。任何從 localStorage 讀進來的東西都必須先過這裡：
   * 型別檢查、長度截斷、列舉白名單、至少保留一張公告與一則項目。
   * 新增欄位或列舉值時，記得同步更新這裡，否則舊資料還原會被靜默丟掉。
   */
  function sanitizeState(value) {
    if (!value || typeof value !== "object") return defaultState();
    const rawSheets = Array.isArray(value.sheets) ? value.sheets.slice(0, MAX_SHEETS) : [];
    const sheets = (rawSheets.length ? rawSheets : [sampleSheet()]).map(sanitizeSheet);
    const activeSheetId = sheets.some((sheet) => sheet.id === value.activeSheetId)
      ? value.activeSheetId
      : sheets[0].id;
    const history = value.history && typeof value.history === "object" ? value.history : {};
    return {
      theme: THEMES.includes(value.theme) ? value.theme : "classic",
      appearanceOpen: value.appearanceOpen !== false,
      activeSheetId,
      sheets,
      history: {
        classrooms: sanitizeHistoryList(history.classrooms),
        courses: sanitizeHistoryList(history.courses),
        teachers: sanitizeHistoryList(history.teachers)
      }
    };
  }

  /* v1 只存單張公告；把它包成 v2 的第一張，舊 key 保留不動（無害的備份）。 */
  function migrateLegacy() {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return null;
    const parsed = JSON.parse(legacy);
    const sheet = sanitizeSheet({
      classroom: parsed.classroom,
      footer: parsed.footer,
      orientation: parsed.orientation,
      template: parsed.template,
      notices: parsed.notices
    });
    return sanitizeState({
      theme: parsed.theme,
      activeSheetId: sheet.id,
      sheets: [sheet],
      history: {}
    });
  }

  function loadState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return sanitizeState(JSON.parse(stored));
      const migrated = migrateLegacy();
      if (migrated) return migrated;
      return defaultState();
    } catch (error) {
      console.warn("無法讀取已儲存資料，已改用預設內容。", error);
      return defaultState();
    }
  }

  function persistState() {
    elements.saveStatus.textContent = "儲存中…";
    elements.saveStatus.classList.add("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushPendingSave, 120);
  }

  function flushPendingSave() {
    if (saveTimer === undefined) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    elements.saveStatus.classList.remove("saving");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      elements.saveStatus.textContent = "已自動儲存";
    } catch (error) {
      console.warn("無法儲存資料。", error);
      elements.saveStatus.textContent = "無法自動儲存";
    }
  }

  /* ==========================================================================
   * 輸入記憶
   * 課名與老師每週幾乎重複，用 datalist 提供歷史值補完。
   * 只在 change（失焦）時收集，不在 input 時收集，免得半截字被記進去。
   * ======================================================================== */

  function rememberValue(key, rawValue) {
    const value = String(rawValue ?? "").trim();
    if (!value) return;
    const list = state.history[key];
    const index = list.indexOf(value);
    if (index !== -1) list.splice(index, 1);
    list.unshift(value);
    if (list.length > HISTORY_LIMIT) list.length = HISTORY_LIMIT;
    renderHistory();
    persistState();
  }

  function fillDatalist(node, values) {
    node.replaceChildren();
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      node.append(option);
    }
  }

  function renderHistory() {
    fillDatalist(elements.historyClassrooms, state.history.classrooms);
    fillDatalist(elements.historyCourses, state.history.courses);
    fillDatalist(elements.historyTeachers, state.history.teachers);
  }

  /* ==========================================================================
   * 排版可用性
   * ======================================================================== */

  function normalizeTemplateForCount() {
    const sheet = activeSheet();
    const count = sheet.notices.length;
    if (count >= 5 && sheet.template !== "compact") {
      sheet.template = "compact";
      return "公告達 5 則，已改用多則緊湊排版，避免文字被裁切。";
    }
    if (count >= 3 && sheet.template === "large") {
      sheet.template = "standard";
      return "公告超過 2 則，已改用標準排版，保留足夠閱讀空間。";
    }
    return "";
  }

  function updateTemplateAvailability(message = "") {
    const sheet = activeSheet();
    const count = sheet.notices.length;
    elements.templateInputs.forEach((input) => {
      input.disabled = (input.value === "large" && count >= 3) || (input.value === "standard" && count >= 5);
      input.checked = input.value === sheet.template;
    });
    elements.layoutGuidance.textContent = message || (
      count === 1
        ? "目前 1 則：已啟用單則主公告版；可選醒目大字進一步加強。"
        : count === 2
          ? "目前 2 則：三種排版皆可使用。"
        : count <= 4
          ? `目前 ${count} 則：建議標準排版；醒目大字已停用。`
          : `目前 ${count} 則：已使用多則緊湊排版。`
    );
  }

  function updateAppearanceSummary() {
    const sheet = activeSheet();
    elements.appearanceSummary.textContent = [
      ORIENTATION_LABELS[sheet.orientation],
      TEMPLATE_LABELS[sheet.template],
      THEME_LABELS[state.theme],
      sheet.backgroundEnabled ? "背景開啟" : "背景關閉"
    ].join("・");
  }

  /* ==========================================================================
   * 刪除復原
   * 單則刪除是高頻操作，用 confirm() 擋會很煩，改成刪完給 8 秒復原。
   * 刪掉整張草稿破壞性大得多，那個仍然用 confirm()。
   * ======================================================================== */

  function hideUndo() {
    clearTimeout(undoTimer);
    undoState = null;
    elements.undoBar.hidden = true;
  }

  function offerUndo(notice, index) {
    clearTimeout(undoTimer);
    undoState = { notice, index };
    elements.undoText.textContent = `已刪除第 ${index + 1} 則公告`;
    elements.undoBar.hidden = false;
    undoTimer = setTimeout(hideUndo, UNDO_TIMEOUT);
  }

  function undoDelete() {
    if (!undoState) return;
    const sheet = activeSheet();
    if (sheet.notices.length >= MAX_NOTICES) {
      hideUndo();
      return;
    }
    sheet.notices.splice(Math.min(undoState.index, sheet.notices.length), 0, undoState.notice);
    hideUndo();
    const layoutMessage = normalizeTemplateForCount();
    renderEditors();
    updateTemplateAvailability(layoutMessage);
    renderPreview();
    persistState();
  }

  /* ==========================================================================
   * 草稿分頁
   * ======================================================================== */

  function sheetLabel(sheet, index) {
    return sheet.classroom.trim() || `未命名 ${index + 1}`;
  }

  function switchSheet(id) {
    if (state.activeSheetId === id) return;
    hideUndo();
    state.activeSheetId = id;
    renderAll();
    persistState();
  }

  function renderSheetTabs() {
    elements.sheetTabs.replaceChildren();
    state.sheets.forEach((sheet, index) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "sheet-tab";
      tab.textContent = sheetLabel(sheet, index);
      const isActive = sheet.id === state.activeSheetId;
      tab.setAttribute("aria-pressed", String(isActive));
      tab.addEventListener("click", () => switchSheet(sheet.id));
      elements.sheetTabs.append(tab);
    });

    const total = state.sheets.length;
    const position = state.sheets.findIndex((sheet) => sheet.id === state.activeSheetId) + 1;
    elements.sheetHint.textContent = total === 1
      ? "列印只會輸出目前這張。"
      : `共 ${total} 張，正在編輯第 ${position} 張；列印只會輸出目前這張。`;
    elements.addSheet.disabled = total >= MAX_SHEETS;
    elements.deleteSheet.disabled = total <= 1;
  }

  function addSheet() {
    if (state.sheets.length >= MAX_SHEETS) return;
    // 新草稿沿用目前這張的頁尾、紙張方向與背景偏好，通常同一批公告設定一樣。
    const current = activeSheet();
    const sheet = emptySheet({
      footer: current.footer,
      orientation: current.orientation,
      backgroundEnabled: current.backgroundEnabled
    });
    state.sheets.push(sheet);
    state.activeSheetId = sheet.id;
    hideUndo();
    renderAll();
    persistState();
    elements.classroom.focus();
  }

  function deleteSheet() {
    if (state.sheets.length <= 1) return;
    const index = state.sheets.findIndex((sheet) => sheet.id === state.activeSheetId);
    const label = sheetLabel(state.sheets[index], index);
    if (!window.confirm(`確定要刪除「${label}」這張公告嗎？此動作無法復原。`)) return;
    state.sheets.splice(index, 1);
    state.activeSheetId = state.sheets[Math.min(index, state.sheets.length - 1)].id;
    hideUndo();
    renderAll();
    persistState();
  }

  /* ==========================================================================
   * 匯出／匯入
   *
   * localStorage 只活在單一瀏覽器，換電腦、清快取、無痕視窗都會消失，
   * 所以提供一個純 JSON 的備份檔進出。沒有雲端、沒有帳號，就是一個檔案。
   *
   * 匯入一律是「附加」，不會覆蓋現有草稿——這是刻意的：
   * 匯入不可逆，讓它永遠不破壞既有內容，比跳一個「取代還是附加？」
   * 的確認框好懂得多。要清空的人自己按「清空全部」再匯入。
   * 主題不隨檔案走（那是這台電腦的偏好），輸入記憶則會合併。
   * ======================================================================== */

  function showIoMessage(text, isError = false) {
    clearTimeout(ioTimer);
    elements.ioMessage.textContent = text;
    elements.ioMessage.classList.toggle("is-error", isError);
    elements.ioMessage.hidden = false;
    ioTimer = setTimeout(() => { elements.ioMessage.hidden = true; }, IO_MESSAGE_TIMEOUT);
  }

  function dateStamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function exportSheets() {
    const payload = {
      format: EXPORT_FORMAT,
      version: 2,
      exportedAt: new Date().toISOString(),
      sheets: state.sheets,
      history: state.history
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    /*
     * 檔名刻意用純英數。實測 Chromium 對 blob 下載的中文 download 檔名會整個丟掉，
     * 存出來變成一個叫「download」的無副檔名檔案，使用者根本不知道那是什麼。
     * 這是備份檔，正確好認比名字好看重要——不要改回中文。
     */
    link.download = `course-notice-backup-${dateStamp()}.json`;
    // 一定要真的掛進 DOM 再點：部分瀏覽器對「沒進過文件的 <a>」會忽略 download 屬性，
    // 結果存出來是一個叫「download」的無副檔名檔案。
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);   // 給瀏覽器時間取用再釋放
    showIoMessage(`已匯出 ${state.sheets.length} 張草稿。`);
  }

  /*
   * 不依賴外部套件，把目前紙張與已載入的 CSS 包進 SVG foreignObject，
   * 再由 Canvas 轉成 PNG。所有素材都在檔案內，因此雙擊 index.html 離線使用時
   * 也能匯出；2 倍尺寸相當於約 192 dpi，A4 橫式會得到 2245 × 1587 px。
   */
  function escapeXmlText(text) {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("無法讀取嵌入字體。"));
      reader.readAsDataURL(blob);
    });
  }

  function loadFontFallbackScript(asset, key) {
    return new Promise((resolve, reject) => {
      if (window.COURSE_NOTICE_FONT_DATA?.[key]) {
        resolve(window.COURSE_NOTICE_FONT_DATA[key]);
        return;
      }
      const script = document.createElement("script");
      script.src = asset.fallbackScript;
      script.onload = () => {
        script.remove();
        const encoded = window.COURSE_NOTICE_FONT_DATA?.[key];
        if (encoded) resolve(encoded);
        else reject(new Error("離線字體資料不完整，請確認 fonts 資料夾仍與 index.html 放在一起。"));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("找不到離線字體資料，請確認 fonts 資料夾仍與 index.html 放在一起。"));
      };
      document.head.append(script);
    });
  }

  function fontDataUrl(key) {
    if (fontDataPromises.has(key)) return fontDataPromises.get(key);
    const asset = FONT_ASSETS[key];
    const promise = (async () => {
      if (window.location.protocol === "file:") {
        const encoded = await loadFontFallbackScript(asset, key);
        return `data:font/woff2;base64,${encoded}`;
      }
      try {
        const response = await fetch(asset.file);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await blobToDataUrl(await response.blob());
      } catch (error) {
        // file:// 禁止 fetch 同資料夾檔案；改載入延遲 Base64 備援，維持離線 PNG 一致。
        const encoded = await loadFontFallbackScript(asset, key);
        return `data:font/woff2;base64,${encoded}`;
      }
    })();
    fontDataPromises.set(key, promise);
    return promise;
  }

  function loadRuntimeFont(key) {
    if (runtimeFontPromises.has(key)) return runtimeFontPromises.get(key);
    const asset = FONT_ASSETS[key];
    const promise = (async () => {
      const source = window.location.protocol === "file:"
        ? `url("${await fontDataUrl(key)}") format("woff2")`
        : `url("${asset.file}") format("woff2")`;
      const face = new FontFace(asset.family, source, {
        style: "normal",
        weight: asset.weight,
        display: "swap"
      });
      await face.load();
      document.fonts.add(face);
      return face;
    })();
    runtimeFontPromises.set(key, promise);
    return promise;
  }

  function fontKeysForTheme(theme) {
    return theme === "official" || theme === "newsprint" ? ["sans", "serif"] : ["sans"];
  }

  async function loadRuntimeFontsForCurrentTheme() {
    await Promise.all(fontKeysForTheme(state.theme).map(loadRuntimeFont));
  }

  async function embeddedFontCss(theme) {
    const rules = await Promise.all(fontKeysForTheme(theme).map(async (key) => {
      const asset = FONT_ASSETS[key];
      const dataUrl = await fontDataUrl(key);
      return `@font-face{font-family:"${asset.family}";src:url("${dataUrl}") format("woff2");font-style:normal;font-weight:${asset.weight};}`;
    }));
    return rules.join("\n");
  }

  async function waitForCurrentFonts(theme = state.theme) {
    if (!document.fonts) return;
    await Promise.all(fontKeysForTheme(theme).map(loadRuntimeFont));
  }

  function styleDeclarationText(styles) {
    return [...styles].map((property) => {
      const value = styles.getPropertyValue(property);
      const priority = styles.getPropertyPriority(property);
      return `${property}:${value}${priority ? " !important" : ""};`;
    }).join("");
  }

  /*
   * file:// 頁面在 Chromium 裡不能讀取外部 stylesheet.cssRules（同資料夾也會被
   * 視為不同來源），所以不能靠複製 CSS 檔。改把每個節點目前真正算出的樣式寫回
   * clone；偽元素另外產生限定到單一節點的規則。這讓離線與線上版本走同一條路徑。
   */
  function createStyledExportClone(sheet) {
    const clone = sheet.cloneNode(true);
    const sources = [sheet, ...sheet.querySelectorAll("*")];
    const targets = [clone, ...clone.querySelectorAll("*")];
    const pseudoRules = [];

    sources.forEach((source, index) => {
      const target = targets[index];
      target.style.cssText = styleDeclarationText(getComputedStyle(source));

      for (const pseudo of ["::before", "::after"]) {
        const styles = getComputedStyle(source, pseudo);
        if (styles.content === "none" || styles.content === "normal") continue;
        const exportId = target.dataset.exportNode || `node-${index}`;
        target.dataset.exportNode = exportId;
        pseudoRules.push(`[data-export-node="${exportId}"]${pseudo}{${styleDeclarationText(styles)}}`);
      }
    });

    clone.removeAttribute("id");
    clone.setAttribute("aria-hidden", "true");
    return { clone, pseudoRules: pseudoRules.join("\n") };
  }

  function styleExportSnapshot(snapshot, theme) {
    const currentTheme = document.body.dataset.theme;
    // Measure with the original theme and loaded fonts; restore the live preview
    // synchronously before yielding back to the browser.
    document.body.dataset.theme = theme;
    elements.sheet.replaceWith(snapshot);
    try {
      if (fitSheet(snapshot)) {
        throw new Error("要匯出的公告超出 A4 範圍。請縮短內容、改用直式或拆成兩張，再下載。");
      }
      return createStyledExportClone(snapshot);
    } finally {
      snapshot.replaceWith(elements.sheet);
      document.body.dataset.theme = currentTheme;
    }
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("瀏覽器無法產生圖片，請改用最新版 Chrome 或 Edge。"));
      image.src = url;
    });
  }

  function canvasToPng(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG 轉換失敗，請再試一次。"));
      }, "image/png");
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportCurrentSheetAsImage() {
    const snapshot = elements.sheet.cloneNode(true);
    const theme = state.theme;
    const portrait = snapshot.classList.contains("orientation-portrait");
    const width = portrait ? 793.7 : 1122.52;
    const height = portrait ? 1122.52 : 793.7;
    elements.exportImage.disabled = true;
    elements.exportImage.setAttribute("aria-busy", "true");
    elements.exportImageLabel.textContent = "產生中…";

    try {
      await waitForCurrentFonts(theme);
      const { clone, pseudoRules } = styleExportSnapshot(snapshot, theme);
      const fontCss = await embeddedFontCss(theme);
      const sheetXml = new XMLSerializer().serializeToString(clone);
      const exportOverrides = `
        .notice-sheet { position: static !important; top: auto !important; left: auto !important; width: ${width}px !important; height: ${height}px !important; margin: 0 !important; transform: none !important; box-shadow: none !important; }
        .is-placeholder { visibility: hidden !important; }
      `;
      const css = escapeXmlText(`${fontCss}\n${pseudoRules}\n${exportOverrides}`);
      const markup = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;margin:0;overflow:hidden;background:#fff">
              <style>${css}</style>${sheetXml}
            </div>
          </foreignObject>
        </svg>`;
      // data URL 不帶 file:// 的不透明來源；否則 Chromium 會把 Canvas 標成 tainted，
      // 即使 SVG 裡沒有任何外部圖片，也會拒絕輸出 PNG。
      const sourceImage = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * IMAGE_EXPORT_SCALE);
      canvas.height = Math.round(height * IMAGE_EXPORT_SCALE);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("瀏覽器不支援圖片輸出。");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.scale(IMAGE_EXPORT_SCALE, IMAGE_EXPORT_SCALE);
      context.drawImage(sourceImage, 0, 0, width, height);
      const png = await canvasToPng(canvas);
      downloadBlob(png, `course-notice-${dateStamp()}.png`);
      showIoMessage(`已下載目前公告的 PNG 圖片（${canvas.width} × ${canvas.height} px）。`);
    } catch (error) {
      console.error(error);
      showIoMessage(error?.message || "圖片匯出失敗，請再試一次。", true);
    } finally {
      elements.exportImage.disabled = false;
      elements.exportImage.removeAttribute("aria-busy");
      elements.exportImageLabel.textContent = "下載圖片";
      updatePreviewScale();
    }
  }

  function mergeHistory(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    for (const key of ["classrooms", "courses", "teachers"]) {
      // 本機的排前面，再接上檔案裡的；sanitizeHistoryList 會去重並限筆數
      state.history[key] = sanitizeHistoryList([...state.history[key], ...sanitizeHistoryList(incoming[key])]);
    }
  }

  function importSheets(file) {
    const reader = new FileReader();
    reader.onerror = () => showIoMessage("讀取檔案失敗，請再試一次。", true);
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (error) {
        showIoMessage("這不是有效的 JSON 檔，請確認選到的是本工具匯出的備份。", true);
        return;
      }
      // 也接受直接把 localStorage 內容存成檔案的情況，所以只認 sheets 陣列
      const incoming = Array.isArray(parsed?.sheets) ? parsed.sheets : null;
      if (!incoming || !incoming.length) {
        showIoMessage("檔案裡沒有任何公告草稿，請確認選到的是本工具匯出的備份。", true);
        return;
      }
      const room = MAX_SHEETS - state.sheets.length;
      if (room <= 0) {
        showIoMessage(`草稿已達 ${MAX_SHEETS} 張上限，請先刪掉幾張再匯入。`, true);
        return;
      }
      const accepted = incoming.slice(0, room).map((sheet) => {
        const clean = sanitizeSheet(sheet);
        // 重新配 id，否則備份檔和現有草稿撞號時切換會跳錯張
        clean.id = createId("sheet");
        clean.notices = clean.notices.map((notice) => sanitizeNotice({ ...notice, id: createId("notice") }));
        return clean;
      });
      state.sheets.push(...accepted);
      state.activeSheetId = accepted[0].id;
      mergeHistory(parsed.history);
      hideUndo();
      renderAll();
      persistState();
      const skipped = incoming.length - accepted.length;
      showIoMessage(skipped
        ? `已匯入 ${accepted.length} 張草稿；另有 ${skipped} 張因為超過 ${MAX_SHEETS} 張上限沒有匯入。`
        : `已匯入 ${accepted.length} 張草稿，附加在原有草稿後面。`);
    };
    reader.readAsText(file);
  }

  /* ==========================================================================
   * 事件綁定
   * ======================================================================== */

  function connectStaticControls() {
    elements.classroom.addEventListener("input", (event) => {
      activeSheet().classroom = event.target.value;
      renderSheetTabs();
      renderPreview();
      persistState();
    });
    elements.classroom.addEventListener("change", (event) => rememberValue("classrooms", event.target.value));

    elements.footer.addEventListener("input", (event) => {
      activeSheet().footer = event.target.value;
      renderPreview();
      persistState();
    });

    elements.orientationInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        activeSheet().orientation = input.value;
        renderPreview();
        persistState();
      });
    });

    elements.templateInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        activeSheet().template = input.value;
        renderPreview();
        persistState();
      });
    });

    elements.themeInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        state.theme = input.value;   // 主題是整個工具的偏好，不隨草稿切換
        document.body.dataset.theme = state.theme;
        requestAnimationFrame(() => {
          fitSheet();
          updatePreviewScale();
        });
        updateAppearanceSummary();
        persistState();
        loadRuntimeFontsForCurrentTheme().then(() => {
          fitSheet();
          updatePreviewScale();
        }).catch((error) => {
          console.error(error);
          showIoMessage("字體載入失敗，目前暫用系統字體。", true);
        });
      });
    });

    elements.appearanceDetails.addEventListener("toggle", () => {
      if (state.appearanceOpen === elements.appearanceDetails.open) return;
      state.appearanceOpen = elements.appearanceDetails.open;
      persistState();
    });

    elements.backgroundArtToggle.addEventListener("change", (event) => {
      activeSheet().backgroundEnabled = event.target.checked;
      renderPreview();
      persistState();
    });

    elements.addSheet.addEventListener("click", addSheet);
    elements.deleteSheet.addEventListener("click", deleteSheet);
    elements.exportSheets.addEventListener("click", exportSheets);
    elements.importSheets.addEventListener("click", () => elements.importFile.click());
    elements.importFile.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) importSheets(file);
      event.target.value = "";   // 清掉，才能連續匯入同一個檔案
    });
    elements.undoButton.addEventListener("click", undoDelete);

    elements.addNotice.addEventListener("click", () => {
      const sheet = activeSheet();
      if (sheet.notices.length >= MAX_NOTICES) return;
      hideUndo();
      sheet.notices.push(emptyNotice());
      const layoutMessage = normalizeTemplateForCount();
      renderEditors();
      updateTemplateAvailability(layoutMessage);
      renderPreview();
      persistState();
      const newEditor = elements.editors.lastElementChild;
      newEditor?.querySelector("input")?.focus({ preventScroll: true });
      newEditor?.scrollIntoView({ block: "start" });
    });

    elements.resetAll.addEventListener("click", () => {
      const confirmed = window.confirm("確定要清空全部內容嗎？所有公告草稿都會被刪除，此動作無法復原。");
      if (!confirmed) return;
      const sheet = emptySheet({
        footer: "",
        orientation: activeSheet().orientation,
        backgroundEnabled: activeSheet().backgroundEnabled
      });
      hideUndo();
      state = {
        theme: state.theme,
        appearanceOpen: state.appearanceOpen,
        activeSheetId: sheet.id,
        sheets: [sheet],
        history: state.history   // 輸入記憶不算內容，保留
      };
      renderAll();
      persistState();
      elements.classroom.focus();
    });

    elements.exportImage.addEventListener("click", exportCurrentSheetAsImage);
    elements.printNotice.addEventListener("click", async () => {
      try {
        await waitForCurrentFonts();
      } catch (error) {
        console.error(error);
        showIoMessage("字體載入失敗，將以目前可用字體開啟列印。", true);
      }
      if (fitSheet()) return;
      window.print();
    });
    document.addEventListener("pointermove", moveDraggedNotice, { passive: false });
    document.addEventListener("pointerup", finishNoticeDrag);
    for (const type of ["pointercancel", "lostpointercapture"]) {
      elements.editors.addEventListener(type, (event) => {
        if (dragState?.pointerId === event.pointerId) cancelNoticeDrag();
      });
    }
    elements.editors.addEventListener("contextmenu", (event) => {
      if (dragState) event.preventDefault();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !dragState) return;
      event.preventDefault();
      cancelNoticeDrag();
    });
    window.addEventListener("blur", cancelNoticeDrag);
    window.addEventListener("resize", updatePreviewScale);
    window.addEventListener("beforeprint", () => {
      document.documentElement.style.setProperty("--preview-scale", "1");
      fitSheet();
    });
    window.addEventListener("afterprint", updatePreviewScale);
    window.addEventListener("pagehide", flushPendingSave);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flushPendingSave();
    });
  }

  /* ==========================================================================
   * 渲染
   * ======================================================================== */

  function updateEditorPositionLabels() {
    const cards = [...elements.editors.children];
    cards.forEach((article, index) => {
      article.querySelector("h3").textContent = `第 ${index + 1} 則公告`;
      const handle = article.querySelector(".drag-notice");
      handle.setAttribute("aria-label", `拖曳第 ${index + 1} 則公告調整順序；按向上或向下方向鍵也可移動`);
      article.querySelector(".delete-notice").setAttribute("aria-label", `刪除第 ${index + 1} 則公告`);
    });
  }

  function focusNoticeDragHandle(noticeId) {
    const article = [...elements.editors.children].find((item) => item.dataset.id === noticeId);
    article?.querySelector(".drag-notice")?.focus({ preventScroll: true });
  }

  function announceNoticePosition(noticeId) {
    const index = activeSheet().notices.findIndex((notice) => notice.id === noticeId);
    elements.reorderStatus.textContent = `已移至第 ${index + 1} 則，共 ${activeSheet().notices.length} 則。`;
  }

  function reorderNoticeWithKeyboard(noticeId, offset) {
    const sheet = activeSheet();
    const from = sheet.notices.findIndex((notice) => notice.id === noticeId);
    const to = Math.max(0, Math.min(from + offset, sheet.notices.length - 1));
    if (from < 0 || from === to) return;
    const [notice] = sheet.notices.splice(from, 1);
    sheet.notices.splice(to, 0, notice);
    renderEditors();
    renderPreview();
    persistState();
    announceNoticePosition(noticeId);
    requestAnimationFrame(() => focusNoticeDragHandle(noticeId));
  }

  function autoScrollWhileDragging(clientY) {
    const stacked = window.matchMedia("(max-width: 1050px)").matches;
    const bounds = stacked
      ? { top: 0, bottom: window.innerHeight }
      : elements.editorBody.getBoundingClientRect();
    const edge = 64;
    let delta = 0;
    if (clientY < bounds.top + edge) delta = -18;
    else if (clientY > bounds.bottom - edge) delta = 18;
    if (!delta) return;
    if (stacked) window.scrollBy(0, delta);
    else elements.editorBody.scrollTop += delta;
  }

  function liftNotice(drag) {
    clearTimeout(drag.holdTimer);
    const card = drag.article.cloneNode(true);
    const bounds = drag.article.getBoundingClientRect();
    card.classList.add("notice-drag-float");
    card.setAttribute("aria-hidden", "true");
    card.inert = true;
    card.querySelectorAll("[id], [list], label[for]").forEach((node) => {
      for (const attribute of ["id", "list", "for"]) node.removeAttribute(attribute);
    });
    const controls = drag.article.querySelectorAll("[data-field]");
    card.querySelectorAll("[data-field]").forEach((node, index) => { node.value = controls[index].value; });
    const position = [...elements.editors.children].indexOf(drag.article) + 1;
    card.querySelector("h3").dataset.dragNumber = String(position).padStart(2, "0");
    card.style.top = `${bounds.top}px`;
    card.style.left = `${bounds.left}px`;
    card.style.width = `${bounds.width}px`;
    document.body.append(card);
    drag.float = card;
    drag.article.classList.add("is-drag-placeholder");
    document.body.classList.add("notice-drag-active");
  }

  function moveDraggedNotice(event) {
    const drag = dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const offset = event.clientY - drag.startY;
    if (!drag.float) {
      if (Math.abs(offset) < DRAG_START_DISTANCE) return;
      liftNotice(drag);
    }
    drag.float.style.setProperty("--drag-offset", `${offset}px`);
    autoScrollWhileDragging(event.clientY);
    const { article } = drag;
    const otherCards = [...elements.editors.children].filter((item) => item !== article);
    const nextCard = otherCards.find((item) => {
      const bounds = item.getBoundingClientRect();
      return event.clientY < bounds.top + bounds.height / 2;
    });
    if (nextCard) {
      if (article.nextElementSibling === nextCard) return;
      elements.editors.insertBefore(article, nextCard);
    } else {
      if (article === elements.editors.lastElementChild) return;
      elements.editors.append(article);
    }
    drag.moved = true;
    updateEditorPositionLabels();
  }

  function clearNoticeDrag() {
    const drag = dragState;
    if (!drag) return;
    dragState = null;
    clearTimeout(drag.holdTimer);
    if (elements.editors.hasPointerCapture(drag.pointerId)) elements.editors.releasePointerCapture(drag.pointerId);
    drag.float?.remove();
    drag.article.classList.remove("is-drag-placeholder");
    document.body.classList.remove("notice-drag-active");
  }

  function cancelNoticeDrag() {
    const moved = dragState?.moved;
    clearNoticeDrag();
    if (moved) renderEditors();
  }

  function finishNoticeDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const { sheetId, noticeId, moved } = dragState;
    clearNoticeDrag();
    if (!moved || activeSheet().id !== sheetId) return;

    const noticesById = new Map(activeSheet().notices.map((notice) => [notice.id, notice]));
    activeSheet().notices = [...elements.editors.children]
      .map((item) => noticesById.get(item.dataset.id))
      .filter(Boolean);
    renderEditors();
    renderPreview();
    persistState();
    announceNoticePosition(noticeId);
    requestAnimationFrame(() => focusNoticeDragHandle(noticeId));
  }

  function beginNoticeDrag(event, article, noticeId) {
    if (dragState || event.button !== 0 || activeSheet().notices.length <= 1) return;
    event.preventDefault();
    // Capture on the list so that moving the original card does not interrupt the drag.
    elements.editors.setPointerCapture(event.pointerId);
    const drag = {
      article,
      pointerId: event.pointerId,
      sheetId: activeSheet().id,
      noticeId,
      startY: event.clientY,
      moved: false
    };
    dragState = drag;
    drag.holdTimer = setTimeout(() => {
      if (dragState === drag) liftNotice(drag);
    }, DRAG_HOLD_MS);
  }

  function renderEditors() {
    clearNoticeDrag();
    const sheet = activeSheet();
    elements.editors.replaceChildren();
    sheet.notices.forEach((notice, index) => {
      const fragment = elements.editorTemplate.content.cloneNode(true);
      const article = fragment.querySelector(".notice-editor");
      article.dataset.id = notice.id;
      fragment.querySelector("h3").textContent = `第 ${index + 1} 則公告`;

      const dragHandle = fragment.querySelector(".drag-notice");
      dragHandle.disabled = sheet.notices.length === 1;
      dragHandle.setAttribute("aria-label", `拖曳第 ${index + 1} 則公告調整順序；按向上或向下方向鍵也可移動`);
      dragHandle.addEventListener("pointerdown", (event) => beginNoticeDrag(event, article, notice.id));
      dragHandle.addEventListener("keydown", (event) => {
        if (dragState) return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        reorderNoticeWithKeyboard(notice.id, event.key === "ArrowUp" ? -1 : 1);
      });

      fragment.querySelectorAll("[data-field]").forEach((control) => {
        const field = control.dataset.field;
        const controlId = `${field}-${notice.id}`;
        control.id = controlId;
        control.value = notice[field];
        control.closest(".field-group").querySelector("label").htmlFor = controlId;
        control.addEventListener("input", (event) => {
          notice[field] = event.target.value;
          renderPreview();
          persistState();
        });
        if (field === "course" || field === "teacher") {
          control.addEventListener("change", (event) => {
            rememberValue(field === "course" ? "courses" : "teachers", event.target.value);
          });
        }
      });

      /*
       * 補充欄位只在「教室異動 / 時間調整」這類狀態下出現（見 STATUS_TARGETS）。
       * 切到其他狀態時只是隱藏，不清空 notice.target——使用者切回來時值還在。
       * 印出來的內容由 renderPreview() 決定，隱藏的值不會出現在公告上。
       */
      const targetGroup = fragment.querySelector(".field-group-target");
      const targetInput = targetGroup.querySelector('[data-field="target"]');
      const targetLabel = targetGroup.querySelector("label");
      const syncTargetField = () => {
        const config = STATUS_TARGETS[notice.status];
        targetGroup.hidden = !config;
        if (!config) return;
        targetLabel.textContent = config.label;
        targetInput.placeholder = config.placeholder;
        if (config.list) targetInput.setAttribute("list", config.list);
        else targetInput.removeAttribute("list");
      };
      syncTargetField();
      fragment.querySelector('[data-field="status"]').addEventListener("input", syncTargetField);

      const deleteButton = fragment.querySelector(".delete-notice");
      deleteButton.setAttribute("aria-label", `刪除第 ${index + 1} 則公告`);
      deleteButton.disabled = sheet.notices.length === 1;
      deleteButton.addEventListener("click", () => {
        if (sheet.notices.length === 1) return;
        const position = sheet.notices.indexOf(notice);
        sheet.notices.splice(position, 1);
        offerUndo(notice, position);
        const layoutMessage = normalizeTemplateForCount();
        renderEditors();
        updateTemplateAvailability(layoutMessage);
        renderPreview();
        persistState();
      });

      elements.editors.append(fragment);
    });

    const atLimit = sheet.notices.length >= MAX_NOTICES;
    elements.noticeCount.textContent = `${sheet.notices.length} / ${MAX_NOTICES} 則`;
    elements.addNotice.disabled = atLimit;
    elements.limitMessage.hidden = !atLimit;
  }

  function renderPreview() {
    const sheet = activeSheet();
    const count = sheet.notices.length;
    updateAppearanceSummary();
    elements.previewClassroom.textContent = sheet.classroom.trim() || "教室";
    elements.previewFooter.textContent = sheet.footer.trim();
    const isPortrait = sheet.orientation === "portrait";
    document.body.dataset.orientation = sheet.orientation;
    elements.previewPaperMeta.textContent = isPortrait ? "210 × 297 mm・直式" : "297 × 210 mm・橫式";
    elements.previewNotices.replaceChildren();
    elements.sheet.style.setProperty("--notice-count", count);
    elements.sheet.className = `notice-sheet orientation-${sheet.orientation} template-${sheet.template} count-${count} ${sheet.backgroundEnabled ? "background-on" : "background-off"}`;
    elements.sheetBackgroundArt.dataset.mark = sheet.classroom.trim() || "NOTICE";
    elements.sheet.setAttribute("aria-label", `A4 ${isPortrait ? "直式" : "橫式"}課程異動公告預覽`);
    document.documentElement.style.setProperty("--print-width", isPortrait ? "210mm" : "297mm");
    document.documentElement.style.setProperty("--print-height", isPortrait ? "297mm" : "210mm");

    sheet.notices.forEach((notice) => {
      const fragment = elements.previewTemplate.content.cloneNode(true);
      const item = fragment.querySelector(".sheet-notice");
      const date = notice.date.trim() || "日期待定";
      const course = notice.course.trim() || "課程名稱";
      const teacher = notice.teacher.trim();
      const note = notice.note.trim();
      if (note) item.classList.add("has-note");

      const dateElement = fragment.querySelector(".notice-date");
      const levelElement = fragment.querySelector(".notice-level");
      const courseElement = fragment.querySelector(".notice-course");
      const teacherElement = fragment.querySelector(".notice-teacher");
      const teacherText = fragment.querySelector(".notice-teacher-text");
      const noteElement = fragment.querySelector(".notice-note");
      const noteText = fragment.querySelector(".notice-note-text");
      dateElement.textContent = date;
      const levelLabel = COURSE_LEVEL_LABELS[notice.level] || "";
      levelElement.textContent = levelLabel;
      levelElement.hidden = !levelLabel;
      if (levelLabel) levelElement.classList.add(`level-${notice.level}`);
      courseElement.textContent = course;
      teacherText.textContent = teacher ? `${teacher} 老師` : "授課教師待定";
      noteText.textContent = note;
      noteElement.hidden = !note;
      if (!notice.date.trim()) dateElement.classList.add("is-placeholder");
      if (!notice.course.trim()) courseElement.classList.add("is-placeholder");
      if (!teacher) teacherElement.classList.add("is-placeholder");
      const status = fragment.querySelector(".notice-status");
      status.textContent = STATUS_LABELS[notice.status];
      status.classList.add(`status-${notice.status}`);

      const targetConfig = STATUS_TARGETS[notice.status];
      const target = notice.target.trim();
      const targetElement = fragment.querySelector(".notice-target");
      if (targetConfig && target) {
        targetElement.textContent = `${targetConfig.prefix} ${target}`;
        item.classList.add("has-target");
      } else {
        targetElement.hidden = true;
      }

      elements.previewNotices.append(fragment);
    });

    requestAnimationFrame(() => {
      fitSheet();
      updatePreviewScale();
    });
  }

  /* ==========================================================================
   * 自動縮字（量測式，不是猜字數）
   *
   * 版面尺寸全由 CSS 變數決定，這裡只調整兩個倍率，由 style.css 用 calc() 乘進去：
   *   --head-scale  教室名稱字級，目標是維持單行，不要把報頭撐高
   *   --fit-scale   公告區的字級與間距，目標是不要溢出 A4
   * 兩者都是「調一級、量一次、塞得下就停」，所以中英混排、全形標點、
   * 不同主題的字體寬度都不會誤判。
   * ======================================================================== */

  const HEAD_STEPS = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.54, 0.48];
  const FIT_STEPS = [1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6];
  const FIT_TOLERANCE = 1; // px，容忍次像素誤差

  function overflowsVertically(element) {
    return element.scrollHeight - element.clientHeight > FIT_TOLERANCE;
  }

  /* 教室名稱：縮到單行為止。到最小級數仍折行就接受兩行（極端長名）。 */
  function fitHeader(sheet) {
    const element = sheet.querySelector(".sheet-classroom");
    for (const step of HEAD_STEPS) {
      sheet.style.setProperty("--head-scale", String(step));
      const styles = getComputedStyle(element);
      const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize);
      if (element.offsetHeight <= lineHeight + FIT_TOLERANCE) break;
    }
  }

  function fitSheet(sheet = elements.sheet) {
    const notices = sheet.querySelector(".sheet-notices");
    if (!notices.isConnected || notices.clientHeight === 0) return sheet.dataset.overflow === "true";

    fitHeader(sheet);
    const items = [...notices.querySelectorAll(".sheet-notice")];
    items.forEach((item) => item.style.removeProperty("--fit-scale"));

    let applied = 1;
    for (const step of FIT_STEPS) {
      applied = step;
      sheet.style.setProperty("--fit-scale", String(step));
      if (!overflowsVertically(notices)) break;
    }

    // 第二關：極少數情況下單一則的內容仍超出自己的框（例如超長備註），
    // 針對那一則再多降一級，避免文字被 overflow:hidden 裁掉。
    items.forEach((item) => {
      if (overflowsVertically(item)) {
        item.style.setProperty("--fit-scale", String(Math.max(applied * 0.88, 0.55)));
      }
    });

    const overflow = overflowsVertically(sheet) || overflowsVertically(notices) || items.some(overflowsVertically);
    sheet.dataset.fitScale = applied.toFixed(2);
    sheet.dataset.overflow = String(overflow);
    if (sheet === elements.sheet) elements.overflowWarning.hidden = !overflow;
    return overflow;
  }

  function updatePreviewScale() {
    if (window.matchMedia("print").matches) return;
    const stageRect = elements.previewStage.getBoundingClientRect();
    const horizontalPadding = 24;
    const verticalPadding = 20;
    const portrait = activeSheet().orientation === "portrait";
    const paperWidth = portrait ? 793.7 : 1122.52;
    const paperHeight = portrait ? 1122.52 : 793.7;
    const scale = Math.min(
      (stageRect.width - horizontalPadding) / paperWidth,
      (stageRect.height - verticalPadding) / paperHeight,
      1
    );
    document.documentElement.style.setProperty("--preview-scale", String(Math.max(scale, 0.18)));
  }

  function renderAll() {
    const sheet = activeSheet();
    const layoutMessage = normalizeTemplateForCount();
    elements.classroom.value = sheet.classroom;
    elements.footer.value = sheet.footer;
    elements.appearanceDetails.open = state.appearanceOpen;
    elements.orientationInputs.forEach((input) => { input.checked = input.value === sheet.orientation; });
    elements.backgroundArtToggle.checked = sheet.backgroundEnabled;
    updateTemplateAvailability(layoutMessage);
    elements.themeInputs.forEach((input) => { input.checked = input.value === state.theme; });
    document.body.dataset.theme = state.theme;
    renderSheetTabs();
    renderHistory();
    renderEditors();
    renderPreview();
  }

  connectStaticControls();
  renderAll();
  // 開檔就寫一次：確保 v1 搬移結果、以及 sanitizeState() 修正過的內容立刻落地，
  // 不必等使用者先動一下才存。
  persistState();

  loadRuntimeFontsForCurrentTheme().then(() => {
    fitSheet();
    updatePreviewScale();
  }).catch((error) => {
    console.error(error);
    showIoMessage("字體載入失敗，目前暫用系統字體。", true);
  });

  // 字體換掉後字寬會變，重算一次才不會出現「載入完才溢出」。
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      fitSheet();
      updatePreviewScale();
    });
    document.fonts.addEventListener("loadingdone", () => {
      fitSheet();
      updatePreviewScale();
    });
  }
})();
