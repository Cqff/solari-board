// TDX（交通部運輸資料流通服務）的 Air FIDS —— 目前唯一還活著的 TPE 航班來源。
//
// 桃機掛在政府開放平台上的兩份都沒在維護：即時航班凍在 2023-08-17，定期航班的
// 有效區間到 2025-11-02 為止。TDX 是官方 API，要金鑰但免費。
//
// 金鑰放環境變數，不要寫進檔案：
//   TDX_CLIENT_ID / TDX_CLIENT_SECRET
// 到 https://tdx.transportdata.tw/ 註冊 → 會員中心 → 建立應用程式就拿得到。
//
// 額度是按次計算的，所以這裡刻意只打一次：Air/FIDS/Airport/TPE 這個端點一次就
// 同時回出發和抵達。機場名稱對照表（Air/Airport）是靜態的，抓一次存到
// data/airports.json，30 天內不再抓。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AIRPORTS_CACHE = join(ROOT, "data", "airports.json");
const AIRPORTS_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export const TDX_FIDS = "https://tdx.transportdata.tw/api/basic/v2/Air/FIDS/Airport/TPE";
const TDX_AIRPORTS = "https://tdx.transportdata.tw/api/basic/v2/Air/Airport";
const TDX_TOKEN = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";

export const isTdx = url => /tdx\.transportdata\.tw/i.test(url);

export class TdxError extends Error {}

/* ---------- 金鑰與 token ---------- */

let cached = null;   // { token, until }

async function token(){
  if(cached && Date.now() < cached.until) return cached.token;

  const id = process.env.TDX_CLIENT_ID;
  const secret = process.env.TDX_CLIENT_SECRET;
  if(!id || !secret){
    throw new TdxError(
      "沒有 TDX 金鑰。到 https://tdx.transportdata.tw/ 註冊後，把金鑰放進環境變數：\n" +
      "  PowerShell:  $env:TDX_CLIENT_ID=\"...\"; $env:TDX_CLIENT_SECRET=\"...\"\n" +
      "  bash:        export TDX_CLIENT_ID=... TDX_CLIENT_SECRET=...\n" +
      "要長期跑的話寫進系統環境變數，不要寫進專案檔案裡。");
  }

  const res = await fetch(TDX_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
    signal: AbortSignal.timeout(30000)
  });
  const body = await res.json().catch(() => ({}));
  if(!res.ok || !body.access_token){
    throw new TdxError("換 token 失敗（HTTP " + res.status + "）：" +
                       (body.error_description || body.error || "沒有回 access_token") +
                       "\n金鑰打錯或應用程式沒啟用的話會是這個錯誤。");
  }
  // 提早兩分鐘過期，免得剛好卡在邊界
  cached = { token: body.access_token, until: Date.now() + ((body.expires_in || 86400) - 120) * 1000 };
  return cached.token;
}

async function get(url){
  const res = await fetch(url, {
    headers: { authorization: "Bearer " + (await token()), "accept-encoding": "gzip" },
    signal: AbortSignal.timeout(45000)
  });
  if(res.status === 429){
    throw new TdxError("TDX 回 429：今天的額度用完了。把 serve.mjs 的 --every 調大" +
                       "（額度 ÷ 1440 分鐘 = 最短間隔），或升級會員等級。");
  }
  if(!res.ok) throw new TdxError("TDX 回 HTTP " + res.status + "：" + (await res.text()).slice(0, 200));
  return res.json();
}

/* ---------- 機場代碼 → 名稱 ---------- */
// FIDS 只給 IATA 代碼（NRT），板上要的是看得懂的名字（TOKYO NARITA）。
// 這份是靜態資料，抓一次存起來，不要每輪都花額度。

async function airportNames(){
  try{
    const cache = JSON.parse(await readFile(AIRPORTS_CACHE, "utf8"));
    if(Date.now() - new Date(cache.fetched).getTime() < AIRPORTS_MAX_AGE) return cache.names;
  }catch{}

  const list = await get(TDX_AIRPORTS + "?$format=JSON");
  const names = {};
  for(const a of (Array.isArray(list) ? list : list.Airports || [])){
    const code = a.AirportIATA || a.AirportID || a.IATA;
    const en = a.AirportName?.En || a.AirportNameEn || a.AirportEnglishName;
    if(code && en) names[String(code).toUpperCase()] = en;
  }
  await mkdir(dirname(AIRPORTS_CACHE), { recursive: true });
  await writeFile(AIRPORTS_CACHE, JSON.stringify({ fetched: new Date().toISOString(), names }, null, 1), "utf8");
  return names;
}

/* ---------- FIDS ---------- */

// TDX 的鍵名可能改版，所以一律用別名清單找，找不到就把實際的鍵印出來
const KEYS = {
  airline:    ["AirlineID", "AirlineCode"],
  number:     ["FlightNumber", "FlightNo"],
  depAirport: ["DepartureAirportID", "DepartureAirport"],
  arrAirport: ["ArrivalAirportID", "ArrivalAirport"],
  schedDep:   ["ScheduleDepartureTime", "ScheduledDepartureTime"],
  estDep:     ["EstimatedDepartureTime", "ExpectDepartureTime"],
  actDep:     ["ActualDepartureTime"],
  schedArr:   ["ScheduleArrivalTime", "ScheduledArrivalTime"],
  estArr:     ["EstimatedArrivalTime", "ExpectArrivalTime"],
  actArr:     ["ActualArrivalTime"],
  gate:       ["Gate", "GateID", "GateName"],
  terminal:   ["Terminal", "TerminalID"],
  counter:    ["CheckCounter", "CheckInCounter", "CheckCounterID"],
  aircraft:   ["AcType", "AircraftType"],
  codeShare:  ["CodeShare", "CodeShareFlight"]
};

const pick = (obj, names) => {
  for(const n of names) if(obj[n] !== undefined && obj[n] !== null && obj[n] !== "") return obj[n];
  return "";
};

// "2026-08-27T10:20:00+08:00" → { date:"2026-08-27", time:"10:20" }
function when(v){
  const m = String(v || "").match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  return m ? { date: m[1], time: m[2] + ":" + m[3] } : null;
}

/* 抓一次 FIDS，轉成跟 CSV 那條路一樣的中間格式。
   回傳 { records, keys } —— keys 是實際看到的欄位名，對不到時要印出來。 */
export async function tdxRecords(url = TDX_FIDS){
  const sep = url.includes("?") ? "&" : "?";
  const list = await get(url + sep + "$format=JSON");
  const rows = Array.isArray(list) ? list : (list.FIDS || list.data || []);
  if(!rows.length) return { records: [], keys: [], raw: rows };

  const keys = Object.keys(rows[0]);
  if(!pick(rows[0], KEYS.number)){
    throw new TdxError(
      "TDX 回的資料裡找不到班號欄位。實際的欄位名是：\n  " + keys.join(", ") +
      "\n把這行貼給我，我改 tools/tdx.mjs 的 KEYS 對照。");
  }

  const names = await airportNames().catch(() => ({}));
  const records = [];

  for(const row of rows){
    const dep = String(pick(row, KEYS.depAirport) || "").toUpperCase();
    const arr = String(pick(row, KEYS.arrAirport) || "").toUpperCase();

    // TPE 是出發地就是出發，是目的地就是抵達；兩邊都沒寫就看有哪組時間
    let bucket, other, t, sched;
    if(dep === "TPE" || (!dep && !arr && pick(row, KEYS.schedDep))){
      bucket = "departures";
      other = arr;
      sched = when(pick(row, KEYS.schedDep));
      t = when(pick(row, KEYS.estDep)) || when(pick(row, KEYS.actDep)) || sched;
    }else if(arr === "TPE"){
      bucket = "arrivals";
      other = dep;
      sched = when(pick(row, KEYS.schedArr));
      t = when(pick(row, KEYS.estArr)) || when(pick(row, KEYS.actArr)) || sched;
    }else{
      continue;
    }
    if(!t || !other) continue;

    const code = String(pick(row, KEYS.airline) || "").toUpperCase();
    let num = String(pick(row, KEYS.number) || "").toUpperCase().replace(/\s+/g, "");
    if(code && num.startsWith(code)) num = num.slice(code.length);
    if(!num) continue;

    const gate = String(pick(row, KEYS.gate) || "").toUpperCase().replace(/\s+/g, "");
    const filled = [KEYS.gate, KEYS.aircraft, KEYS.counter, KEYS.terminal]
      .reduce((n, k) => n + (pick(row, k) ? 1 : 0), 0);

    records.push({
      bucket,
      date: t.date,
      time: t.time,
      // 共掛的那幾筆常常只有表訂時間，執飛的那筆才有預計時間 —— 分組用表訂的，
      // 不然一誤點就會把同一架飛機拆成兩列
      schedTime: (sched || t).time,
      flight: ((code ? code + " " : "") + num).trim(),
      destKey: other,
      dest: (names[other] || other).toUpperCase(),
      gate,
      filled
    });
  }
  return { records, keys, raw: rows };
}
