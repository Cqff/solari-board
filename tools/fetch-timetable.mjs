// 抓一次官方班表寫進 data/timetable.json，然後結束。
//
//   node tools/fetch-timetable.mjs                  # 抓官方 CSV
//   node tools/fetch-timetable.mjs some.csv         # 吃本地檔案，改欄位對照時測用
//   node tools/fetch-timetable.mjs --find JX721     # 這個班次在原始 CSV 裡長怎樣
//   node tools/fetch-timetable.mjs --dates          # 這份資料到底是哪幾天的
//
// --find 是拿來回答「板上這一列到底哪來的」：把原始 CSV 裡對得上的列一欄一欄印
// 出來，就分得出是官方資料本來就這樣寫，還是我轉錯了。
//
// 要一直更新的話用 tools/serve.mjs，不要拿這支去排 cron —— 那支會順便把看板
// 服務起來，而且抓失敗不會整個死掉。

import { fetchTimetable, writeTimetable, findRaw, dateTally, FetchFailed, SOURCE } from "./timetable.mjs";

const argv = process.argv.slice(2);
const findAt = argv.indexOf("--find");
const needle = findAt === -1 ? "" : argv[findAt + 1] || "";
const src = argv.filter((a, i) => !a.startsWith("--") && !(findAt !== -1 && i === findAt + 1))[0]
            || SOURCE;
const wantDates = argv.includes("--dates");

if(wantDates){
  // 回答「這份資料是不是舊的」：把 CSV 裡表訂日期的分布直接數出來
  let tally;
  try{
    tally = await dateTally(src);
  }catch(err){
    console.error(err.message);
    process.exit(err instanceof FetchFailed ? 75 : 1);
  }
  console.log(`來源：${src}`);
  if(!tally.column){
    console.log("這份 CSV 找不到日期欄位（表訂日期／預計日期），沒辦法判斷新舊。");
    console.log("表頭：" + tally.header.map(h => h.trim()).join(" | "));
    process.exit(0);
  }
  console.log(`日期欄「${tally.column}」共 ${tally.total} 列：\n`);
  tally.days.forEach(([day, n]) => console.log(`  ${day || "(空白)"}  ${n} 列`));
  console.log(`\n今天（台北）是 ${tally.today}。`);
  console.log(tally.days.some(d => d[0] === tally.today)
    ? "→ 資料裡有今天的班次，這份是即時資料。"
    : "→ 資料裡沒有今天的班次 —— 這份不是即時資料，把上面整段貼給我。");
  process.exit(0);
}

if(findAt !== -1){
  if(!needle){
    console.error("--find 後面要給班號或關鍵字，例如 --find JX721");
    process.exit(1);
  }
  let found;
  try{
    found = await findRaw(src, needle);
  }catch(err){
    console.error(err.message);
    process.exit(err instanceof FetchFailed ? 75 : 1);
  }
  console.log(`來源：${src}`);
  if(!found.rows.length){
    console.log(`原始 CSV 裡找不到「${needle}」—— 板上如果有這一列，那就是轉檔器的問題，把這句話貼給我。`);
    process.exit(0);
  }
  console.log(`原始 CSV 裡有 ${found.rows.length} 列對得上「${needle}」：\n`);
  found.rows.forEach((row, n) => {
    console.log(`--- 第 ${n + 1} 列`);
    found.header.forEach((h, i) => {
      const v = (row[i] || "").trim();
      if(v) console.log(`  ${h.trim()}: ${v}`);
    });
    console.log("");
  });
  process.exit(0);
}

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
