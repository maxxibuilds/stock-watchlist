// 服务器端：用 FINNHUB_KEY 抓全部代码的实时报价(价格+今日%)，写 data/quotes.json。
// 按 ~55/分钟限速，280 多只约 5 分钟跑完。由 GitHub Action 定时运行。
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.FINNHUB_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function quote(sym, tries = 4) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${KEY}`);
      if (r.status === 429) { await sleep(2000 * (t + 1)); continue; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { if (t === tries - 1) throw e; await sleep(1000); }
  }
}

(async () => {
  if (!KEY) { console.error("missing FINNHUB_KEY"); process.exit(1); }
  const uni = JSON.parse(await readFile(join(ROOT, "data", "universe.json"), "utf8"));
  const syms = [...new Set(uni.sectors.flatMap(s => s.syms))];
  const idxSyms = ["SPY", "QQQ", "DIA"];
  const data = {}, idx = {};
  let ok = 0, fail = 0;
  for (const s of [...syms, ...idxSyms]) {
    try {
      const q = await quote(s);
      const rec = { p: q.c, d: q.dp };
      if (idxSyms.includes(s)) idx[s] = rec; else data[s] = rec;
      ok++;
    } catch (e) { fail++; }
    await sleep(1100);                 // ~55/min，安全低于 60
  }
  const out = { updated: new Date().toISOString(), ts: Date.now(), data, idx };
  await writeFile(join(ROOT, "data", "quotes.json"), JSON.stringify(out));
  console.log(`quotes: ${ok} ok / ${fail} fail`);
})();
