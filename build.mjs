// Builds the standalone index.html that GitHub Pages serves.
//
// src/board.html is the single source of truth. It is written as an Artifact
// fragment (no <!doctype>, <html>, <head> or <body> — those are supplied by the
// Artifact host at publish time). A file served directly by a static host needs
// them, or the browser falls back to quirks mode and the 100vh layout breaks.
//
//   node build.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(here, "src", "board.html"), "utf8");

const marker = "</style>";
const cut = src.indexOf(marker);
if (cut === -1) throw new Error("no </style> found in src/board.html");

const head = src.slice(0, cut + marker.length).trim();
const body = src.slice(cut + marker.length).trim();

const out = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="機械翻頁看板 — TPE 出境，現在往後四小時，單區 10 行。">
<meta name="color-scheme" content="dark">
${head}
</head>
<body>
${body}
</body>
</html>
`;

await writeFile(join(here, "index.html"), out, "utf8");
console.log(`index.html written (${out.length} bytes)`);
