# A4 課程異動公告工具 — 專案現況與維護說明

> 這份文件描述**目前程式碼實際長什麼樣子**，給後續維護者與 AI agent 看。
> 同目錄的 `CODEX_A4_課程異動公告工具規格.md` 是最初的需求規格，兩者角色不同：
> 規格說「當初想要什麼」，本文說「現在做成什麼、要改動哪裡」。
> 兩者衝突時，以本文為準（實作已在幾處刻意超出原規格，見〈與原規格的差異〉）。

最後更新：2026-11-15（第十二次改版）

---

## 1. 一句話

純前端、零依賴、可離線的 A4 課程異動公告排版工具。左邊填表，右邊即時預覽一張 A4 紙，可直接下載 PNG，或按「列印公告」印出／另存 PDF。
同一週要貼好幾間教室時，可以開多張草稿並排編輯，彼此獨立、隨時切換。

**執行方式：雙擊 `index.html`。** 沒有 build step、沒有 npm、沒有 server、沒有後端，也不需要網路。任何要求使用者跑指令的改動都違反這個專案的核心前提，請不要引入。

---

## 2. 檔案結構

```
課程異動公告產生器/
├── .github/workflows/pages.yml   # 推送 main 後自動部署 GitHub Pages
├── fonts/       # 自託管 Noto Sans/Serif TC、離線 PNG 備援資料及 OFL 授權
├── index.html   # 版面骨架 + 兩個 <template>（編輯卡片、預覽項目）
├── style.css    # 全部樣式：基礎版面 → 密度階梯 → 主題 token → 列印
├── script.js    # 單一 IIFE，無框架、無模組、無依賴
├── README.md    # 本文
└── CODEX_A4_課程異動公告工具規格.md   # 原始需求規格（歷史文件）
```

程式碼就 `index.html` / `style.css` / `script.js` 這三個檔案，其餘兩個是文件。`index.html` 內以 `?v=` query 做 cache busting，**改完 CSS/JS 記得把兩處版本字串一起更新**，否則使用者的瀏覽器可能吃到舊快取。

### index.html 的兩個 `<template>` 與三個 `<datalist>`

DOM 不是用字串拼出來的，是 clone `<template>` 再填值。要改結構請改 template，不要在 JS 裡塞 `innerHTML`。

| id | 用途 | 由誰複製 |
| --- | --- | --- |
| `#notice-editor-template` | 左側一張「第 N 則公告」編輯卡 | `renderEditors()` |
| `#preview-notice-template` | 右側 A4 紙上的一則公告 | `renderPreview()` |

三個 `<datalist>`（`#history-classrooms` / `#history-courses` / `#history-teachers`）是輸入記憶的容器，內容由 `renderHistory()` 依 `state.history` 填入，見第 9 節。

---

## 3. 資料模型

單一 `state` 物件，存在 `localStorage`，key 為 `course-notice-tool.v2`。

```js
{
  theme: "classic" | "friendly" | "geometric" | "contemporary" | "official" | "newsprint" | "frontier",
  appearanceOpen: true,                     // 「紙張與風格」是否展開（全域 UI 偏好）
  activeSheetId: "sheet-xxx",              // 目前正在編輯哪一張
  sheets: [                                // 1–8 張草稿，每張是一張獨立的 A4 公告
    {
      id: "sheet-<timestamp>-<rand>",
      classroom: "R212",                   // 最多 18 字，同時也是分頁標籤
      footer: "※ 遠距課程依授課老師公告為準",  // 最多 80 字，可留空（留空則 footer 不顯示）
      orientation: "landscape" | "portrait",
      template: "standard" | "large" | "compact",
      backgroundEnabled: true,                 // 是否顯示主題背景裝飾
      notices: [                           // 1–6 則
        {
          id: "notice-<timestamp>-<rand>",
          date: "9/7（一）、9/14（一）",      // 純字串，不是日期物件，刻意不做日期解析
          level: "" | "bachelor" | "master", // 未分類／學士班／碩士班
          course: "視覺互動程式設計",
          teacher: "王連晟",
          status: "cancelled" | "normal" | "rescheduled" | "relocated" | "general",
          target: "R106",                   // 「改到哪」，只有部分狀態用得到，見 STATUS_TARGETS
          note: ""                          // 選填
        }
      ]
    }
  ],
  history: {                               // 輸入記憶，供 datalist 自動補完
    classrooms: [], courses: [], teachers: []   // 各最多 20 筆，最近使用的在前面
  }
}
```

幾個必須知道的規則：

- **`theme` 是全域的，不隨草稿切換。** 它是工具的視覺偏好，不是某一張公告的屬性。
  紙張方向、排版與背景開關則是**每張各自**的，因為不同教室的公告則數可能不同。
- `appearanceOpen` 也是全域 UI 偏好，只控制左側「紙張與風格」是否展開，不影響公告內容、匯出檔或列印結果。
- **`sanitizeState()` 是唯一入口。** 從 localStorage 讀進來的東西一律先過它：型別檢查、長度截斷、列舉值白名單、至少保留一張草稿與一則公告。**新增任何欄位或列舉值，一定要同步改這裡**，否則舊資料還原時會被靜默丟掉。
- **所有讀寫都經過 `activeSheet()`**，不要直接摸 `state.sheets[0]`。
- `date` 是自由文字。刻意不做日期 picker——實務上老師給的日期常常是「9/7（一）、9/14（一）」這種複合寫法。
- `level` 是課程分類。空字串代表「未分類」，預覽不顯示標籤；`bachelor` / `master` 分別顯示「學士班」／「碩士班」。舊 v2 資料沒有這個欄位時，`sanitizeNotice()` 會安全補成空字串，不會把既有課程誤標成學士班。
- `status` 只能從固定五種選，使用者不能自訂（原規格第 7 節的要求，維持）。
- `target` 是「改到哪」的補充資訊。**哪些狀態需要它，由 `STATUS_TARGETS` 這張表決定**，不是寫死在 render 裡。目前是 `relocated`（改至教室）與 `rescheduled`（改至時間）。
  切到不需要補充的狀態時**只隱藏欄位、不清空值**（使用者切回來時值還在），而 `renderPreview()` 只在該狀態有設定時才印出來，所以隱藏的值不會意外出現在公告上。
- **v1 → v2 自動搬移**：`migrateLegacy()` 會把舊版的單張公告包成 v2 的第一張草稿，舊的 `.v1` key **保留不動**當備份。開檔時一定會寫一次 v2，不必等使用者先動一下。
- 版本前綴：如果哪天資料形狀又不相容，請改成 `.v3` 並照 `migrateLegacy()` 的模式加搬移邏輯，不要沉默地讓舊資料壞掉。

---

## 4. 渲染流程

```
使用者輸入 / 切換選項
      │
      ├─► 更新 state（就地修改）
      │
      ├─► renderSheetTabs()    草稿分頁列（教室名稱就是分頁標籤）
      │
      ├─► renderEditors()      只有「新增 / 刪除」時才呼叫（會重建左欄 DOM）
      │
      ├─► renderPreview()      每次輸入都呼叫，重建右側 A4 內容
      │        │
      │        └─► requestAnimationFrame ─► fitSheet()          量測式自動縮字
      │                                  └─► updatePreviewScale() 把整張紙縮到看得到
      │
      └─► persistState()       120ms debounce 後寫入 localStorage，並更新「已自動儲存」
```

三個容易混淆的「縮放」，**完全不同層次，不要搞混**：

| 變數 | 屬於 | 意義 | 影響列印嗎 |
| --- | --- | --- | --- |
| `--preview-scale` | `:root` | 把 1122×794px 的紙 **視覺上** 縮到預覽區塞得下，用 CSS `transform: scale()` | **不影響**。transform 不改變版面計算，列印時強制設為 1 |
| `--fit-scale` | `#notice-sheet` | 公告區內容太多時把 **字級與間距** 等比調小 | 影響。這是「不讓文字爆出 A4」的機制 |
| `--head-scale` | `#notice-sheet` | 教室名稱太長時把 **教室字級** 調小，目標是維持單行 | 影響。避免報頭折成兩行、吃掉下方空間 |

---

## 5. CSS 的四層結構

`style.css` 由上而下是四層，改東西前先確認自己要動哪一層：

### 第 1 層：基礎版面（約 1–400 行）
編輯區、預覽區、紙張、公告項目的骨架與預設外觀。這一層**幾乎所有顏色與造型都走 CSS 變數**，直接寫死色碼前請先確認是不是該加一個 token。

### 第 2 層：密度階梯（`.template-*` / `.count-N`）
一整組排版變數，依「模板」與「公告則數」切換。這是版面尺寸的**唯一真相來源**：

```css
.notice-sheet          { --notice-date-size: 40px; --notice-course-size: 29px; ... }
.notice-sheet.template-large   { --notice-date-size: 48px; ... }
.notice-sheet.template-compact { --notice-date-size: 28px; ... }
.notice-sheet.count-1 { --notice-date-size: 52px; --notice-course-size: 38px; ... }
.notice-sheet.count-3, .count-4 { --notice-date-size: 31px; ... }
.notice-sheet.count-5, .count-6 { --notice-date-size: 24px; ... }
.notice-sheet.orientation-portrait.count-5 { ... }   /* 直式再收一次 */
```

**要調整某個密度下的字級，改這裡的變數就好**，不要再去下面加 `.count-5 .notice-course { font-size: ... }` 之類的個別覆寫——那正是這次重構要消滅的東西。

### 第 3 層：主題 token（見第 6 節）

### 第 4 層：響應式與列印（見第 8 節）

---

## 6. 主題系統

七個主題：`classic`（預設）、`friendly`、`geometric`、`contemporary`、`official`、`newsprint`、`frontier`（前線工業）。

前線工業參考[《明日方舟：終末地》官方資訊頁](https://endfield.gryphline.com/zh-tw#information)的黑黃色彩及工業標示。切角報頭與警示線由 CSS 繪製，黑白漸淡的地形等高線與教室浮水印跟隨草稿的背景開關。等高線以內嵌 SVG 繪製，離線預覽及 PNG 匯出不需外部圖片。

### 兩層 token

1. **第一層**（原本就有）：語意色票 —— `--ui-*`（編輯器介面）、`--paper-*`（紙張）、`--accent`、`--radius-*`。
2. **第二層**（本次新增）：造型 token —— 陰影、框線、圓角、角標文字、顯示字體、狀態標籤形狀等等。

**兩層都宣告在 `body` 上，不是 `:root`。這一點不能改。**
原因：`var()` 是在「宣告所在的元素」上求值的。若把 `--sheet-accent-bg: var(--paper-accent)` 寫在 `:root`，它會鎖定 `:root` 的 `--paper-accent`，主題在 `body` 上換色就完全吃不到。（重構過程中真的踩過這個坑，主題色一律變回預設藍。）

### 新增一個主題的四個步驟

1. `index.html` 的 `.theme-options` 內複製一組 `<label class="theme-option" data-theme-option="新名稱">`。
2. `script.js` 的 `sanitizeState()` 把新名稱加進 `theme` 白名單陣列。
3. `style.css` 主題層加一個 `body[data-theme="新名稱"] { ... }`，**只宣告變數**。
4. `style.css` 加色票小方塊：`.theme-option[data-theme-option="新名稱"] .theme-swatch i:nth-child(1|2|3)`。

只有真的無法用變數表達的造型（額外裝飾線、編號欄、偽元素）才寫成該主題的「結構性補充」，並控制在數行內。

### 第二層 token 速查

| 群組 | Token | 說明 |
| --- | --- | --- |
| 編輯區 | `--editor-shadow` `--editor-header-pad-top` | 面板陰影、標題區上留白 |
| | `--editor-badge` `--editor-badge-top/-color/-font/-size/-tracking` | 右上角英文角標。預設 `none` 即不顯示；設成字串才出現 |
| | `--heading-rule` | 區塊標題右側那條延伸線（friendly 用虛線漸層） |
| | `--field-radius` `--swatch-radius` `--choice-border` | 表單與選項卡外觀 |
| | `--choice-checked-ring` `--template-checked-ring` `--choice-checked-shadow` `--choice-checked-transform` | 選中狀態的內框、外框與位移（geometric 用硬陰影取代內框） |
| | `--editor-card-border/-rail/-rail-alt/-shadow` `--editor-num-color` | 左欄公告卡片 |
| | `--delete-color` `--delete-hover-bg` `--button-*` `--save-status-color` | 按鈕與狀態文字 |
| 預覽區 | `--preview-bg` `--preview-bg-image` | 預覽底色（contemporary 用雙層 radial gradient） |
| 紙張 | `--sheet-border` `--sheet-shadow` | 紙張本體 |
| | `--sheet-header-rule` | 報頭下方主線（`3px solid` / `7px double` …） |
| | `--sheet-accent-display/-width/-height/-bottom/-bg` | 報頭下方的重點色條；newsprint 設 `display:none` 關掉 |
| | `--display-font` `--classroom-font` `--title-font` | 顯示字體。`--classroom-font` 與 `--title-font` 預設繼承 `--display-font` |
| | `--classroom-color` `--classroom-tracking` `--sheet-title-color` `--title-tracking` `--sheet-subtitle-color` | 報頭字樣 |
| | `--notice-rule` `--date-color` | 每一則的分隔線與日期色 |
| | `--status-border` `--status-radius` `--status-shadow` | 狀態標籤造型 |
| | `--meta-label-color` `--footer-rule` `--footer-color` | 授課／備註標籤、頁尾 |

---

## 7. 自動縮字（`fitSheet()`）

量測式縮字有兩個獨立的旋鈕：`--fit-scale` 管公告區，`--head-scale` 管教室名稱。

### 7.1 公告區：`--fit-scale`

- **舊作法**：用字元數猜。`course.length > 24` 就套 0.86 倍、`> 42` 套 0.74 倍。中英混排、全形標點、不同主題的字體寬度都會讓它誤判——該縮的沒縮，不必縮的被縮小。
- **新作法**：量。`--fit-scale` 從 1 開始，依 `[1, .96, .92, ... , .6]` 逐級調小，每調一級就實際量一次 `.sheet-notices` 有沒有垂直溢出，一塞得下就停手。

```js
const FIT_STEPS = [1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6];
```

CSS 端：所有字級與垂直間距都寫成 `calc(var(--notice-xxx-size) * var(--fit-scale))`。
換句話說，**縮字只有這一個旋鈕**。要調整縮放行為，改 `FIT_STEPS` 的階梯或下限即可，不必碰任何個別選擇器。

第二關：極少數情況下單一則的內容仍超出自己的框（例如超長備註），會針對那一則再多降一級，避免被 `overflow: hidden` 裁掉。

實際結果（`--fit-scale` 最終值）：

| 情境 | fit |
| --- | --- |
| 預設 2 則、標準排版 | 1.00 |
| 6 則、緊湊排版 | 1.00 |
| 6 則 + 超長課名 + 長備註 | 1.00 |
| 2 則 + 醒目大字 + 超長課名 + 長備註 | 0.92 |

也就是說，多數情況根本不縮（比舊版更大更好讀），只在真的塞不下時才動手。

### 7.2 教室名稱：`--head-scale`

`.sheet-classroom` 是整張公告最大的字（橫式 104px）。填「綜合教學大樓R212實驗室甲」這種長名字時它會折成兩行，報頭高度從 105px 暴增到 196px，吃掉將近三分之一的版面，字也幾乎撞上右邊的「課程異動公告」。

`fitHeader()` 用同樣的量測手法解決：從 `HEAD_STEPS = [1, .92, .84, .76, .68, .6, .54, .48]` 逐級調小，每級比對元素高度與 `line-height`，**一到單行就停手**。

```
「綜合教學大樓R212實驗室甲」橫式：104px → 56px（0.54），單行，報頭 196px → 93px
```

`fitHeader()` 在 `fitSheet()` 內、公告區量測**之前**呼叫——報頭高度會決定公告區剩多少空間，順序不能反。

下限 0.48 是刻意的：再往下縮，教室字級就會小於日期，違反原規格第 9 節「教室 > 日期 > 狀態」的資訊層級。極端長的名字在直式下仍可能是兩行，那是可接受的取捨——**寧可兩行也不要讓教室不再是最醒目的元素**。

### 7.3 兩者共同

`document.fonts.ready` 後會再跑一次 `fitSheet()`——字體換掉後字寬會變，不重算會出現「載入完才溢出」。

`--classroom-size` 也已經納入第 5 節的密度階梯（`.template-large` 116px、`.template-compact` 84px、直式 84px……），最終字級是 `calc(var(--classroom-size) * var(--head-scale))`。

---

## 8. 列印

列印是這個工具的最終產物，**任何改動都以「列印可靠」為第一優先**（原規格第 28 節的優先序，維持）。

機制：

- 具名分頁 `@page notice-landscape { size: A4 landscape; margin: 0 }` 與對應的 portrait。
- JS 依方向動態設定 `--print-width` / `--print-height`（`297mm×210mm` 或 `210mm×297mm`），`html`、`body`、`.notice-sheet` 全部吃這兩個變數。
- `body[data-orientation]` 決定套用哪個具名 page。
- `@media print` 內把編輯區、工具列、提示文字 `display: none`，並清掉 `transform`。
- `print-color-adjust: exact` 保留底色與狀態標籤顏色。
- `break-inside: avoid` / `break-after: avoid` 避免產生第二頁。
- 未填欄位的佔位字（「課程名稱」「日期待定」）在列印時 `visibility: hidden`，不會印出去。

已驗證：橫式與直式各輸出 **1 頁**，紙張尺寸 297.0 × 209.9 mm / 209.9 × 297.0 mm。

使用者端仍需自行關閉瀏覽器的頁首頁尾、縮放設為 100%——頁面底部的 `.print-tip` 已寫明。

---

## 9. 工作流功能

六個為了「每週貼公告」這個實際情境加的功能，都刻意做得很輕：

### 9.1 多張草稿（`state.sheets`）

同一週常常要同時貼 R106、R209、R212。編輯區最上方的分頁列一張一個分頁，**分頁標籤直接用教室名稱**（空的話顯示「未命名 N」），最多 8 張。

- 切換分頁 = 換 `state.activeSheetId`，然後整個 `renderAll()`。
- 新增一張會沿用目前這張的**頁尾與紙張方向**（同一批公告通常設定一樣），其餘留空。
- **列印永遠只輸出目前這一張。** 提示文字就寫在分頁列下方，不要拿掉。
- 刪除草稿破壞性大，用 `confirm()`；只剩一張時按鈕 disabled。

### 9.2 輸入記憶（`state.history`）

課名與老師姓名每週幾乎重複，用原生 `<datalist>` 提供補完，零依賴。

- 只在 **`change`（失焦）** 時收集，不在 `input` 時收集——否則打到一半的半截字會被記進去。
- 最近使用的排前面，去重，各欄最多 20 筆。
- 「清空全部」**不會**清掉輸入記憶（那不是公告內容，重打很煩）。

### 9.3 狀態補充欄位（`STATUS_TARGETS`）

「教室異動」光講狀態沒有用，一定要說改到哪間；「時間調整」同理。以前只能塞進備註，資訊層級不對——那是整則公告最該被看到的一句話。

現在 `STATUS_TARGETS` 這張表決定哪些狀態要多一個欄位：

```js
const STATUS_TARGETS = {
  relocated:   { label: "改至教室", placeholder: "例如 R106", prefix: "改至", list: "history-classrooms" },
  rescheduled: { label: "改至時間", placeholder: "例如 10/17（五）14:00", prefix: "改至", list: "" }
};
```

- **要讓某個狀態多一個補充欄位，就往這張表加一列**，編輯區與預覽會自動跟上；不需要的狀態不要列進來，欄位就自動隱藏。
- `list` 指到某個 `<datalist>` 的 id 就能接上輸入記憶（改至教室直接吃教室的歷史值）。
- 印在公告上的位置是**狀態標籤正下方**，字級是狀態的 0.6 倍：它比課名次要，但比備註重要得多，貼在門口要能一眼看到。
- 注意 `.field-group` 是 `display: flex`，會蓋掉 `hidden` 屬性，所以另外寫了 `.field-group[hidden] { display: none }`。條件欄位都會踩到這個。

### 9.4 刪除復原（`undoState`）

單則刪除是高頻操作，用 `confirm()` 擋會很煩，所以改成刪完在動作列顯示「已刪除第 N 則公告 · 復原」，8 秒後自動消失。

- 復原會把項目**插回原本的位置**，不是接到最後面。
- 提示列放在**固定的 `.editor-actions` 裡**，不是可捲動的編輯區——放在編輯區底部的話，刪完就被捲出視野，等於沒有。
- 切換草稿、新增項目都會 `hideUndo()`，避免復原到錯的地方。

### 9.5 匯出／匯入備份

`localStorage` 只活在單一瀏覽器，換電腦、清快取、無痕視窗都會消失。所以提供一個純 JSON 的備份檔進出——沒有雲端、沒有帳號，就是一個檔案。

檔案格式：

```json
{
  "format": "course-notice-tool",
  "version": 2,
  "exportedAt": "2026-08-26T…",
  "sheets": [ … ],
  "history": { … }
}
```

幾個刻意的決定：

- **匯入一律是「附加」，永遠不覆蓋現有草稿。** 匯入不可逆，讓它永遠不破壞既有內容，比跳一個「要取代還是附加？」的確認框好懂得多。要清空的人自己按「清空全部」再匯入。
- **匯入的草稿一律重新配 id。** 備份檔和現有草稿撞號的話，切換分頁會跳到錯的那張。
- **主題不隨檔案走**（那是這台電腦的偏好），**輸入記憶會合併**（本機的排前面，去重後仍受 20 筆上限）。
- 超過 `MAX_SHEETS` 時只匯入塞得下的，並明講少匯了幾張——不要靜默截斷。
- 匯入時也接受直接把 localStorage 內容存成的檔案（只認 `sheets` 陣列），對手動備份的人比較寬容。
- **匯出檔名刻意用純英數** `course-notice-backup-YYYY-MM-DD.json`。實測 Chromium 對 blob 下載的中文 `download` 檔名會整個丟掉，存出來是一個叫「download」的無副檔名檔案。這是備份檔，正確好認比名字好看重要——**不要改回中文**。
- `<a download>` 一定要真的掛進 DOM 再 `click()`，部分瀏覽器對沒進過文件的 `<a>` 會忽略 `download` 屬性。

### 9.6 課程分類（`notice.level`）

每則公告可選「未分類／學士班／碩士班」。選擇學士班或碩士班後，預覽會在課程名稱前顯示方框分類字標；未分類不顯示，讓舊公告維持原來外觀。

- 編輯器使用原生 `<select>`，鍵盤與螢幕閱讀器可直接操作。
- 合法值集中在 `COURSE_LEVEL_LABELS`；`sanitizeNotice()` 以這張表做白名單檢查。
- 分類屬於每一則公告，會跟著草稿儲存、刪除復原及 JSON 匯出／匯入。
- 分類採直角實心方框字標，文字固定白色；學士班使用 `--level-bachelor-bg`，碩士班使用 `--level-master-bg`。各主題配置一組雙色，黑白報刊以黑／深灰區分。方框高度與課名第一行行高一致，內部文字縮為課名的 58% 並垂直置中。
- 舊 v1／v2 資料一律補成「未分類」，不需要提升 localStorage 主版本。

### 9.7 背景裝飾（`sheet.backgroundEnabled`）

每張草稿可獨立開關背景裝飾，預設開啟。背景以目前教室名稱作為大型淡浮水印，各主題有自己的紋理。

- 1 則使用 9% 不透明度、2 則 6.5%、3／4 則 3.8%、5／6 則 1.8%，公告越密集越不干擾文字。
- 關閉時，`.background-off .sheet-background-art` 直接 `display: none`，預覽與列印都不輸出裝飾。
- 舊資料缺少 `backgroundEnabled` 時，`sanitizeSheet()` 會補成 `true`；新草稿沿用目前草稿的背景偏好。
- 背景元素使用 `aria-hidden="true"` 且不接收滑鼠事件，不影響閱讀順序與操作。

### 9.8 紙張與風格收合（`state.appearanceOpen`）

紙張方向、文字排版、視覺風格與背景開關放在原生 `<details>` 中。收合時仍顯示「直式・醒目大字・校務公文・背景關閉」這類即時摘要，使用者不必重新展開確認設定。

- 使用原生 `<summary>`，可用滑鼠、Enter 與 Space 操作，不自行模擬 disclosure widget。
- 收合狀態存在 v2 state，reload 後保留；舊資料沒有此欄位時預設展開。
- `updateAppearanceSummary()` 集中產生摘要，方向、排版、主題或背景變動後都走同一處更新。
- 此偏好不放入草稿匯出檔，匯入其他電腦時沿用當地介面狀態。

### 9.9 下載 PNG 圖片

底部「下載圖片」會把目前草稿輸出成不透明白底 PNG；橫式為 **2245 × 1587 px**，直式為 **1587 × 2245 px**（約 192 dpi）。未填欄位的佔位文字和列印時一樣不會出現在圖片中。

- 不使用 CDN 或第三方截圖套件，雙擊 `index.html` 的離線模式也能運作。
- `file://` 頁面不能可靠讀取外部 stylesheet 的 `cssRules`，所以 `createStyledExportClone()` 會把預覽節點的 computed style 寫入副本，偽元素則另產生限定規則，再以 SVG foreignObject + Canvas 輸出 PNG。
- SVG 必須用 data URL 載入；在 Chromium 的本機檔案模式若使用 Blob URL，Canvas 會被標為 tainted 而拒絕 `toBlob()`。
- 按鈕產生圖片時會 disabled 並顯示「產生中…」，成功與錯誤都透過既有的 `#io-message` status 區域回報。

### 9.10 線上版本（GitHub Pages）

專案仍是原樣的三個靜態檔案，不需要 build、後端或環境變數。`.github/workflows/pages.yml` 在每次推送 `main` 時先做基本完整性檢查，只把 `index.html`、`style.css`、`script.js` 與 `.nojekyll` 放入部署 artifact，避免把備份資料與維護文件公開到網站路徑。

使用者輸入只存在該瀏覽器的 `localStorage`；網站本身不會上傳課程內容。換瀏覽器或裝置仍需使用 JSON 備份搬移資料。

### 9.11 公告拖拉排序

每張編輯卡左上角有「拖曳」把手，可用滑鼠或觸控拖動調整順序。放開後才把 DOM 順序寫回目前草稿的 `notices` 陣列並重繪預覽，因此新順序會跟著 localStorage、JSON 備份、PNG 與列印結果保留。

- 拖曳使用 Pointer Events，同一套邏輯同時處理滑鼠、觸控筆與觸控螢幕。
- 卡片換位會讓瀏覽器釋放原元素的 pointer capture，因此 `pointermove`／`pointerup` 監聽設在 `document`，不要改回只綁在把手上。
- 拖到編輯區上下邊緣時會自動捲動；窄螢幕捲動整個頁面，桌面版捲動左側編輯區。
- 把手聚焦時可按 `ArrowUp`／`ArrowDown` 排序，移動後焦點留在同一則公告，`#reorder-status` 會朗讀新位置。
- 只有一則公告時把手 disabled；手機版仍保留 44 × 44 px 點擊範圍，只隱藏「拖曳」文字。

### 9.12 自託管中文字體

介面與大多數公告主題固定使用 `Course Notice Sans`（Noto Sans TC variable 100–900），校務公文與黑白報刊的展示字固定使用 `Course Notice Serif`（Noto Serif TC variable 200–900）。兩套字體均來自 Google Fonts 官方儲存庫並以 OFL 授權隨專案發布。

- WOFF2 分別約 5.4 MB／7.7 MB；啟動時只載入無襯線字體，襯線字體只在相應主題實際使用時載入。
- `font-display: swap` 保持頁面可操作；字體完成載入後 `loadingdone` 會重新執行 `fitSheet()`，避免字寬變化造成溢出。
- 列印與 PNG 匯出會先呼叫 `waitForCurrentFonts()`，不在字體仍載入時產生最終檔案。
- PNG 的 SVG 是獨立 data URL，無法直接沿用頁面的 web font。線上模式由 `fetch()` 讀 WOFF2 並轉成 data URL；`file://` 模式則延遲載入 `sans.data.js`／`serif.data.js` 的 Base64 備援。
- 只保留兩套完整繁中字集，不做靜態文字 subset，避免使用者輸入罕見課名、人名或教室名稱時缺字。

---

## 10. 無障礙

已做到、請勿在改動中弄壞：

- 每個 input 都有對應 `<label>`，`renderEditors()` 會動態綁 `htmlFor`（id 用 `欄位-公告id` 組成，確保唯一）。
- 狀態**同時有文字與顏色**，顏色不是唯一辨識方式。
- `aria-live` 用在則數、排版提示、儲存狀態上。
- 刪除鈕有 `aria-label`（「刪除第 N 則公告」），只剩一則時 disabled。
- Radio 是視覺隱藏（1px / opacity 0）不是 `display:none`，鍵盤仍可操作，`:focus-visible` 有明確外框。
- 草稿分頁是一般 `<button>` 搭 `aria-pressed`，不是 `role="tablist"`——沒有實作方向鍵漫遊，就不要宣告成 tablist 讓螢幕閱讀器誤導使用者。
- 復原提示列是 `role="status"`，刪除後會被朗讀。
  - 附帶提醒：寫自動化測試時 `page.check()` 需要 `{ force: true }`，因為可見的是旁邊的 `<span>`。

---

## 11. 刻意不做的事

以下是**已經評估過、決定不做**的，除非需求改變，不要主動加：

- 帳號、登入、後端、資料庫、雲端同步（備份靠第 9.5 節的 JSON 檔，不要換成雲端）。
- 自由拖拉排版（不是 Canva）。
- 日期解析／行事曆整合。
- PDF library（瀏覽器列印另存 PDF 已足夠）。
- 超過 6 則時自動產生第二頁——目前只顯示「建議拆成第二張公告」的提示。這是原規格第 13 節明確的第一版範圍。

---

## 12. 已知限制

- **單張上限 6 則、草稿上限 8 張。** 超過只有文字提示，沒有自動分頁。
- **`localStorage` 只存在單一瀏覽器單一裝置。** 換電腦、清快取、無痕視窗都會回到預設值。備份請用第 9.5 節的匯出／匯入，那是唯一的搬運方式（沒有自動備份，要記得手動匯出）。
- **列印一次只出一張。** 8 張草稿要印 8 次。沒有「全部列印」。
- **首次載入需要下載中文字體。** 無襯線 WOFF2 約 5.4 MB；第一次切到校務公文／黑白報刊時另載入約 7.7 MB 的襯線字體。之後由瀏覽器快取；離線雙擊版本直接從本機讀取。
- **`--fit-scale` 下限 0.6。** 內容極端多時會停在 0.6 而不再縮，此時仍可能溢出——這是刻意的，因為再縮下去已經不能貼在門口讀了。正確解法是拆成兩張公告。
- **`--head-scale` 下限 0.48。** 極長的教室名在直式下仍可能是兩行，理由見第 7.2 節。

---

## 13. 常見修改任務對照表

| 想做的事 | 動哪裡 |
| --- | --- |
| 改某個密度下的字級／間距 | `style.css` 第 2 層的 `.template-*` / `.count-N` 變數區塊 |
| 加一種狀態（例如「補課」） | `script.js` 的 `STATUS_LABELS` + `index.html` 的 `<select>` + `style.css` 的 `.status-*` 色（`sanitizeNotice()` 是查 `STATUS_LABELS`，不必另外改白名單） |
| 讓某個狀態多一個「改到哪」欄位 | `script.js` 的 `STATUS_TARGETS` 加一列，其餘自動 |
| 加一個視覺主題 | 見第 6 節四步驟 |
| 改角標文字 | 該主題的 `--editor-badge` |
| 調整公告區縮字的積極程度 | `script.js` 的 `FIT_STEPS` |
| 調整教室名稱縮字的下限 | `script.js` 的 `HEAD_STEPS`（下限的取捨見第 7.2 節） |
| 改草稿上限 8 張 | `script.js` 的 `MAX_SHEETS` |
| 改復原提示的秒數 | `script.js` 的 `UNDO_TIMEOUT` |
| 改輸入記憶的筆數 | `script.js` 的 `HISTORY_LIMIT` |
| 改列印邊界／紙張 | `style.css` 底部 `@page` 與 `@media print`，以及 `renderPreview()` 內設定 `--print-width/height` 的兩行 |
| 加一個編輯欄位 | `index.html` 的兩個 template + `renderEditors()` + `renderPreview()` + `SAMPLE_SHEET` + `sanitizeNotice()`（五個地方，缺一不可） |
| 改單張上限 6 則 | `script.js` 的 `MAX_NOTICES`，並確認 `style.css` 有對應的 `.count-N` 階梯 |
| 改資料形狀 | 一定要同時加 `migrateLegacy()` 式的搬移，見第 3 節 |

---

## 14. 測試方式

沒有測試框架（也不該為了測試引入 build step），但改完請至少手動走一遍。若手邊有 Node，用 Playwright 跑無頭 Chromium 做回歸很有效，本次改版就是這樣驗的：

1. **溢出掃描**：6 主題 × 2 方向 × 3 模板 × 1–6 則 × 3 種內容長度 = 648 組，逐一量 `scrollHeight - clientHeight`。目標是 **0 溢出**。
2. **截圖回歸**：改動前後各截一輪（每主題的紙張 + 編輯區），逐張做像素差異比對。預期只有你**刻意改變**的那幾張會有差異；其餘應完全相同。
3. **列印驗證**：`page.pdf({ preferCSSPageSize: true })` 輸出，檢查頁數 = 1、尺寸 = A4。
4. **互動與 console**：走一遍新增 / 刪除 / 切主題 / 切方向 / 清空 / reload，確認 console 無 error、reload 後資料一致。
5. **資料層**：塞一份 v1 舊資料再開檔，確認自動搬移成 v2；草稿切換後內容不互相污染；刪除復原插回原位；`change` 後歷史值有進 `datalist`。
6. **匯出／匯入**：匯出後立刻匯入，確認張數翻倍、id 不重複、檔名有副檔名；再測超上限、壞 JSON、空 `sheets` 三種失敗路徑都有提示而不是靜默失敗。
7. **長內容壓力**：長教室名 × 直橫式 × 1–6 則，確認教室維持單行、報頭沒被撐高、整張不溢出。

手動驗收清單（沿用原規格第 26 節）：

- [ ] 教室、日期、課程、老師、狀態、頁尾都可修改，預覽即時更新
- [ ] 課程分類可選未分類／學士班／碩士班，分類標籤出現在課名之前，reload 後仍保留
- [ ] 新增 / 刪除正常，最多 6 則，達上限有提示且按鈕 disabled
- [ ] 三種模板都正常；則數變多時會自動降級並顯示原因
- [ ] 超長中文課名、超長日期、長備註都不 overflow、不被裁切
- [ ] Reload 後資料仍在；清空有 `confirm()` 且清得乾淨
- [ ] 列印：A4、正確方向、只印公告、背景色保留、沒有第二頁
- [ ] 小螢幕可正常編輯，預覽會等比縮小，無頁面級橫向捲動
- [ ] 多張草稿互不干擾，切換後內容正確，列印只出目前這張
- [ ] 長教室名會自動縮到單行，報頭不會被撐高
- [ ] 刪除單則後復原提示看得到（不必捲動），按下去插回原位
- [ ] 課名／老師打過一次後，下次輸入有補完選單
- [ ] 狀態切到「教室異動／時間調整」時出現「改至」欄位，切走會收起來且值不遺失
- [ ] 匯出的檔案能再匯入回來，且是附加不是覆蓋
- [ ] 下載圖片：橫式 2245 × 1587、直式 1587 × 2245，白底、不含佔位字，版面與預覽一致
- [ ] 排序：滑鼠、觸控及鍵盤方向鍵都可移動；預覽立即同步，reload 後順序保留；單則時把手 disabled

---

## 15. 與原規格的差異

實作在多處**刻意超出**原規格，屬於已接受的擴充：

| 項目 | 原規格 | 現況 |
| --- | --- | --- |
| 紙張方向 | 只要求 A4 橫式 | 橫式 / 直式可切換 |
| 視覺主題 | 未提及 | 6 種主題 |
| 自動縮字 | 「合理縮字、動態 font-size」 | 量測式 `--fit-scale` / `--head-scale`，不是字數猜測 |
| 公告張數 | 一次一張 | 可存 8 張草稿並切換（列印仍是一次一張） |
| 輸入輔助 | 未提及 | 教室／課程／老師的歷史值補完 |
| 狀態補充資訊 | 只有「備註（optional）」 | 教室異動／時間調整多一個「改至」欄位，印在狀態下方 |
| 課程分類 | 未提及 | 每則可標示學士班／碩士班；舊資料維持未分類 |
| 備份 | 未提及 | JSON 匯出／匯入 |

其餘（狀態五種、三模板、單張 6 則上限、localStorage、列印方式、離線可用、無 build step）皆與原規格一致。

---

## 16. 改版紀錄

1. **修掉「清空全部」的重複寫入。**
   原本先 `localStorage.removeItem()` 又立刻 `persistState()` 把空狀態寫回去，等於白刪一次。現在只寫一次。

2. **自動縮字改成量測式。**
   移除 `long-date` / `long-course` / `very-long-course` / `long-note` 四個以字元數判斷的 class 及其 CSS 乘數，改為單一 `--fit-scale` + `fitSheet()` 實測迴圈。詳見第 7 節。
   *影響：* 一般內容不再被無謂縮小（同樣的長課名，新版字更大且仍然塞得下）；極端內容才縮，且保證不溢出。

3. **主題 CSS 重構成 token。**
   主題層的元素覆寫選擇器從 **117 條降到 30 條**，各主題現在幾乎只宣告變數。新增第二層造型 token（見第 6 節表格），並全部宣告在 `body` 而非 `:root`。

4. **順手修掉兩個重構中發現的既有問題：**
   - `geometric` 主題下，選項卡被選中時的藍色外框會被主題的灰色邊框蓋掉（兩條規則 specificity 相同，主題那條在後面），導致選取狀態不明顯。現在選中狀態正常顯示。
   - `.template-compact .sheet-header { border-bottom-width: 3px }` 是多餘宣告（基礎值本來就是 3px），卻會壓掉主題設定的報頭主線寬度。已移除。

5. **`?v=` cache busting 更新為 `20260826-tokens-fit-1`。**

驗證結果：648 組內容組合 **0 溢出**；36 張截圖回歸中 **29 張像素完全相同**，其餘 7 張的差異都對應上述刻意的行為改變；列印輸出橫直式各 1 頁、尺寸正確；console 無錯誤。

### 第二次改版（2026-08-26）

1. **修掉長教室名撐爆報頭。**
   `.sheet-classroom` 原本是各處寫死的 `font-size`，且不受任何縮字管。18 字上限的教室名會折成兩行、報頭從 105px 撐到 196px。
   現在教室字級納入密度階梯變數 `--classroom-size`，再乘上量測得到的 `--head-scale`。詳見第 7.2 節。

2. **多張公告草稿。**
   `localStorage` 升到 `course-notice-tool.v2`（`sheets` 陣列 + `activeSheetId`），含 v1 自動搬移。編輯區最上方新增分頁列，最多 8 張。詳見第 9.1 節。

3. **教室／課程／老師的輸入記憶。**
   原生 `<datalist>`，`change` 時收集，各欄最多 20 筆。詳見第 9.2 節。

4. **單則刪除改成可復原。**
   不用 `confirm()` 擋高頻操作，改成刪完在固定動作列顯示 8 秒的復原提示，插回原位。刪除整張草稿仍用 `confirm()`。詳見第 9.3 節。

5. **順手清掉：** 未使用的 `clone()` 函式；`sampleSheet()` 改走 `sanitizeNotice()`，讓存檔的欄位順序在所有路徑上一致（否則 reload 前後 JSON 位元組不同，回歸比對會出現假警報）。

6. **`?v=` cache busting 更新為 `20260826-drafts-1`。**

驗證結果：648 組內容組合 **0 溢出**；**30 張紙張截圖與上一版像素完全相同**（版面輸出零回歸，只有編輯區因為多了分頁列而改變）；4 種列印情境都是 1 頁、尺寸正確；v1→v2 搬移、草稿隔離、刪除復原、輸入記憶、清空全部、reload 一致性全部通過；console 無錯誤。

### 第三次改版（2026-08-26）

1. **「改到哪」的補充欄位。**
   「教室異動」以前只能把新教室塞進備註，資訊層級不對。現在由 `STATUS_TARGETS` 表驅動，`relocated` 與 `rescheduled` 各多一個欄位，印在狀態標籤正下方。詳見第 9.3 節。
   同時修掉一個會咬到所有條件欄位的坑：`.field-group` 是 `display: flex`，會蓋掉 `hidden` 屬性，得另外寫 `.field-group[hidden] { display: none }`。

2. **草稿匯出／匯入。**
   純 JSON 備份檔，匯入一律附加、重新配 id、合併輸入記憶、超過上限會明講少匯了幾張。詳見第 9.5 節。
   匯出檔名用純英數，因為實測 Chromium 會把中文的 `download` 檔名整個丟掉（存出來叫「download」，沒有副檔名）。

3. **`?v=` cache busting 更新為 `20260826-target-io-1`。**

驗證結果：648 組內容組合（已含補充欄位的長短內容）**0 溢出**；**30 張紙張截圖與上一版像素完全相同**；6 則全帶長補充資訊的極端情況仍是 1 頁；匯出→匯入來回、id 不重複、超上限、壞 JSON、空檔案五種路徑都正確；console 無錯誤。

### 第四次改版（2026-08-26）

1. **新增學士班／碩士班課程分類。**
   每則公告新增 `level` 欄位，編輯器可選未分類、學士班或碩士班；選擇分類後，預覽會在課程名稱前顯示標籤。詳見第 9.6 節。

2. **維持 v2 舊資料相容。**
   `sanitizeNotice()` 會把缺少或不合法的 `level` 安全轉成空字串。既有公告不會被誤標，重新載入與 JSON 匯入也不會遺失新欄位。

3. **分類字標納入排版縮放。**
   分類採略微加深的主題色實心方框與白色文字；框高跟課名第一行一致，文字為課名字級的 58% 並垂直置中。六種主題、橫直式及 1／2／4／6 則皆使用同一資料結構。

4. **`?v=` cache busting 更新為 `20260826-course-level-5`。**

驗證結果：舊 v2 資料補值、選擇分類、localStorage 寫入與 reload 還原全部通過；6 主題 × 2 方向 × 4 種公告數量共 **48 組排版 0 溢出**，console 無錯誤。

### 第五次改版（2026-08-26）

1. **新增可開關的主題背景。**
   每張草稿新增 `backgroundEnabled`；背景以教室名稱為淡浮水印，並為六種風格分別配置網格、紙張線、幾何色塊、展演圓環、公文章紋與報刊網點。

2. **依公告密度自動降低背景。**
   1～2 則保留明顯但低對比的識別，3～4 則自動淡化，5～6 則只留下極淡紋理，正文永遠位於較高圖層。

3. **維持舊資料相容。**
   缺少 `backgroundEnabled` 的 v1／v2 草稿會安全補成開啟；切換、草稿切換、匯出／匯入與重新載入都保留設定。

4. **`?v=` cache busting 更新為 `20260826-background-art-1`。**

驗證結果：6 主題 × 2 方向 × 4 種公告數量共 **48 組排版 0 溢出**；背景開關即時生效、reload 保留、舊 v2 資料預設開啟，console 無錯誤。橫式與直式 PDF 都是正確 A4、各 1 頁。

### 第六次改版（2026-08-27）

1. **新增單則主公告版。**
   當草稿只有一則公告時，日期、狀態、課名、教師與備註會自動提升字級；標準、醒目大字及多則緊湊仍各自保留不同尺度。

2. **重組單則視覺中心。**
   日期／狀態與課程資訊收成最大 920px 的置中主視覺群組，橫式與直式分別調整寬度與間距；原本暗示仍有下一則公告的底部分隔線會自動移除。

3. **更新排版提示。**
   一則公告時，編輯器會顯示「已啟用單則主公告版」，並提示仍可選擇醒目大字進一步加強。

4. **`?v=` cache busting 更新為 `20260827-single-hero-1`。**

驗證結果：6 主題 × 2 方向 × 3 種排版共 **36 組單則極端內容 0 溢出**；另測 24 組 2／6 則回歸皆正常，console 無錯誤。橫式與直式 PDF 都是正確 A4、各 1 頁。

### 第七次改版（2026-08-27）

1. **學士班／碩士班改用不同語意色。**
   `renderPreview()` 會依 `notice.level` 加上 `.level-bachelor` 或 `.level-master`；樣式透過 `--level-bachelor-bg`／`--level-master-bg` 取色，不把色碼寫進 JavaScript。

2. **六種主題各有雙色色票。**
   經典藍／紫、手札磚紅／深綠、幾何橘／藍、當代洋紅／青綠、公文暗紅／深藍、報刊黑／深灰。文字維持白色，全部色票對比度至少 4.5:1。

3. **`?v=` cache busting 更新為 `20260827-level-colors-1`。**

驗證結果：6 主題 × 2 方向 × 2 種公告密度共 **24 組排版 0 溢出**；分類 class、雙色差異、白字與對比度全部通過，console 無錯誤。

### 第八次改版（2026-08-27）

1. **新增「紙張與風格」收合卡片。**
   紙張方向、文字排版、六種視覺風格與背景開關可一次收起，課程異動項目能更快出現在左欄可視範圍。

2. **收合時保留設定摘要。**
   `updateAppearanceSummary()` 即時顯示方向、排版、主題與背景狀態；切換草稿或修改任一選項都會同步更新。

3. **保存介面偏好與舊資料相容。**
   `state.appearanceOpen` 記住展開狀態；舊 v2 資料安全預設為展開，清空公告也不重設這項介面偏好。

4. **`?v=` cache busting 更新為 `20260827-collapsible-appearance-1`。**

驗證結果：展開 791px、收合 68px，節省約 **723px** 左欄高度；即時摘要、reload 保存、舊資料預設、鍵盤操作及 390px 手機寬度全部通過，console 無錯誤。

### 第九次改版（2026-09-11）

1. **新增目前公告的 PNG 下載。**
   橫直式分別輸出 2245 × 1587 與 1587 × 2245 px，不透明白底，版面、背景裝飾與主題都和預覽一致。

2. **維持真正離線可用。**
   匯出流程不依賴網路、CDN 或第三方套件，並針對 Chromium 的 `file://` stylesheet 與 tainted Canvas 限制採用 computed style + SVG data URL。

3. **加入 GitHub Pages 自動部署。**
   推送 `main` 後由官方 Pages actions 發布三個網站檔案；部署 artifact 排除本機備份與維護文件。

4. **`?v=` cache busting 更新為 `20260911-image-export-1`。**

驗證結果：離線模式實際下載橫直式 PNG 成功，兩張 alpha 範圍皆為 255（完整白底），像素尺寸正確，console 無錯誤。

### 第十次改版（2026-09-11）

1. **課程異動項目可拖拉排序。**
   每則卡片新增有文字與六點圖示的拖曳把手，放開後同步預覽並保存 `notices` 陣列順序。

2. **滑鼠、觸控與長列表捲動共用 Pointer Events。**
   拖到可視區上下邊緣會自動捲動，卡片換位後仍由文件層接住放開事件，避免排序只改畫面而沒有寫入資料。

3. **加入完整鍵盤替代操作。**
   把手可用上下方向鍵移動，焦點會跟著同一則公告，螢幕閱讀器會朗讀新的順位。

4. **`?v=` cache busting 更新為 `20260911-drag-reorder-1`。**

驗證結果：鍵盤排序、滑鼠拖曳、模擬觸控拖曳、預覽同步與 reload 保存皆通過；390px 手機寬度沒有水平溢出，把手維持 44 × 44 px，console 無錯誤。

### 第十一次改版（2026-09-11）

1. **嵌入完整繁體中文字體。**
   全站固定使用自託管 Noto Sans TC；校務公文與黑白報刊另使用自託管 Noto Serif TC，不再依賴各作業系統的中文字體。

2. **兼顧載入速度與排版穩定。**
   字體採 WOFF2 可變字重，啟動時只載入無襯線字體；每次字體載入完成都重新量測公告內容。

3. **PNG 同步嵌入字體。**
   線上模式直接讀 WOFF2，離線模式延遲載入 Base64 備援，兩者產生的 SVG／Canvas 都含相同字體資料。

4. **附帶完整 OFL 授權文件，並更新 Pages 部署 artifact。**

5. **`?v=` cache busting 更新為 `20260911-embedded-fonts-1`。**

驗證結果：離線模式實際註冊兩個 FontFace 並輸出經典編輯／黑白報刊 PNG 成功，主控台無 CORS 或其他錯誤；6 主題 × 2 方向 × 2／6 則共 24 組排版皆為 0 溢出。
