// 探測某個網址能不能當班表來源 —— 這台機器連不連得到、回的是不是航班資料。
//
//   node tools/probe-source.mjs https://www.taoyuan-airport.com/flight_depart
//   node tools/probe-source.mjs                      # 不給網址就測目前的來源
//   node tools/probe-source.mjs <網址> --sample      # 把表格的樣子印出來
//
// 會回答三件事：
//   1. 連得到嗎（還是被 Cloudflare 之類的擋下來）
//   2. 回的是 HTML 還是資料檔
//   3. 內容裡看不看得到班號和時刻 —— 看不到的話通常表示資料是 JS 另外抓的，
//      那就得找它背後真正的網址，光抓這一頁沒有用
//
// 純 Node，不裝任何東西。

import { SOURCE } from "./timetable.mjs";

const argv = process.argv.slice(2);
const sample = argv.includes("--sample");
const url = argv.find(a => !a.startsWith("--")) || SOURCE;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// 不用 process.exit()：Node 在 Windows 上會在連線還沒收乾淨時炸出 libuv 的
// assertion（Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)）。用 return
// 加 process.exitCode，讓它自己把 socket 收完再結束。
await main();

async function main(){
console.log("測試：" + url + "\n");

let res, body;
try{
  res = await fetch(url, {
    headers: {
      "user-agent": UA,
      "accept": "text/html,application/xhtml+xml,application/json,text/csv,*/*",
      "accept-language": "zh-TW,zh;q=0.9,en;q=0.8"
    },
    signal: AbortSignal.timeout(45000)
  });
  body = Buffer.from(await res.arrayBuffer());
}catch(err){
  console.log("連不到：" + err.message);
  console.log("\n→ 這台機器到不了這個網址（防火牆、DNS、或對方直接斷線）。");
  process.exitCode = 1;
  return;
}

const text = new TextDecoder("utf-8").decode(body);
const type = (res.headers.get("content-type") || "").split(";")[0];
console.log(`HTTP ${res.status} · ${type || "(沒有 content-type)"} · ${body.length} bytes`);

const blocked = /just a moment|cf-browser-verification|challenge-platform|attention required/i.test(text);
if(res.status === 403 || blocked){
  console.log("\n→ 被擋下來了（看起來是 Cloudflare 的瀏覽器驗證）。");
  console.log("  純 Node 抓不到這種頁面，要嘛換來源，要嘛開真的瀏覽器去抓。");
  console.log("  注意：Cloudflare 常常是間歇性的 —— 同一個網址上一次過、這一次被擋，");
  console.log("  就表示它不適合當每幾分鐘抓一次的來源。");
  process.exitCode = 2;
  return;
}
if(!res.ok){
  console.log(`\n→ 對方回 ${res.status}，不是可用的來源。`);
  process.exitCode = 2;
  return;
}

// 內容裡有沒有航班的樣子：班號（兩碼英數 + 2~4 位數字）和 HH:MM
const flights = [...new Set(text.match(/\b[A-Z0-9]{2}\s?\d{2,4}\b/g) || [])];
const times = [...new Set(text.match(/\b[0-2]\d:[0-5]\d\b/g) || [])];
console.log(`內容裡看得到 ${flights.length} 個像班號的字串、${times.length} 個像時刻的字串`);
if(flights.length) console.log("  班號樣本：" + flights.slice(0, 8).join(", "));
if(times.length) console.log("  時刻樣本：" + times.slice(0, 8).join(", "));

if(flights.length >= 10 && times.length >= 10){
  if(!sample) console.log("\n→ 這一頁本身就帶著班表，可以直接抓。" +
                          "再跑一次加 --sample，把表格的樣子印出來給我。");
}else if(/<html/i.test(text)){
  console.log("\n→ 連得到，但班表不在這一頁的原始碼裡 —— 多半是 JS 另外去抓的。");
  console.log("  在瀏覽器按 F12 → Network → 重新整理，找回傳 JSON 的那個請求，");
  console.log("  把它的網址貼給我，直接抓那個才有意義。");
}else{
  console.log("\n→ 拿到的是資料檔而不是網頁。把這段輸出貼給我。");
}

if(sample) showSample(text);
}

/* 把表格的樣子印出來 —— 我看不到你機器上的網頁，要寫解析就得知道欄位怎麼排。
   輸出刻意壓得很小，方便直接貼。 */
function showSample(html){
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
                    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const cells = block => [...block.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
    .map(m => m[1].replace(/<[^>]+>/g, " ")
                  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
                  .replace(/\s+/g, " ").trim());

  const rows = [...clean.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(m => cells(m[1])).filter(r => r.some(c => c));

  console.log("\n──────── 表格樣本 ────────");
  console.log(`<table> ${(clean.match(/<table/gi) || []).length} 個，<tr> ${rows.length} 列`);

  if(rows.length){
    const head = rows.find(r => r.length > 2 && !r.some(c => /^\d{1,2}:\d{2}$/.test(c)));
    if(head) console.log("\n表頭：" + head.join(" | "));
    const data = rows.filter(r => r.some(c => /\d{1,2}:\d{2}/.test(c))).slice(0, 4);
    data.forEach((r, i) => console.log(`第 ${i + 1} 列：` + r.join(" | ")));
    console.log("\n→ 把「表頭」和這幾列貼給我就夠了。");
    return;
  }

  // 沒有 <table>，那就直接看時刻附近的原始碼長怎樣
  const at = [...clean.matchAll(/\b[0-2]\d:[0-5]\d\b/g)].map(m => m.index);
  if(!at.length){ console.log("找不到時刻字串，沒辦法取樣。"); return; }
  const i = at[Math.min(2, at.length - 1)];
  console.log("\n沒有 <table>，以下是某個時刻前後的原始碼：\n");
  console.log(clean.slice(Math.max(0, i - 500), i + 500).replace(/\s+/g, " "));
  console.log("\n→ 把這段貼給我。");
}
