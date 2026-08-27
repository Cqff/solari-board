# Solari 翻頁看板

機械翻頁顯示看板（split-flap / Solari board），純前端、單一檔案、無相依套件。
10 行的 TPE 航班看板，**出發／抵達兩個分頁**，可全螢幕上牆。照台北時間顯示一段
時間窗內的班次（出發 −30～+210 分，抵達 −60～+120 分），狀態跟著時鐘自己翻；
裝不下的班次每 50 秒翻下一頁，翻完回到最前面。

## 線上版

GitHub Pages: <https://cqff.github.io/solari-board/?demo>

線上版沒有資料來源，所以那個網址帶了 `?demo` —— 板上跑的是**編出來的**示範班表，
只是給人看看這東西長什麼樣子。要真的班次得在本地跑（見下面「接上官方即時航班」）。

## 操作

| 控制 | 說明 |
| --- | --- |
| 出發／抵達 | 換面板，或按鍵盤 `1`／`2`；兩邊各自記著自己翻到第幾頁 |
| （自動） | 每 50 秒翻下一頁，最後一頁翻完回到第一頁，一直繞；共掛班號每 10 秒換一個 |
| 自訂訊息 | 打字上大字列，最多 14 字，Enter 送出；**留空 Enter 還原** |
| 每頁 | 單片葉子落下的時間（ms） |
| 行程 | 一格最多翻幾片才停 |
| 排距 | 每一排間隔多久出發，同時是翻頁聲的節拍 |
| 翻頁聲 | WebAudio 合成的機械敲擊聲，預設關 |
| 全螢幕 | 或按 `F`；`Esc` 離開 |
| `Space` | 不等 50 秒，直接翻下一頁 |

## 班表與輪播

看板只把現在前後一段時間的班次畫出來。兩面板的窗不一樣 —— 出發的人在意的是接
下來要飛什麼，接機的人在意的是剛剛到了沒：

| | 往前 | 往後 |
| --- | --- | --- |
| 出發 `DEP_BACK` / `DEP_AHEAD` | 30 分 | 210 分 |
| 抵達 `ARR_BACK` / `ARR_AHEAD` | 60 分 | 120 分 |

班表來自 `tools/serve.mjs` 產生的
`data/timetable.json`（見下一節）。**抓不到就是空的**：副標會寫 `NO LIVE TIMETABLE`，
左下角寫 `NO FEED`，板上一班都不會有。一面掛在牆上的航班看板寧可空著，也不能理
直氣壯地顯示假航班。

`src/board.html` 裡的 `DEP_TABLE` / `ARR_TABLE` 是**編出來的**示範班表 —— 航線和
時段照 TPE 的樣子排，但班號時刻都是假的，跟真的航班對不起來。它預設不會上板，
只有網址帶 `?demo` 時才用，給截圖和改版面用。

三種班表的格式都一樣，每筆是 `[時間, 班機, 目的地或來自]`，台北時間，照時刻排序：

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

往前那段留著讓人確認自己是不是錯過了。視窗會繞過午夜：23:55 那班在 00:30 看就是
「剛起飛」。

視窗裡的班次通常不只十班，所以**切頁輪播**：一頁十行，每 `PAGE_EVERY`（50 秒）
翻下一頁，翻到最後一頁就回到第一頁（也就是前一小時那頁），一直繞。副標會寫現在
是第幾頁，例如 `TPE 08:12-13:12 · 1 OF 2`。班次會隨時間掉出視窗、頁數跟著變，
頁碼每次都會收斂回實際範圍。等不及 50 秒就按 `Space`。

兩個面板的定義在 `BOARDS`，各自帶著自己的班表、狀態分段、大字列和第三欄標題；
頁碼也是各記各的，切過去接著自己的進度。

### 共享航班

同一架飛機常常掛好幾個班號（codeshare），在官方資料裡就是好幾筆：同方向、同時
刻、同航點，只有班號不一樣。一班佔四行的話板面很快就被吃光，所以轉檔時就合成
一列，其他班號放在最後面的「其他 Also」欄：

```
時間     班機      目的地          狀態        其他
08:20   CI 100    TOKYO HND      BOARDING    JL 5802 KL 5001
```

那一欄**一次只顯示一個共掛班號，每 `SHARE_EVERY`（10 秒）換下一個** —— 真的翻頁
看板就是這樣處理共掛的，那一欄也因此只要 `ALSO_N`（7 格）放得下一個班號就好。兩
個共掛的十秒換一次，三個的三十秒繞一圈；沒有共掛的那幾列從頭到尾不動。

主班號顯示哪一個：官方資料沒有「誰實際執飛」這個欄位，所以用**欄位填得最完整的
那筆**——共掛的那幾筆通常沒有機型和報到櫃台——同分再照班號排，結果才不會每次抓
都跳。

**同時刻同航點但登機門不一樣的不會合併**，那是兩班不同的飛機（例如同一分鐘飛
香港的 CX 和 KA）。判斷在 `tools/timetable.mjs` 的 `splitByGate`。

視窗窄到五欄排不下時（大概 600px 以下），**最後一欄會自己收起來**，不會被裁掉
半個字。`fit()` 先用全部欄位量一次，量不下才收一欄重來。

時間一律用**台北時間**：台北 1979 年之後就沒有日光節約時間，所以固定 `+8`
就是精確值，不必動用 `Intl` 或時區資料庫，看板機器設在哪一區都一樣。右上角的
時鐘也是 TPE 時間。

班表每分鐘重算一次（踩時鐘的整分，不是另外輪詢），翻頁和抓到新班表也都走同一
條路。算出來跟板上一樣就什麼都不做 —— 深夜只有一頁、又沒有共掛班號的時候，這裡
每 10 秒只是一次字串比對，沒有 DOM 讀寫。

### 接上官方即時航班

**內建的是示範班表**：航空公司、航線、時段照著桃園機場平常的樣子排，但班號與
時刻不是官方公告的班表，別拿它趕飛機。要接真的資料，本地端跑起來就好：

```bash
node tools/serve.mjs
```

看板在 <http://localhost:8080>，開瀏覽器按 `F` 全螢幕就可以掛牆。這支做兩件事：

- 把板面服務出來（`file://` 開的話瀏覽器不准抓旁邊的檔案，所以要有個 server）
- 每 3 分鐘抓一次政府資料開放平臺
  [桃園國際機場即時航班](https://data.gov.tw/dataset/26194) 的 CSV，依「種類」欄
  拆成出發和抵達兩份，轉成 `data/timetable.json`：

```json
{ "generated": "…", "source": "…",
  "departures": [ ["09:20","JX 802","TOKYO NRT","D5",["CI 9802"]] ],
  "arrivals":   [ ["09:10","JX 801","TOKYO NRT","A3"] ] }
```

每筆是 `[時間, 班機, 目的地或來自, 登機門, 其他共掛班號]`，後兩個可以省略。

**只留現在前後的班次**：即時航班那份不是只有今天 —— 昨天的晚班、明天的早班都在
裡面。看板把班表當成「每天都一樣」在用（只看 `HH:MM`），所以轉檔時就照 `表訂日期`
／`預計日期` 濾掉現在前 3 小時到後 8 小時以外的，不然別天的班次會像今天的班一樣
上板。日期欄讀不出來的那幾筆不判斷，寧可多留也不要整份濾空；濾掉幾筆會寫在 log。

官方那份每 5 分鐘更新一次，這裡設 3 分鐘是為了不要卡在它的更新邊上 —— 抓比它快
沒有壞處，CSV 沒變的話連檔案都不會動。看板自己每 2 分鐘回頭抓那個檔案，所以
**不用重新整理**，班表換了就會自己翻上去。
抓不到（對方掛了、網路斷了）就留著上一版繼續顯示 —— 銘牌上的時間就說明了資料
有多舊。從頭到尾沒抓到過的話，板面是空的。

**板面左下角的銘牌會照實寫現在用的是哪一份**：

| 銘牌 | 意思 |
| --- | --- |
| `TPE OPEN DATA · 14:02` | 官方資料，後面是這份資料抓下來的台北時間 |
| `NO FEED · RUN tools/serve.mjs` | 沒抓到，板上是空的 |
| `SAMPLE TIMETABLE · MADE UP, NOT REAL FLIGHTS` | `?demo`，板上是假航班 |

看到後面兩種，就表示板上的東西不能拿來趕飛機。抓不到最常見的兩個原因：沒有透過
`tools/serve.mjs` 開（直接點 `index.html` 的話瀏覽器不准它抓旁邊的檔案），或者官
方那台當下連不上（伺服器的 log 會寫）。單獨測抓得到抓不到：

```bash
node tools/serve.mjs --port 9000 --every 5     # 換埠號、改成 5 分鐘抓一次
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
node tools/fetch-timetable.mjs                 # 抓一次就結束，印出抓到幾筆或錯在哪
node tools/fetch-timetable.mjs some.csv        # 吃本地 CSV，不連網
node tools/fetch-timetable.mjs --dates         # 這份資料到底是哪幾天的
node tools/fetch-timetable.mjs --find JX721    # 某個班次在原始 CSV 裡長什麼樣子
```

板上出現看不懂的班次時，`--find` 是唯一能分辨「官方資料本來就這樣寫」還是「轉檔
器轉錯了」的辦法 —— 它把原始 CSV 裡對得上的列一欄一欄印出來，包含表訂日期。
`--dates` 則把整份資料的日期分布數出來，一眼看得出是不是即時資料。

> 資料網址裡的 `2023081816` 是**資料集編號**（桃機開放資料平台用上架日期當編號），
> 不是資料的日期。定期航班那份是 `2022110903`，同一套命名。要確認拿到的是不是
> 今天的資料，用 `--dates`。

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
  { key:"time",   n:5,      head:"時間 Time",          drum:NUMS },
  { key:"flight", n:7,      head:"班機 Flight",        drum:DRUM },
  { key:"body",   n:13,     head:"目的地 Destination", drum:DRUM },
  { key:"status", n:9,      head:"狀態 Status",        drum:DRUM },
  { key:"gate",   n:3,      head:"登機門 Gate",        drum:DRUM },
  { key:"also",   n:ALSO_N, head:"其他 Also",          drum:DRUM }
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
每 50 秒翻一頁、共掛班號每 10 秒換一個，是設計上就會動的部分；其餘時候看板本體
完全不做事（深夜只有一頁又沒共掛時實測 20 秒 0 次 DOM 異動），rAF 迴圈會自己停。

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
