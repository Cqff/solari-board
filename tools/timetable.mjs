// 桃園機場「即時航班」開放資料 → 看板要的班表。
//
// 這支只負責抓和轉，誰來用都可以：
//   tools/fetch-timetable.mjs   跑一次就結束（GitHub Action 或手動）
//   tools/serve.mjs             本地端一邊服務看板一邊定時更新
//
// 資料來源是政府資料開放平臺 26194「桃園國際機場即時航班」，每 5 分鐘更新。
//
// 欄位名稱是照資料集的「主要欄位說明」對的。真的 CSV 要是換了欄名，把新名字加
// 進下面 FIELDS 的別名清單就好 —— 對不到必要欄位時會把實際的表頭印出來再結束，
// 不會默默產出一張空班表。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "data", "timetable.json");

const SOURCE = process.env.TIMETABLE_URL ||
  "https://odp.taoyuan-airport.com/dataset/2023081816?format=csv";

const MIN_ROWS = 20;    // 比這還少就當作抓到壞資料，寧可留著上一版
// 純粹是防呆上限。TPE 一天三百多班出發，設 400 的話遇到含隔日班次的資料就會從
// 最晚的那些開始被切掉 —— 排序是照時刻的，切尾巴等於把深夜的班次砍光。
const MAX_ROWS = 1500;
const DEST_N = 13;      // 目的地欄的格數，跟 board.html 的 COLS 對齊
const FLIGHT_N = 7;

// 一個欄位可以有好幾種寫法，由左往右找，全部找不到才算缺欄位
const FIELDS = {
  kind:     ["種類", "類別", "kind", "type", "arrdep"],
  airline:  ["航空公司代碼", "航空公司", "airlineCode", "airline"],
  number:   ["班次", "航班編號", "班機編號", "flightNumber", "flightNo", "flight"],
  sched:    ["表訂時間", "預定時間", "scheduleTime", "schTime", "std"],
  est:      ["預計時間", "estimateTime", "estTime", "etd"],
  destEn:   ["往來地點英文", "目的地英文", "airPortNameEnglish"],
  destZh:   ["往來地點中文", "目的地", "airPortNameChinese"],
  destCode: ["往來地點", "航點", "airPort", "airportCode"],
  status:   ["航班狀態", "航班動態中文", "航班動態英文", "狀態", "status"]
};
const REQUIRED = ["kind", "number", "sched"];

/* ---------- 抓檔 ---------- */

async function grab(src){
  if(!/^https?:/i.test(src)) return readFile(resolve(ROOT, src));

  let last;
  for(let attempt = 1; attempt <= 4; attempt++){
    try{
      const res = await fetch(src, {
        headers: { "user-agent": "solari-board/1.0 (+https://github.com/Cqff/solari-board)",
                   "accept": "text/csv,application/csv,*/*" },
        signal: AbortSignal.timeout(45000)
      });
      if(!res.ok) throw new Error("HTTP " + res.status);
      return Buffer.from(await res.arrayBuffer());
    }catch(err){
      last = err;
      if(attempt < 4) await new Promise(r => setTimeout(r, attempt * 4000));
    }
  }
  throw last;
}

// 政府開放資料偶爾還是 Big5。UTF-8 解錯會塞一堆替代字元，據此換一種解。
function decode(buf){
  const utf8 = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
  if((utf8.match(/�/g) || []).length > 5){
    try{ return new TextDecoder("big5").decode(buf).replace(/^﻿/, ""); }catch{}
  }
  return utf8;
}

/* ---------- CSV ---------- */
// 欄位裡可能包含逗號和換行，所以不能用 split(",")。

function parseCsv(text){
  const rows = [];
  let row = [], field = "", quoted = false;

  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(quoted){
      if(c !== '"') field += c;
      else if(text[i + 1] === '"'){ field += '"'; i++; }
      else quoted = false;
    }
    else if(c === '"') quoted = true;
    else if(c === ","){ row.push(field); field = ""; }
    else if(c === "\n"){ row.push(field); rows.push(row); row = []; field = ""; }
    else if(c !== "\r") field += c;
  }
  if(field !== "" || row.length){ row.push(field); rows.push(row); }

  return rows.filter(r => r.some(v => v.trim() !== ""));
}

const norm = v => String(v || "").replace(/^﻿/, "").replace(/[\s*]/g, "").toLowerCase();

function mapColumns(header){
  const seen = header.map(norm);
  const at = {};
  for(const [key, names] of Object.entries(FIELDS)){
    for(const name of names){
      const i = seen.indexOf(norm(name));
      if(i !== -1){ at[key] = i; break; }
    }
  }
  const missing = REQUIRED.filter(k => at[k] === undefined);
  if(missing.length){
    throw new Error(
      "對不到欄位：" + missing.join("、") + "\n" +
      "CSV 實際的表頭是：" + header.map(h => h.trim()).join(" | ") + "\n" +
      "把新欄名加進 tools/fetch-timetable.mjs 的 FIELDS 即可。");
  }
  if(at.destEn === undefined && at.destZh === undefined && at.destCode === undefined){
    throw new Error("找不到任何目的地欄位。表頭：" + header.map(h => h.trim()).join(" | "));
  }
  return at;
}

/* ---------- 一列 → 看板的一筆 ---------- */

const pad2 = n => String(n).padStart(2, "0");

function hhmm(v){
  const s = String(v || "").trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  const [h, min] = m ? [+m[1], +m[2]]
                     : (/^\d{4}$/.test(s.replace(/\D/g, "")) ?
                        [+s.replace(/\D/g, "").slice(0, 2), +s.replace(/\D/g, "").slice(2)] : []);
  if(h === undefined || h > 23 || min > 59) return "";
  return pad2(h) + ":" + pad2(min);
}

const isDeparture = v => /出發|離境|出境|depart/i.test(v) || /^\s*d\s*$/i.test(v);
const isArrival   = v => /抵達|到達|入境|arriv/i.test(v) || /^\s*a\s*$/i.test(v);
const isCancelled = v => /取消|cancel/i.test(v);

function tidy(name, n){
  return String(name || "")
    .replace(/\(.*?\)|（.*?）/g, " ")     // 括號裡多半是機場代碼或註記
    .replace(/[\/,\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim().toUpperCase().slice(0, n);
}

function convert(text){
  const table = parseCsv(text);
  if(table.length < 2) throw new Error("CSV 只有 " + table.length + " 列，抓到的不是資料");

  const at = mapColumns(table[0]);
  const get = (row, key) => at[key] === undefined ? "" : (row[at[key]] || "").trim();

  const seen = new Set();
  const out = { departures: [], arrivals: [] };

  for(const row of table.slice(1)){
    const kind = get(row, "kind");
    const bucket = isDeparture(kind) ? out.departures : isArrival(kind) ? out.arrivals : null;
    if(!bucket) continue;
    if(isCancelled(get(row, "status"))) continue;

    // 誤點的話，會動的是預計時間 —— 看板是拿這個時間倒數的（抵達也一樣），
    // 所以有就用它
    const time = hhmm(get(row, "est")) || hhmm(get(row, "sched"));
    if(!time) continue;

    const code = get(row, "airline").toUpperCase().replace(/\s+/g, "");
    let num = get(row, "number").toUpperCase().replace(/\s+/g, "");
    if(code && num.startsWith(code)) num = num.slice(code.length);
    const flight = ((code ? code + " " : "") + num).slice(0, FLIGHT_N).trim();
    if(!num) continue;

    const dest = tidy(get(row, "destEn"), DEST_N) ||
                 tidy(get(row, "destZh"), DEST_N) ||
                 tidy(get(row, "destCode"), DEST_N);
    if(!dest) continue;

    const key = kind + time + flight;
    if(seen.has(key)) continue;      // 同一班在資料裡出現兩次（共掛班號）只留一筆
    seen.add(key);
    bucket.push([time, flight, dest]);
  }

  const byTime = (a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  for(const k of ["departures", "arrivals"]){
    if(out[k].length > MAX_ROWS){
      console.warn(`${k} 有 ${out[k].length} 筆，超過上限 ${MAX_ROWS}，最晚的那些會被切掉`);
    }
  }
  return {
    departures: out.departures.sort(byTime).slice(0, MAX_ROWS),
    arrivals:   out.arrivals.sort(byTime).slice(0, MAX_ROWS)
  };
}

/* ---------- 寫檔 ---------- */
// 一行一筆，diff 才看得懂 —— 這個檔案一天會被改上百次。

function list(name, rows){
  return '  "' + name + '": [\n' +
    rows.map(r => "    " + JSON.stringify(r)).join(",\n") +
    "\n  ]";
}

function render(t){
  return "{\n" +
    '  "generated": ' + JSON.stringify(new Date().toISOString()) + ",\n" +
    '  "source": ' + JSON.stringify(SOURCE) + ",\n" +
    list("departures", t.departures) + ",\n" +
    list("arrivals", t.arrivals) + "\n}\n";
}

/* ---------- 對外的兩個動作 ---------- */

export class FetchFailed extends Error {}

// 抓 + 轉。抓不到丟 FetchFailed（對方的問題），轉不出來丟一般 Error（我們的問題）
export async function fetchTimetable(src = SOURCE){
  let raw;
  try{
    raw = await grab(src);
  }catch(err){
    throw new FetchFailed("抓不到 " + src + "：" + err.message);
  }

  const t = convert(decode(raw));
  const total = t.departures.length + t.arrivals.length;

  // 這道關卡是防遠端回壞資料用的；拿本地檔案測欄位對照時不擋
  if(/^https?:/i.test(src) && total < MIN_ROWS){
    throw new Error("只轉出 " + total + " 筆（至少要 " + MIN_ROWS + " 筆），" +
                    "當作是壞資料，不覆蓋現有的班表");
  }
  return t;
}

// 寫檔。班次沒變就不動檔案 —— generated 的時戳會讓每次執行都看起來有差異
export async function writeTimetable(t){
  let before = null;
  try{
    const old = JSON.parse(await readFile(OUT, "utf8"));
    before = JSON.stringify([old.departures, old.arrivals]);
  }catch{}
  if(before && before === JSON.stringify([t.departures, t.arrivals])) return false;

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, render(t), "utf8");
  return true;
}

export { SOURCE, OUT };
