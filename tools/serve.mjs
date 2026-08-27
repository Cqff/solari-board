// 本地端跑看板：一邊把板面服務出來，一邊定時去抓官方班表。
//
//   node tools/serve.mjs                       # http://localhost:8080，每 3 分鐘更新
//   node tools/serve.mjs --port 9000 --every 5
//   node tools/serve.mjs --source some.csv     # 吃本地 CSV，不連網（測用）
//
// 開起來之後瀏覽器連上去按 F 全螢幕就可以掛牆了。看板自己每 2 分鐘會回頭抓一次
// data/timetable.json，所以不用重新整理，這支寫進去多久就會反映上板。
//
// 官方那份即時航班每 5 分鐘更新一次，這裡設 3 分鐘是為了不要卡在它的更新邊上 —
// 抓比它快沒有壞處，那支 CSV 沒變的話連檔案都不會動。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTimetable, writeTimetable, FetchFailed, SOURCE, OUT } from "./timetable.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback){
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg("port", process.env.PORT || 8080));
const EVERY = Number(arg("every", 3)) * 60 * 1000;
const SRC = arg("source", SOURCE);

/* ---------- 定時更新 ---------- */

const clock = () => new Date().toTimeString().slice(0, 8);

async function refresh(){
  try{
    const table = await fetchTimetable(SRC);
    const changed = await writeTimetable(table);
    const tally = `出發 ${table.departures.length} 筆、抵達 ${table.arrivals.length} 筆`;
    console.log(changed ? `[${clock()}] 班表更新：${tally}`
                        : `[${clock()}] 班表沒變（${tally}）`);
  }catch(err){
    // 抓不到就留著上一版 —— 看板寧可顯示舊班表也不要開天窗
    console.warn(`[${clock()}] ${err.message}` +
                 (err instanceof FetchFailed ? "，等下一輪" : ""));
    if(!existsSync(OUT)){
      console.warn("      還沒有 data/timetable.json，看板現在用的是內建示範班表" +
                   "（一天七十幾班，真的 TPE 三百多班）。板面左下角會寫 SAMPLE TIMETABLE。");
    }
  }
}

/* ---------- 靜態檔 ---------- */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".svg":  "image/svg+xml"
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const rel = normalize(path === "/" ? "index.html" : path.replace(/^\/+/, ""));

  // normalize 之後還往上跳的一律擋掉
  if(rel.startsWith("..") || rel.startsWith(sep)){
    res.writeHead(403).end("forbidden");
    return;
  }

  try{
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, {
      "content-type": TYPES[extname(rel)] || "application/octet-stream",
      // 班表是會變的，別讓瀏覽器留著舊的
      "cache-control": "no-store"
    }).end(body);
  }catch{
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404");
  }
});

server.listen(PORT, () => {
  console.log(`看板  http://localhost:${PORT}`);
  console.log(`班表  每 ${EVERY / 60000} 分鐘更新一次`);
  console.log(`來源  ${SRC}`);
  console.log("");
  refresh();
  setInterval(refresh, EVERY);
});
