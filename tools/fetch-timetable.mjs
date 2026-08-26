// 抓一次官方班表寫進 data/timetable.json，然後結束。
//
//   node tools/fetch-timetable.mjs             # 抓官方 CSV
//   node tools/fetch-timetable.mjs some.csv    # 吃本地檔案，改欄位對照時測用
//
// 要一直更新的話用 tools/serve.mjs，不要拿這支去排 cron —— 那支會順便把看板
// 服務起來，而且抓失敗不會整個死掉。

import { fetchTimetable, writeTimetable, FetchFailed, SOURCE } from "./timetable.mjs";

const src = process.argv[2] || SOURCE;

let table;
try{
  table = await fetchTimetable(src);
}catch(err){
  console.error(err.message);
  // 對方掛掉或網路不順不是這支程式壞了，用 EX_TEMPFAIL 回報，讓呼叫端分得出
  // 「這輪跳過」和「真的壞了」
  process.exit(err instanceof FetchFailed ? 75 : 1);
}

const changed = await writeTimetable(table);
const tally = "出發 " + table.departures.length + " 筆、抵達 " + table.arrivals.length + " 筆";
console.log(changed ? "寫入 data/timetable.json：" + tally
                    : "班表沒變（" + tally + "），不動檔案");
