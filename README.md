# Solari 翻頁看板

機械翻頁顯示看板（split-flap / Solari board），純前端、單一檔案、無相依套件。
10 行的 TPE 航班看板，**出發／抵達兩個分頁**，可全螢幕上牆。兩面板規則一樣：照
台北時間顯示**前 1 小時到後 4 小時**的班次，狀態跟著時鐘自己翻；裝不下的班次每
25 秒翻下一頁，翻完回到最前面。

## 線上版

GitHub Pages: <https://cqff.github.io/solari-board/>

## 操作

| 控制 | 說明 |
| --- | --- |
| 出發／抵達 | 換面板，或按鍵盤 `1`／`2`；兩邊各自記著自己翻到第幾頁 |
| （自動） | 每 25 秒翻下一頁，最後一頁翻完回到第一頁，一直繞 |
| 自訂訊息 | 打字上大字列，最多 14 字，Enter 送出；**留空 Enter 還原** |
| 每頁 | 單片葉子落下的時間（ms） |
| 行程 | 一格最多翻幾片才停 |
| 排距 | 每一排間隔多久出發，同時是翻頁聲的節拍 |
| 翻頁聲 | WebAudio 合成的機械敲擊聲，預設關 |
| 全螢幕 | 或按 `F`；`Esc` 離開 |
| `Space` | 不等 25 秒，直接翻下一頁 |

## 班表與輪播

看板只把「前 1 小時到後 4 小時」那一段畫出來。班表有兩個來源：`tools/serve.mjs`
跑起來之後用它產生的 `data/timetable.json`（見下一節），抓不到就用 `src/board.html`
裡內建的 `DEP_TABLE` 和 `ARR_TABLE`。格式都一樣，每筆是
`[時間, 班機, 目的地或來自]`，台北時間，照時刻排序：

```js
var DEP_TABLE = [ ["09:20", "JX 802", "TOKYO NRT"], /* ... */ ];
var ARR_TABLE = [ ["09:10", "JX 801", "TOKYO NRT"], /* ... */ ];
```

狀態不是寫死的，是用**距離起飛（或落地）還剩幾分鐘**算出來的。兩面板規則一樣，
只有用語不一樣 —— 抵達的班機不會 `CHECK IN`，出發的班機也不會 `AT GATE`：

| 還剩 | 出發 `DEP_STATES` | 抵達 `ARR_STATES` | 號誌燈 |
| --- | --- | --- | --- |
| > 90 分 | `SCHEDULED` | `SCHEDULED` | idle |
| ≤ 90 分 | `CHECK IN` | `EN ROUTE` | ok |
| ≤ 45 分 | `BOARDING` | `INBOUND` | live |
| ≤ 20 分 | `LAST CALL` | `LANDING` | alert／live |
| ≤ 5 分 | `CLOSING` | — | alert |
| 已起飛／已落地 | `DEPARTED` | `LANDED` | idle／ok |
| 落地 20 分後 | — | `AT GATE` | idle |

抵達沒有紅燈：紅色是「你再不走就趕不上了」的意思，接機的人沒有這種急迫性。

視窗前後長度是 `BACK_MIN`（60 分）和 `WINDOW_MIN`（240 分）—— 前一小時那段留著讓
人確認自己是不是錯過了。視窗會繞過午夜：23:55 那班在 00:30 看就是「剛起飛」。

五個小時的班次通常不只十班，所以**切頁輪播**：一頁十行，每 `PAGE_EVERY`（25 秒）
翻下一頁，翻到最後一頁就回到第一頁（也就是前一小時那頁），一直繞。副標會寫現在
是第幾頁，例如 `TPE 08:12-13:12 · 1 OF 2`。班次會隨時間掉出視窗、頁數跟著變，
頁碼每次都會收斂回實際範圍。等不及 25 秒就按 `Space`。

兩個面板的定義在 `BOARDS`，各自帶著自己的班表、狀態分段、大字列和第三欄標題；
頁碼也是各記各的，切過去接著自己的進度。

時間一律用**台北時間**：台北 1979 年之後就沒有日光節約時間，所以固定 `+8`
就是精確值，不必動用 `Intl` 或時區資料庫，看板機器設在哪一區都一樣。右上角的
時鐘也是 TPE 時間。

班表每分鐘重算一次（踩時鐘的整分，不是另外輪詢），翻頁和抓到新班表也都走同一
條路。算出來跟板上一樣就什麼都不做 —— 深夜只有一頁的時候，這裡每 25 秒只是一次
字串比對，沒有 DOM 讀寫。

### 接上官方即時航班

**內建的是示範班表**：航空公司、航線、時段照著桃園機場平常的樣子排，但班號與
時刻不是官方公告的班表，別拿它趕飛機。要接真的資料，本地端跑起來就好：

```bash
node tools/serve.mjs
```

看板在 <http://localhost:8080>，開瀏覽器按 `F` 全螢幕就可以掛牆。這支做兩件事：

- 把板面服務出來（`file://` 開的話瀏覽器不准抓旁邊的檔案，所以要有個 server）
- 每 10 分鐘抓一次政府資料開放平臺
  [桃園國際機場即時航班](https://data.gov.tw/dataset/26194) 的 CSV，依「種類」欄
  拆成出發和抵達兩份，轉成 `data/timetable.json`：

```json
{ "generated": "…", "source": "…",
  "departures": [ ["09:20","JX 802","TOKYO NRT"] ],
  "arrivals":   [ ["09:10","JX 801","TOKYO NRT"] ] }
```

看板自己每 5 分鐘回頭抓那個檔案，所以**不用重新整理**，班表換了就會自己翻上去。
抓不到（對方掛了、網路斷了）就留著上一版，再不行就用內建的示範班表 —— 板面不會
開天窗。

**板面左下角會寫現在用的是哪一份**：接上官方資料是 `TPE OPEN DATA · 14:02`
（後面是這份資料抓下來的台北時間），沒接上就是琥珀色的
`SAMPLE TIMETABLE · NOT LIVE`。

看到 `SAMPLE TIMETABLE` 就表示班次會少得不合理 —— 內建那張一天只有七十幾班，
真的 TPE 一天三百多班出發，晚上尖峰同一分鐘就可能有四五班。常見原因有兩個：
沒有透過 `tools/serve.mjs` 開（直接點 `index.html` 的話瀏覽器不准抓旁邊的檔案），
或者官方那台當下抓不到（伺服器的 log 會寫）。單獨測抓得到抓不到：

```bash
node tools/serve.mjs --port 9000 --every 5     # 換埠號、改成 5 分鐘一次
node tools/serve.mjs --source some.csv         # 吃本地 CSV，完全不連網
```

為什麼是即時航班而不是
[定期航班](https://data.gov.tw/dataset/7869)：定期航班七天才更新一次，每 10
分鐘抓它 144 次沒有意義。即時航班每 5 分鐘更新，而且帶「預計時間」—— 誤點的
班次會自動改用新的時間倒數，取消的直接不上板。

欄位對照在 `tools/timetable.mjs` 的 `FIELDS`，一個欄位可以列好幾種寫法，官方換
了欄名就多加一個。**對不到必要欄位不會默默產出空班表**，它會把 CSV 實際的表頭
印出來再結束。要單獨測轉檔：

```bash
node tools/fetch-timetable.mjs            # 抓一次就結束，印出抓到幾筆或錯在哪
node tools/fetch-timetable.mjs some.csv   # 吃本地 CSV，不連網
```

### 開機自己跑

Linux（systemd）：

```ini
# /etc/systemd/system/solari.service
[Unit]
Description=Solari 翻頁看板
After=network-online.target

[Service]
ExecStart=/usr/bin/node /path/to/solari-board/tools/serve.mjs
WorkingDirectory=/path/to/solari-board
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now solari`。macOS 用 launchd、Windows 用工作排程器也是
一樣的道理 —— 這支沒有相依套件，有 Node 就能跑。

> Windows 主控台如果印出亂碼，是主控台的代碼頁不是 UTF-8，先下 `chcp 65001`。

### 改用 GitHub Actions 跑（可選）

不想在本地留一台機器的話，`.github/workflows/timetable.yml` 是同一件事的雲端版：
每 10 分鐘抓一次、把 `data/timetable.json` commit 回 repo，GitHub Pages 上的看板
就會讀到。**預設是關的**，要用的話把裡面 `schedule` 那兩行的註解拿掉，並且把
`.gitignore` 裡的 `data/timetable.json` 移掉（不然 bot 推不上去）。

代價要知道：即時資料一直在變，白天大概每輪都會生一個 commit，一天上看百來個；
而且 GitHub 的排程會延後甚至跳過，實際間隔大概是 10 到 30 分鐘。本地跑沒有這兩
個問題。

## 版面

欄位和行數在 `src/board.html` 的 `COLS` 和 `ROWS`。欄數是從 `COLS` 長出來的，
加一欄不用改 CSS：

```js
var COLS = [
  { key:"time",   n:5,  head:"時間 Time",          drum:NUMS },
  { key:"flight", n:7,  head:"班機 Flight",        drum:DRUM },
  { key:"body",   n:13, head:"目的地 Destination", drum:DRUM },
  { key:"status", n:9,  head:"狀態 Status",        drum:DRUM }
];
var ROWS = 10;       // 板面行數，也是一頁幾班
```

`n` 是格數，超過的字會被切掉；`drum` 是這一欄的字符鼓，時間欄只需要數字所以用
13 片的 `NUMS`，翻起來比 50 片的 `DRUM` 短。字元不在鼓上時（例如中文）會自動插
進該格的鼓裡，一樣有翻頁過程。

第三欄的標題跟著面板換（出發是「目的地 Destination」，抵達是「來自 From」），
寫在 `BOARDS` 裡。

大字列的字在 `MARQUEE`，或直接從下面的輸入框打字上板。

## 建置

`src/board.html` 是唯一的來源檔，寫成沒有 `<!doctype>` / `<html>` / `<head>` /
`<body>` 的片段（`data/timetable.json` 是機器產生的，不用手改）。靜態主機直接開這種片段會落入 quirks mode，`100vh` 版面會壞掉，
所以要產生一份完整文件：

```bash
node build.mjs
```

會覆寫根目錄的 `index.html`。改完 `src/board.html` 記得重跑再 commit。

## 部署

GitHub Pages：Settings → Pages → Source 選 `main` 分支的根目錄即可。
`.nojekyll` 是用來跳過 Jekyll 處理的。

單一檔案無相依，也可以直接丟到任何靜態主機（Netlify、Cloudflare Pages、
自己的 nginx）。

## 效能筆記

這是**填充率型**負載，不是運算型 — JS 每幀只佔 2–3.6ms，其餘全是瀏覽器繪製。
每 25 秒翻一頁是設計上就會動的部分；不翻頁的時候看板本體完全不做事（深夜只有
一頁時實測 20 秒 0 次 DOM 異動），rAF 迴圈會自己停。

掛牆前值得知道的：

- **GPU 合成必須開著**。這東西是 CSS 3D transform，退回軟體繪製會很慘。
  在目標機器開 `chrome://gpu` 確認 Compositing 是 Hardware accelerated。
- **解析度是最大的倍率**，4K 約是 1080p 的四倍繪製量。
- 機器不夠力時，依效果排序：排距調高 → 行程調低 → 減少行數 → 降解析度 →
  `PAGE_EVERY` 拉長（翻頁次數少一半，尖峰就少一半）。實測排距 50→80ms 讓 p95
  從 150ms 降到 83ms。
- 右下角有 `FPS · FLAPS` 讀數可以直接看實際負載。

已經做過的最佳化（都是實測找出來的，改動時別退回去）：

- 葉片用**平色**不用漸層 — 兩層 linear-gradient × 數百個旋轉元素每幀重新點陣化，
  是最初最大的成本（p95 50ms → 17ms）
- 葉片**不要圓角** — 圓角會讓繪製器對約 1600 個旋轉元素各做一次遮罩裁切
- 葉片**不要 inset 陰影** — 同理。接縫改用露出 1px 底色達成
- 所有旋轉由**單一 rAF 迴圈**直接寫 transform，不用 CSS animation 重啟
  （那需要 `offsetWidth` 強制同步重排，數百格就是數百次全文件 layout）
- 每片葉子的落下時間各自隨機 ±14%，避免整批同時換頁造成突發尖峰
- 翻頁聲踩拍子而非一片一響 — 整面更新約 1300 次翻頁，忠實播放必然是噪音

## 字型

字型從 Google Fonts 載入。離線的看板機會退回系統字型（版面不壞，質感差一截）。
需要完全離線自足的話要把字型內嵌成 data URI。

## 授權

MIT
