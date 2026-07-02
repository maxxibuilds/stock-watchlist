# 本机保险丝：GitHub 定时器全体失灵时，从本机拉起 quotes 循环。
# 由 Windows 计划任务在交易日盘中定时调用（注册方法见本地 LOCAL.md，不入库）。
# 只在 交易日 + 盘中(美东 9:25–16:00) + 循环没在跑也没在排队 时才 dispatch，其余情况直接退出。
$repo = "maxxibuilds/stock-watchlist"
$gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) { $gh = (Get-Command gh -ErrorAction SilentlyContinue).Source }
if (-not $gh) { Write-Output "gh not found"; exit 1 }

$et = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, "Eastern Standard Time")
$mins = $et.Hour * 60 + $et.Minute
if ($et.DayOfWeek -in @("Saturday","Sunday") -or $mins -lt 565 -or $mins -ge 960) {
    Write-Output "non-trading hours (ET $($et.ToString('ddd HH:mm'))), skip"; exit 0
}

$runs = & $gh run list -R $repo --workflow quotes.yml --limit 5 --json status | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { Write-Output "gh run list failed (network not ready?), exit 1 so Task Scheduler retries"; exit 1 }
$alive = @($runs | Where-Object { $_.status -in @("in_progress","queued","requested","waiting","pending") })
if ($alive.Count -gt 0) { Write-Output "loop alive ($($alive.Count) run), nothing to do"; exit 0 }

& $gh workflow run quotes.yml -R $repo
if ($LASTEXITCODE -ne 0) { Write-Output "dispatch failed, exit 1 so Task Scheduler retries"; exit 1 }
Write-Output "kicked quotes loop at ET $($et.ToString('HH:mm'))"
