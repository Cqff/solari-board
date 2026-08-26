# Solari 翻頁看板

機械翻頁顯示看板（split-flap / Solari board），純前端、單一檔案、無相依套件。
單區 10 行，可全螢幕上牆。航班頻道是活的：照台北時間，只顯示現在往後四小時的
TPE 出境班次，狀態跟著時鐘自己翻。

## 線上版

GitHub Pages: <https://cqff.github.io/solari-board/>

## 操作

| 控制 | 說明 |
| --- | --- |
| 頻道 航班／行程／系統／中文 | 切換整面資料，或按鍵盤 `1`–`4` |
| 航班頻道 | 台北時間往後 4 小時的 TPE 出境班次，每分鐘自己更新 |
| 自訂訊息 | 打字上大字列，最多 14 字，Enter 送出 |
| 每頁 | 單片葉子落下的時間（ms） |
| 行程 | 一格最多翻幾片才停 |
| 排距 | 每一排間隔多久出發，同時是翻頁聲的節拍 |
| 翻頁聲 | WebAudio 合成的機械敲擊聲，預設關 |
| 自動輪播 | 每 9 秒換一個頻道，或按 `Space` |
| 全螢幕 | 或按 `F`；`Esc` 離開 |

## 航班頻道

看板只把「現在往後四小時」那一段畫出來。班表有兩個來源：接上官方即時航班之後
用 `data/timetable.json`（見下一節），抓不到就用 `src/board.html` 裡內建的
`TIMETABLE`。兩邊格式一樣，每筆是 `[起飛時間, 班機, 目的地]`，台北時間，照時刻
排序：

```js
var TIMETABLE = [
  ["09:20", "JX 802", "TOKYO NRT"],
  // ...
];
```

狀態不是寫死的，是用**距離起飛還剩幾分鐘**算出來的：

| 還剩 | 板面 | 號誌燈 |
| --- | --- | --- |
| > 90 分 | `SCHEDULED` | idle |
| ≤ 90 分 | `CHECK IN` | ok |
| ≤ 45 分 | `BOARDING` | live |
| ≤ 20 分 | `LAST CALL` | alert |
| ≤ 5 分 | `CLOSING` | alert |
| 已起飛 | `DEPARTED` | idle |

分段在 `STATES`，視窗長度在 `WINDOW_MIN`（240 分），已起飛的班次會再掛
`LINGER_MIN`（10 分）才落板，最上面那排才不會憑空消失。視窗會繞過午夜 —
23:55 那班在 00:30 看就是「剛起飛」。

時間一律用**台北時間**：台北 1979 年之後就沒有日光節約時間，所以固定 `+8`
就是精確值，不必動用 `Intl` 或時區資料庫，看板機器設在哪一區都一樣。右上角的
時鐘也是 TPE 時間。

班表每分鐘重算一次（踩時鐘的整分，不是另外輪詢），算出來一樣就什麼都不做 —
兩班之間的空檔只有一次字串比對，看板本體完全不動。

### 接上官方即時航班

**內建的是示範班表**：航空公司、航線、時段照著桃園機場平常的樣子排，但班號與
時刻不是官方公告的班表，別拿它趕飛機。

`.github/workflows/timetable.yml` 每 10 分鐘跑一次 `tools/fetch-timetable.mjs`，
抓政府資料開放平臺
[桃園國際機場即時航班](https://data.gov.tw/dataset/26194) 的 CSV，轉成
`data/timetable.json` commit 回 repo。看板每 5 分鐘自己回頭抓那個檔案 —— 掛在
牆上的看板不會有人去按重新整理。抓不到就用內建的示範班表，所以 workflow 還沒
接、對方掛了、或直接用 `file://` 開，板面都不會開天窗。

為什麼是即時航班而不是
[定期航班](https://data.gov.tw/dataset/7869)：定期航班七天才更新一次，每 10
分鐘抓它 144 次沒有意義。即時航班每 5 分鐘更新，而且帶「預計時間」—— 誤點的
班次會自動改用新的時間倒數，取消的直接不上板。

上牆之前要知道的幾件事：

- **排程只會在預設分支上跑**，所以這支要合進 `main` 之後才會開始動。
- GitHub 的排程是盡力而為的，尖峰時段會延後、偶爾整輪跳過，實際間隔大概是
  10 到 30 分鐘。
- 班次有變才 commit，但即時資料本來就一直在變 —— 白天大概每輪都會生一個
  commit，一天上看百來個。嫌吵就把 cron 調成 `*/30` 或 `0 * * * *`；要完全不
  commit 的話改用 `actions/deploy-pages` 部署，那得去 Settings → Pages 把
  Source 改成 GitHub Actions。
- 抓不到資料的那一輪會標成 warning 跳過，不算失敗（不然每 10 分鐘寄一封失敗
  通知），看板留著上一版。**欄位對不到才是真的失敗**，錯誤訊息會把 CSV 實際的
  表頭印出來。
- 60 天沒有任何動靜的 repo，GitHub 會自動停掉排程 workflow。
- `main` 開了分支保護的話，`github-actions[bot]` 要放行才推得上去。

欄位對照在 `tools/fetch-timetable.mjs` 的 `FIELDS`，一個欄位可以列好幾種寫法，
官方換了欄名就多加一個。本地測改得對不對：

```bash
node tools/fetch-timetable.mjs some.csv   # 吃本地 CSV，不連網
```

## 換成自己的資料

其他頻道的資料在 `CHANNELS` 物件裡，每筆是四個欄位加一個號誌燈，
號誌燈可用 `ok` / `live` / `idle` / `alert`：

```js
schedule: {
  marquee: "TODAY",                   // 大字列，最多 14 格
  sub: "WEDNESDAY · 26 AUGUST",       // 副標，最多 28 格
  heads: ["時間 Time", "類別 Type", "內容 Agenda", "地點 Where"],
  rows: [
    ["08:30", "SYNC", "STANDUP", "ROOM 2", "idle"],
    // ... 共 10 筆，由上而下依序翻
  ]
}
```

`rows` 和 `sub` 也可以給函式（航班頻道就是這樣變成活的），每次上板時才求值。

版面尺寸在同一個檔案的 `COLS` 和 `ROWS`，欄數是從 `COLS` 長出來的，
加一欄不用改 CSS：

```js
var COLS = [
  { key:"time",   n:5,  drum:NUMS },
  { key:"flight", n:7,  drum:DRUM },
  { key:"body",   n:13, drum:DRUM },
  { key:"status", n:9,  drum:DRUM }
];
var ROWS = 10;       // 板面行數
```

欄位標題跟著頻道走（`heads`），所以同一塊板可以在「目的地」和「項目」之間切換。

字元不在字符鼓上時（例如中文）會自動插進該格的鼓裡，一樣有翻頁過程。

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
靜止時看板本體完全不做事（實測 5 秒 0 次 DOM 異動），rAF 迴圈會自己停。

掛牆前值得知道的：

- **GPU 合成必須開著**。這東西是 CSS 3D transform，退回軟體繪製會很慘。
  在目標機器開 `chrome://gpu` 確認 Compositing 是 Hardware accelerated。
- **解析度是最大的倍率**，4K 約是 1080p 的四倍繪製量。
- 機器不夠力時，依效果排序：排距調高 → 行程調低 → 減少行數 → 降解析度 →
  關掉自動輪播。實測排距 50→80ms 讓 p95 從 150ms 降到 83ms。
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
