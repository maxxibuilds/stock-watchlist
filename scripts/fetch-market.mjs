// 读取 data/universe.json 的所有代码，从 Yahoo 拉 1 年日线，
// 算出 YTD / 本月(MTD) / 近3月 收益，并保留近 6 个月收盘价用于迷你趋势图，
// 写入 data/market.json。无需 API key。本地或 GitHub Action 均可运行。
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchOne(sym, tries = 3) {
  const ys = sym.replace(/\./g, "-");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?range=1y&interval=1d`;
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
      if (r.status === 429) { await sleep(1500 * (t + 1)); continue; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res) throw new Error("no result");
      const ts = res.timestamp || [];
      const q = res.indicators?.quote?.[0]?.close || [];
      const adj = res.indicators?.adjclose?.[0]?.adjclose || q;
      const name = res.meta?.shortName || res.meta?.longName || sym;
      // 配对去空
      const pts = [];
      for (let i = 0; i < ts.length; i++) {
        const v = adj[i] ?? q[i];
        if (v != null && !isNaN(v)) pts.push({ t: ts[i] * 1000, v });
      }
      if (pts.length < 5) throw new Error("too few points");
      return { name, pts };
    } catch (e) {
      if (t === tries - 1) throw e;
      await sleep(800 * (t + 1));
    }
  }
}

function pctFrom(pts, baseIdx, lastIdx) {
  if (baseIdx < 0 || pts[baseIdx] == null) return null;
  return +(((pts[lastIdx].v / pts[baseIdx].v) - 1) * 100).toFixed(2);
}
function computeReturns(pts) {
  const last = pts.length - 1;
  const d = new Date(pts[last].t);
  const year = d.getUTCFullYear(), month = d.getUTCMonth();
  // YTD：当年第一个交易日
  let ytdBase = pts.findIndex(p => new Date(p.t).getUTCFullYear() === year);
  // MTD：上月最后一个交易日（当月首日之前的最后一个点）
  let mtdBase = -1;
  for (let i = last; i >= 0; i--) { const dt = new Date(pts[i].t); if (dt.getUTCFullYear() < year || dt.getUTCMonth() < month) { mtdBase = i; break; } }
  if (mtdBase < 0) mtdBase = pts.findIndex(p => { const dt = new Date(p.t); return dt.getUTCFullYear() === year && dt.getUTCMonth() === month; });
  // 3 月：约 91 天前最近的交易日
  const target = pts[last].t - 90 * 86400000;
  let q3Base = 0; for (let i = 0; i < pts.length; i++) { if (pts[i].t <= target) q3Base = i; else break; }
  return {
    ytd: pctFrom(pts, ytdBase, last),
    mtd: pctFrom(pts, mtdBase, last),
    q3m: pctFrom(pts, q3Base, last),
  };
}

async function pool(items, worker, conc, gap) {
  let i = 0; const fails = [];
  async function run() {
    while (i < items.length) {
      const it = items[i++];
      try { await worker(it); } catch (e) { fails.push(it + " (" + e.message + ")"); }
      if (gap) await sleep(gap);
    }
  }
  await Promise.all(Array.from({ length: conc }, run));
  return fails;
}

(async () => {
  const uni = JSON.parse(await readFile(join(ROOT, "data", "universe.json"), "utf8"));
  const syms = [...new Set(uni.sectors.flatMap(s => s.syms).concat(["SPY", "QQQ", "DIA"]))];
  console.log("symbols:", syms.length);
  const data = {};
  const fails = await pool(syms, async sym => {
    const { name, pts } = await fetchOne(sym);
    const ret = computeReturns(pts);
    const spark = pts.slice(-126).map(p => +p.v.toFixed(2));   // 近6月用于趋势图
    data[sym] = { n: name, ytd: ret.ytd, mtd: ret.mtd, q3m: ret.q3m, c: spark };
  }, 6, 120);
  const out = { updated: new Date().toISOString().slice(0, 10), count: Object.keys(data).length, data };
  await writeFile(join(ROOT, "data", "market.json"), JSON.stringify(out));
  console.log("written:", out.count, "ok /", syms.length, "  failed:", fails.length);
  if (fails.length) console.log("FAILED:", fails.join(", "));
})();
