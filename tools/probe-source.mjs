// 探測某個網址能不能當班表來源 —— 這台機器連不連得到、回的是不是航班資料。
//
//   node tools/probe-source.mjs https://www.taoyuan-airport.com/flight_depart
//   node tools/probe-source.mjs                      # 不給網址就測目前的來源
//
// 會回答三件事：
//   1. 連得到嗎（還是被 Cloudflare 之類的擋下來）
//   2. 回的是 HTML 還是資料檔
//   3. 內容裡看不看得到班號和時刻 —— 看不到的話通常表示資料是 JS 另外抓的，
//      那就得找它背後真正的網址，光抓這一頁沒有用
//
// 純 Node，不裝任何東西。

import { SOURCE } from "./timetable.mjs";

const url = process.argv[2] || SOURCE;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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
  process.exit(1);
}

const text = new TextDecoder("utf-8").decode(body);
const type = (res.headers.get("content-type") || "").split(";")[0];
console.log(`HTTP ${res.status} · ${type || "(沒有 content-type)"} · ${body.length} bytes`);

const blocked = /just a moment|cf-browser-verification|challenge-platform|attention required/i.test(text);
if(res.status === 403 || blocked){
  console.log("\n→ 被擋下來了（看起來是 Cloudflare 的瀏覽器驗證）。");
  console.log("  純 Node 抓不到這種頁面，要嘛換來源，要嘛開真的瀏覽器去抓。");
  process.exit(2);
}
if(!res.ok){
  console.log(`\n→ 對方回 ${res.status}，不是可用的來源。`);
  process.exit(2);
}

// 內容裡有沒有航班的樣子：班號（兩碼英數 + 2~4 位數字）和 HH:MM
const flights = [...new Set(text.match(/\b[A-Z0-9]{2}\s?\d{2,4}\b/g) || [])];
const times = [...new Set(text.match(/\b[0-2]\d:[0-5]\d\b/g) || [])];
console.log(`內容裡看得到 ${flights.length} 個像班號的字串、${times.length} 個像時刻的字串`);
if(flights.length) console.log("  班號樣本：" + flights.slice(0, 8).join(", "));
if(times.length) console.log("  時刻樣本：" + times.slice(0, 8).join(", "));

if(flights.length >= 10 && times.length >= 10){
  console.log("\n→ 這一頁本身就帶著班表，可以直接抓。把這段輸出貼給我，我來寫解析。");
}else if(/<html/i.test(text)){
  console.log("\n→ 連得到，但班表不在這一頁的原始碼裡 —— 多半是 JS 另外去抓的。");
  console.log("  在瀏覽器按 F12 → Network → 重新整理，找回傳 JSON 的那個請求，");
  console.log("  把它的網址貼給我，直接抓那個才有意義。");
}else{
  console.log("\n→ 拿到的是資料檔而不是網頁。把這段輸出貼給我。");
}
