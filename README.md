# Solari 翻頁看板

機械翻頁顯示看板（split-flap / Solari board），純前端、單一檔案、無相依套件。
單區 10 行，可全螢幕上牆。

## 線上版

GitHub Pages: <https://cqff.github.io/solari-board/>

## 操作

| 控制 | 說明 |
| --- | --- |
| 頻道 航班／行程／系統／中文 | 切換整面資料，或按鍵盤 `1`–`4` |
| 自訂訊息 | 打字上大字列，最多 14 字，Enter 送出 |
| 每頁 | 單片葉子落下的時間（ms） |
| 行程 | 一格最多翻幾片才停 |
| 排距 | 每一排間隔多久出發，同時是翻頁聲的節拍 |
| 翻頁聲 | WebAudio 合成的機械敲擊聲，預設關 |
| 自動輪播 | 每 9 秒換一個頻道，或按 `Space` |
| 全螢幕 | 或按 `F`；`Esc` 離開 |

## 換成自己的資料

資料全部在 `src/board.html` 的 `CHANNELS` 物件裡，每筆是
`[時間, 內容, 狀態, 號誌燈]`，號誌燈可用 `ok` / `live` / `idle` / `alert`：

```js
flights: {
  marquee: "DEPARTURES",              // 大字列，最多 14 格
  sub: "TAOYUAN INTL · TERMINAL 2",   // 副標，最多 28 格
  rows: [
    ["08:40", "TOKYO HND", "ON TIME", "ok"],
    // ... 共 10 筆，由上而下依序翻
  ]
}
```

版面尺寸在同一個檔案的 `COLS` 和 `ROWS`：

```js
var COLS = [
  { key:"time",   n:5,  head:"時間 Time",        drum:NUMS },
  { key:"body",   n:13, head:"內容 Destination", drum:DRUM },
  { key:"status", n:8,  head:"狀態 Status",      drum:DRUM }
];
var ROWS = 10;       // 板面行數
```

字元不在字符鼓上時（例如中文）會自動插進該格的鼓裡，一樣有翻頁過程。

## 建置

`src/board.html` 是唯一的來源檔，寫成沒有 `<!doctype>` / `<html>` / `<head>` /
`<body>` 的片段。靜態主機直接開這種片段會落入 quirks mode，`100vh` 版面會壞掉，
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
- 葉片**不要圓角** — 圓角會讓繪製器對約 1200 個旋轉元素各做一次遮罩裁切
- 葉片**不要 inset 陰影** — 同理。接縫改用露出 1px 底色達成
- 所有旋轉由**單一 rAF 迴圈**直接寫 transform，不用 CSS animation 重啟
  （那需要 `offsetWidth` 強制同步重排，數百格就是數百次全文件 layout）
- 每片葉子的落下時間各自隨機 ±14%，避免整批同時換頁造成突發尖峰
- 翻頁聲踩拍子而非一片一響 — 整面更新約 1000 次翻頁，忠實播放必然是噪音

## 字型

字型從 Google Fonts 載入。離線的看板機會退回系統字型（版面不壞，質感差一截）。
需要完全離線自足的話要把字型內嵌成 data URI。

## 授權

MIT
