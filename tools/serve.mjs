// 本地端跑看板：一邊把板面服務出來，一邊定時去抓官方班表。
//
//   node tools/serve.mjs                       # http://localhost:8080，每 10 分鐘更新
//   node tools/serve.mjs --port 9000 --every 5
//   node tools/serve.mjs --source some.csv     # 吃本地 CSV，不連網（測用）
//
// 開起來之後瀏覽器連上去按 F 全螢幕就可以掛牆了。看板自己每 5 分鐘會回頭抓一次
// data/timetable.json，所以不用重新整理，這支寫進去多久就會反映上板。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTimetable, writeTimetable, FetchFailed, SOURCE } from "./timetable.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback){
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg("port", process.env.PORT || 8080));
const EVERY = Number(arg("every", 10)) * 60 * 1000;
const SRC = arg("source", SOURCE);

/* ---------- 定時更新 ---------- */

const clock = () => new Date().toTimeString().slice(0, 8);

async function refresh(){
  try{
    const rows = await fetchTimetable(SRC);
    const changed = await writeTimetable(rows);
    console.log(changed
      ? `[${clock()}] 班表更新：${rows.length} 筆，${rows[0][0]} – ${rows[rows.length - 1][0]}`
      : `[${clock()}] 班表沒變（${rows.length} 筆）`);
  }catch(err){
    // 抓不到就留著上一版 —— 看板寧可顯示舊班表也不要開天窗
    console.warn(`[${clock()}] ${err.message}` +
                 (err instanceof FetchFailed ? "，留著上一版，等下一輪" : ""));
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
