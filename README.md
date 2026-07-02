# Max Builds 自选股看板 — 维护手册

一个**全云端、无需 API key** 的美股看板。网页只读 3 个静态数据文件，数据由 GitHub 服务器定时刷新。

- **在线地址**：https://maxxibuilds.github.io/stock-watchlist/
- **仓库**：https://github.com/maxxibuilds/stock-watchlist （GitHub 账号 `maxxibuilds`）
- **本地副本**：本机的 git 仓库目录（机器相关细节记在本地 `LOCAL.md`，已 gitignore 不入库）

> 打包带走 = 直接拷这整个文件夹，或在新电脑 `git clone`（见最后一节）。

---

## 一、文件结构

```
stock-watchlist/
├─ index.html              ← 网页本体（纯前端，只读下面的 data/*.json，不调用任何 API）
├─ .nojekyll               ← 【必须存在】关闭 GitHub Jekyll，否则部署会失败
├─ README.md               ← 本手册
├─ data/
│  ├─ universe.json        ← 【你最常改这个】板块、分组、股票清单、中文名
│  ├─ market.json          ← 自动生成：趋势图/涨跌幅(YTD/本月/近90天)/PE/名称（每天更新）
│  └─ quotes.json          ← 自动生成：实时价格+今日%（盘中每~10分钟更新）
├─ scripts/
│  ├─ fetch-quotes.mjs     ← 抓实时报价 → quotes.json（Finnhub /quote）
│  ├─ fetch-market.mjs     ← 抓历史+PE → market.json（Yahoo 日线 + Finnhub metric）
│  └─ kick-quotes.ps1      ← 本机保险丝：Windows 计划任务用它兜底拉起 quotes 循环（见"自愈机制"）
└─ .github/workflows/
   ├─ quotes.yml           ← 盘中常驻循环，每~10分钟跑 fetch-quotes
   └─ refresh.yml          ← 每天收盘后跑 fetch-market（趋势/涨跌幅/PE）
```

## 二、工作原理

- **网页(index.html)**：打开后 fetch `data/universe.json`(板块结构) + `data/market.json`(趋势/涨跌幅/PE) + `data/quotes.json`(实时价格)，渲染表格。每 60 秒自动重拉 quotes.json。**不需要 key、不调接口**。
- **价格怎么来的**：GitHub 服务器上的 `quotes.yml` 工作流盘中常驻运行，每~10分钟用密钥抓全部 ~280 只报价，提交到 `data/quotes.json`。**你关着网页它也在更新**。
- **趋势/涨跌幅/PE 怎么来的**：`refresh.yml` 每天收盘后跑一次，从 Yahoo 拉 1 年日线算出 YTD/本月/近90天 + 留近6月收盘画趋势图，并用 Finnhub 补 PE，写进 `data/market.json`。
- **API key**：你的 Finnhub key **只存在 GitHub 仓库的加密 Secret** 里（仓库 Settings → Secrets and variables → Actions → `FINNHUB_KEY`），网页和代码里都没有。免费档 60 次/分钟。

### 自愈机制（2026-07 加，解决"GitHub 定时器不触发导致数据停更"）

GitHub 的 cron 经常迟到 30–60 分钟甚至漏发，靠单班定时启动循环会开天窗。现在是四层防护：

1. **密集班次**：`quotes.yml` 定时从每小时 1 班改成 3 班（UTC :07/:27/:47），漏一班还有下一班。
2. **排队接力**：`concurrency.cancel-in-progress: false`——新班不会杀掉正在跑的循环，而是排队等它结束后无缝接棒；循环自己跑满 5h20m 或到收盘（UTC 21:00）会干净退出交棒，循环内每条命令都套了 `timeout` 防止单个 tick 卡死占坑。循环若意外挂掉，最多 ~20 分钟内被下一班自动复活。（Actions 历史里会有一些 cancelled 的排队班次，正常现象。）
3. **本机保险丝**：一台私人电脑上注册了 Windows 计划任务，交易日盘中定时调 `scripts/kick-quotes.ps1`——只在循环没在跑时才 dispatch，失败自动重试。GitHub 定时器全体失灵时靠它（任务配置和限制见本地 `LOCAL.md`）。
4. **页面自我说明**：盘中数据超 20 分钟没更新，页头显示 **"⚠ 数据延迟 N 分钟"**（橙色）；休市时间显示 **"（休市）"**——一眼分清"没开盘"和"真坏了"。休市日历硬编码到 2027 年底，之后记得在 `index.html` 里的 `MKT_HOLIDAYS` 续期。

`refresh.yml`（每日趋势/PE）也加了 UTC 23:05 备份班次，主班漏发时兜底（数据没变不会重复提交）。

## 三、日常维护（怎么改）

> 所有改动：改文件 → `git add -A && git commit -m "..." && git push` → GitHub Pages 自动重新部署（约1分钟）。看新版记得浏览器 **Ctrl+Shift+R** 强刷。

### ⚠️ 本地改了要"推回家"(push 回 GitHub)，注意这几点

1. **本地改了不 push = 线上不变**。网页跑的是 GitHub Pages 上的版本，所以改完必须 commit + push 才生效。
2. **push 前先 `git pull --rebase`（最重要！）**。云端循环任务**每 ~10 分钟自动往仓库提交一次 `data/quotes.json`**，所以 GitHub 上一直有新提交；你本地不先拉就 push 会被拒绝（non-fast-forward / “tip is behind”）。
   ```
   git pull --rebase origin main   # 动手前 & push 前各拉一次
   git add -A && git commit -m "改了xxx"
   git pull --rebase origin main   # push 前再拉一次最稳
   git push
   ```
   万一 push 还是被拒：再 `git pull --rebase origin main` 然后 `git push` 基本就好（你改的文件和机器人改的 quotes.json 不是同一个，会自动合并，不会冲突）。
3. **不要手动改 `data/quotes.json` 和 `data/market.json`**。这两个是机器人自动生成/覆盖的，你手改会被下次任务冲掉、还可能造成冲突。**只改** `data/universe.json`、`index.html`、`README.md`、`scripts/`。
4. **千万别把 Finnhub key 写进任何要提交的文件**（仓库是公开的！）。key 只放 GitHub Secret；本地测脚本用环境变量传。
5. **`.nojekyll` 不能删**（删了 GitHub 会改用 Jekyll 构建报错，改动静默不部署）。
6. **隔几天/换电脑再动手前，先 `git pull --rebase origin main` 拿最新**——因为机器人一直在推，本地副本很快就旧了，基于旧副本改容易撞车。
7. 改完等约 1 分钟 Pages 构建完，浏览器 **Ctrl+Shift+R** 才看得到新版。

### 1) 增 / 删 / 移动 股票，改板块或分组 —— 改 `data/universe.json`
- `sectors`：每个板块 `{id, name, syms:[代码...]}`。移动一只票=从一个板块的 syms 删掉、加到另一个。
- `groups`：顶部大组 `{name, ids:[板块id...]}`，控制板块怎么分行显示。
- `cn`：代码→中文名（缺了会自动用英文名兜底）。
- **改完把 `"ver"` 数字 +1**（如 3→4）——这样所有人的浏览器会重新载入新板块。
- 如果**新增了**股票代码：push 后**手动跑一次** market 工作流补它的趋势/PE：
  `gh workflow run refresh.yml --repo maxxibuilds/stock-watchlist`
  （只是移动/改名，不用跑，因为 market.json 是按代码存的，没新代码就不用重算。）

### 2) 改界面（颜色、列、布局）—— 改 `index.html`，push 即可。

### 3) 手动立刻刷新数据
- 刷实时价：`gh workflow run quotes.yml --repo maxxibuilds/stock-watchlist`
- 刷趋势/PE：`gh workflow run refresh.yml --repo maxxibuilds/stock-watchlist`

## 四、换电脑 / 打包带走

**方式 A（推荐，因为已同步在 GitHub）**：新电脑装好 `git`、`node`(18+)、`gh`(GitHub CLI) 并 `gh auth login` 登录 `maxxibuilds`，然后：
```
git clone https://github.com/maxxibuilds/stock-watchlist
```
全套（网页+数据+脚本+工作流+本手册）都在里面。**key 不用带**——它在 GitHub Secret 里，云端工作流自己用。

新电脑上记得重新注册"本机保险丝"计划任务——注册命令和参数在本地 `LOCAL.md`（不入库，记得随身带走）。

**方式 B**：直接把 `D:\Projects\stock-watchlist` 整个文件夹拷到 U 盘/新电脑即可（它含 `.git`，到新电脑还能继续 push）。

**本地手动跑脚本测试**（可选）：先设环境变量再跑（**别把 key 写进代码/提交**）：
```
# Windows PowerShell
$env:FINNHUB_KEY="你的key"; node scripts/fetch-quotes.mjs
```
本地预览网页要起个小服务器（不能直接双击，因为要 fetch data/*.json）：
```
python -m http.server 8765    # 然后浏览器开 http://localhost:8765
```

## 五、常见问题 / 坑

- **网页没更新？** 先看页头：显示"（休市）"= 没开盘，正常；显示"⚠ 数据延迟"= 流水线真出问题了。这时 Ctrl+Shift+R 强刷排除缓存，再 `gh run list --repo maxxibuilds/stock-watchlist` 看 quotes 有没有在跑，没跑就 `gh workflow run quotes.yml` 手动拉起（正常情况下"自愈机制"那四层会自动处理，很少需要人管）。
- **部署失败 / 改了不生效？** 确认 `.nojekyll` 还在（删了会触发 Jekyll 构建报错，改动静默不部署）。查 `gh api /repos/maxxibuilds/stock-watchlist/pages/builds/latest`。
- **quotes 和 refresh 不能同时跑**：两个都用同一个 key，同时跑会超 60次/分钟限流。它们时间错开了（quotes 盘中、refresh 收盘后），手动触发时注意别撞。
- **某只票没趋势图/PE**（如 MMC、FI）：Yahoo 抓不到它的历史，但实时价格正常。
- **刷新节奏**：受 GitHub 限制最快 ~10 分钟一次（Pages 每小时最多构建 10 次）。想要真 1 分钟得加 Cloudflare 中转（目前没做）。

## 六、速查

| 想干啥 | 做什么 |
|---|---|
| 看板 | https://maxxibuilds.github.io/stock-watchlist/ |
| 改股票/板块/分组 | 改 `data/universe.json`（记得 ver+1）→ push |
| 加了新股补数据 | `gh workflow run refresh.yml --repo maxxibuilds/stock-watchlist` |
| 立刻刷价格 | `gh workflow run quotes.yml --repo maxxibuilds/stock-watchlist` |
| 看任务状态 | `gh run list --repo maxxibuilds/stock-watchlist` |
| 本机保险丝 | 见本地 `LOCAL.md`（不入库） |
| 改 key | 仓库 Settings → Secrets → Actions → `FINNHUB_KEY` |
