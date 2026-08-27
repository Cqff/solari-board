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

// 即時航班那份不是只有今天：昨天的晚班、明天的早班都在裡面。看板把班表當成
// 「每天都一樣」在用，只取 HH:MM，所以不先照日期濾掉的話，別天的班次會像今天
// 的班一樣上板 —— 連停飛前的舊班次都可能混進來。留現在前後這個範圍就夠了，
// 板上最寬的窗是往後 210 分鐘，而且這個檔案每三分鐘就重產一次。
const KEEP_BACK_MIN = 3 * 60;
const KEEP_AHEAD_MIN = 8 * 60;
// 純粹是防呆上限。TPE 一天三百多班出發，設 400 的話遇到含隔日班次的資料就會從
// 最晚的那些開始被切掉 —— 排序是照時刻的，切尾巴等於把深夜的班次砍光。
const MAX_ROWS = 1500;
const DEST_N = 13;      // 目的地欄的格數，跟 board.html 的 COLS 對齊
const FLIGHT_N = 7;
const GATE_N = 3;      // TPE 的登機門最長是 C10 / D10

// 一個欄位可以有好幾種寫法，由左往右找，全部找不到才算缺欄位
const FIELDS = {
  kind:     ["種類", "類別", "kind", "type", "arrdep"],
  airline:  ["航空公司代碼", "航空公司", "airlineCode", "airline"],
  number:   ["班次", "航班編號", "班機編號", "flightNumber", "flightNo", "flight"],
  sched:     ["表訂時間", "預定時間", "scheduleTime", "schTime", "std"],
  est:       ["預計時間", "estimateTime", "estTime", "etd"],
  schedDate: ["表訂日期", "預定日期", "scheduleDate", "schDate"],
  estDate:   ["預計日期", "estimateDate", "estDate"],
  destEn:   ["往來地點英文", "目的地英文", "airPortNameEnglish"],
  destZh:   ["往來地點中文", "目的地", "airPortNameChinese"],
  destCode: ["往來地點", "航點", "airPort", "airportCode"],
  status:   ["航班狀態", "航班動態中文", "航班動態英文", "狀態", "status"],
  gate:     ["機門", "登機門", "gate"],
  aircraft: ["機型", "機種", "aircraft", "acType"],
  counter:  ["報到櫃台", "櫃台", "counter"],
  terminal: ["航廈", "航廈別", "terminal"]
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

// 台北沒有日光節約，固定 +8 就是精確值。回傳的是「台北牆上時鐘」對應的毫秒數，
// 只拿來跟同樣算法的班次時間相減。
function tpeNowMs(){
  return Date.now() + 8 * 60 * 60 * 1000;
}

// "2026-08-27" / "2026/8/27" / "20260827" → [年, 月, 日]
function ymd(v){
  const d = String(v || "").replace(/\D/g, "");
  if(d.length !== 8) return null;
  return [+d.slice(0, 4), +d.slice(4, 6), +d.slice(6, 8)];
}

// 這一班離現在多少分鐘（照台北時間算）。日期讀不出來就回 null = 不判斷
function minutesFromNow(dateVal, time){
  const parts = ymd(dateVal);
  if(!parts) return null;
  const when = Date.UTC(parts[0], parts[1] - 1, parts[2],
                        +time.slice(0, 2), +time.slice(3, 5));
  return (when - tpeNowMs()) / 60000;
}

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

// 同一組裡登機門明確不同的，是兩班不同的飛機，不能合併
function splitByGate(group){
  const byGate = new Map();
  for(const f of group){
    const k = f.gate || "";
    if(!byGate.has(k)) byGate.set(k, []);
    byGate.get(k).push(f);
  }
  if(byGate.size <= 1) return [group];
  // 沒填登機門的那幾筆併回最大的那一組，別讓它們自己單獨成行
  const rest = byGate.get("") || [];
  byGate.delete("");
  const groups = [...byGate.values()];
  if(!groups.length) return [rest];
  groups.sort((a, b) => b.length - a.length);
  groups[0].push(...rest);
  return groups;
}

function convert(text){
  const out = { departures: [], arrivals: [] };
  const table = parseCsv(text);
  if(table.length < 2) throw new Error("CSV 只有 " + table.length + " 列，抓到的不是資料");

  const at = mapColumns(table[0]);
  const get = (row, key) => at[key] === undefined ? "" : (row[at[key]] || "").trim();

  // 共掛班號（codeshare）在官方資料裡是同一架飛機拆成好幾筆：同方向、同時刻、
  // 同航點，只有班號不一樣。這裡先照 方向+時刻+航點 分組，之後合成一列。
  // 兩筆的登機門都有值又不一樣的話就當成兩班不同的飛機，不合併。
  const groups = new Map();
  const seen = new Set();
  let offDate = 0;

  for(const row of table.slice(1)){
    const kind = get(row, "kind");
    const bucket = isDeparture(kind) ? "departures" : isArrival(kind) ? "arrivals" : null;
    if(!bucket) continue;
    if(isCancelled(get(row, "status"))) continue;

    // 誤點的話，會動的是預計時間 —— 看板是拿這個時間倒數的（抵達也一樣），
    // 所以有就用它
    const useEst = !!hhmm(get(row, "est"));
    const time = hhmm(get(row, "est")) || hhmm(get(row, "sched"));
    if(!time) continue;

    // 別天的班次不要混進來（日期欄讀不出來就不判斷，寧可多留也不要整份濾空）
    const away = minutesFromNow(get(row, useEst ? "estDate" : "schedDate") ||
                                get(row, "schedDate"), time);
    if(away !== null && (away < -KEEP_BACK_MIN || away > KEEP_AHEAD_MIN)){
      offDate++;
      continue;
    }

    const code = get(row, "airline").toUpperCase().replace(/\s+/g, "");
    let num = get(row, "number").toUpperCase().replace(/\s+/g, "");
    if(code && num.startsWith(code)) num = num.slice(code.length);
    const flight = ((code ? code + " " : "") + num).slice(0, FLIGHT_N).trim();
    if(!num) continue;

    const dest = tidy(get(row, "destEn"), DEST_N) ||
                 tidy(get(row, "destZh"), DEST_N) ||
                 tidy(get(row, "destCode"), DEST_N);
    if(!dest) continue;

    const key = bucket + time + flight;
    if(seen.has(key)) continue;      // 一模一樣的重複列
    seen.add(key);

    const gate = get(row, "gate").toUpperCase().replace(/\s+/g, "");
    // 有幾個欄位有填 —— 共掛的那幾筆裡，實際執飛的通常資料最完整
    const filled = ["gate", "aircraft", "counter", "terminal"]
      .reduce((n, f) => n + (get(row, f) ? 1 : 0), 0);

    const groupKey = bucket + time + (get(row, "destCode") || dest);
    let group = groups.get(groupKey);
    if(!group){ group = []; groups.set(groupKey, group); }
    group.push({ bucket, time, flight, dest, gate, filled });
  }

  for(const group of groups.values()){
    // 登機門不同的拆開來各自成行
    for(const flights of splitByGate(group)){
      flights.sort((a, b) => b.filled - a.filled || (a.flight < b.flight ? -1 : 1));
      const lead = flights[0];
      // [時間, 班機, 目的地/來自, 登機門, 其他共掛班號]
      const others = flights.slice(1).map(f => f.flight);
      if(lead.gate.length > GATE_N){
        console.warn(`登機門「${lead.gate}」超過 ${GATE_N} 格會被切掉 —— ` +
                     `GATE_N 和 board.html 的 COLS 要一起加寬`);
      }
      const line = [lead.time, lead.flight, lead.dest, lead.gate.slice(0, GATE_N)];
      if(others.length) line.push(others);
      out[lead.bucket].push(line);
    }
  }

  if(offDate) console.log(`照日期濾掉 ${offDate} 筆（不在現在前 ${KEEP_BACK_MIN / 60} 小時到後 ${KEEP_AHEAD_MIN / 60} 小時之內）`);

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

/* 查某個班次在原始 CSV 裡長什麼樣子 —— 板上出現看不懂的班次時，這是唯一能分辨
   「官方資料就這樣寫」還是「我轉錯了」的辦法。 */
export async function findRaw(src, needle){
  const table = parseCsv(decode(await grab(src)));
  const flat = v => String(v).toUpperCase().replace(/\s+/g, "");
  const want = flat(needle);

  // 「JX721」在 CSV 裡是拆成兩欄的，中間還隔著航空公司中文名，所以整列黏起來也
  // 湊不出來。用轉檔器算班號的同一套邏輯再比一次，板上看到什麼就查得到什麼。
  let at = null;
  try{ at = mapColumns(table[0]); }catch{ /* 欄位對不到就只做逐欄比對 */ }
  const flightId = row => {
    if(!at) return "";
    const code = at.airline === undefined ? "" : (row[at.airline] || "");
    const num = at.number === undefined ? "" : (row[at.number] || "");
    return flat(code + num);
  };

  return {
    header: table[0],
    rows: table.slice(1).filter(r => r.some(v => flat(v).includes(want)) ||
                                     flightId(r).includes(want))
  };
}

/* 這份資料是哪幾天的 —— 「你是不是抓到三年前的資料」只能用資料本身回答。 */
export async function dateTally(src){
  const table = parseCsv(decode(await grab(src)));
  const at = (() => {
    const seen = table[0].map(norm);
    for(const name of FIELDS.schedDate.concat(FIELDS.estDate)){
      const i = seen.indexOf(norm(name));
      if(i !== -1) return { i, name: table[0][i].trim() };
    }
    return null;
  })();
  if(!at) return { header: table[0], column: null };

  const count = new Map();
  for(const row of table.slice(1)){
    const v = (row[at.i] || "").trim();
    count.set(v, (count.get(v) || 0) + 1);
  }
  const t = new Date(tpeNowMs());
  return {
    header: table[0],
    column: at.name,
    total: table.length - 1,
    days: [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    today: t.getUTCFullYear() + "-" + pad2(t.getUTCMonth() + 1) + "-" + pad2(t.getUTCDate())
  };
}

export { SOURCE, OUT };
