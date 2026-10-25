# rotavox.ps1 — operate the Rotavox services on the broadcast box.
#
#   .\tools\rotavox.ps1 status            services, heartbeat age, last log lines
#   .\tools\rotavox.ps1 restart [svc]     all three in a safe order, or one: runner | watchdog | web
#   .\tools\rotavox.ps1 stop [svc]        stop (all = watchdog first, so it can't fail over to AutoDJ mid-stop)
#   .\tools\rotavox.ps1 start [svc]
#   .\tools\rotavox.ps1 logs [svc] [-Follow]
#   .\tools\rotavox.ps1 update [-NoPull]  deploy what's on GitHub: pull, deps, migrate, build, restart
#
# Stopping the runner without the watchdog hands playout to AutoDJ within ~20s; that is
# the fail-safe working, not a fault. Needs elevation unless tools\install-services.ps1
# was run with -OperatorUser for this account.
param(
  [Parameter(Position = 0)][ValidateSet('status', 'start', 'stop', 'restart', 'logs', 'update')][string]$Command = 'status',
  [Parameter(Position = 1)][ValidateSet('all', 'runner', 'watchdog', 'web')][string]$Service = 'all',
  [switch]$Follow,
  [switch]$NoPull
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Names = @{ runner = 'RotavoxRunner'; watchdog = 'RotavoxWatchdog'; web = 'RotavoxWeb' }
$Heartbeat = Join-Path $Root 'apps\runner\runner.heartbeat'

function HeartbeatAgeSeconds {
  try { [int](([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [long](Get-Content $Heartbeat -Raw)) / 1000) } catch { $null }
}

function WaitForHeartbeat([int]$TimeoutSeconds = 60) {
  $since = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
    try { if ([long](Get-Content $Heartbeat -Raw) -gt $since) { return $true } } catch {}
    Start-Sleep 1
  }
  return $false
}

# Native commands don't throw on a non-zero exit, even with ErrorActionPreference Stop.
function Run([string]$What, [scriptblock]$Cmd) {
  Write-Host "`n== $What" -ForegroundColor Cyan
  & $Cmd
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE). Nothing after it ran; the services are as they were unless noted above." }
}

function Targets { if ($Service -eq 'all') { 'watchdog', 'runner', 'web' } else { $Service } }

function Restart-All {
  # Watchdog down first so a runner restart isn't mistaken for a dead pacer, then back
  # up only once the new runner is heartbeating.
  Stop-Service $Names.watchdog
  Restart-Service $Names.runner
  if (WaitForHeartbeat) { 'RotavoxRunner restarted, heartbeat fresh' } else { Write-Warning 'RotavoxRunner has not written a heartbeat in 60s; check: .\tools\rotavox.ps1 logs runner' }
  Start-Service $Names.watchdog; 'RotavoxWatchdog started'
}

switch ($Command) {
  'status' {
    foreach ($k in 'runner', 'watchdog', 'web') {
      $svc = Get-Service $Names[$k] -ErrorAction SilentlyContinue
      '{0,-16} {1}' -f $Names[$k], $(if ($svc) { $svc.Status } else { 'NOT INSTALLED' })
    }
    $age = HeartbeatAgeSeconds
    "heartbeat        " + $(if ($null -eq $age) { "unreadable ($Heartbeat)" } else { "$age s old" + $(if ($age -gt 20) { '  <-- STALE: the watchdog will hand playout to AutoDJ' }) })
    ''
    Get-Content (Join-Path $Root 'logs\RotavoxRunner.log') -Tail 8 -Encoding UTF8 -ErrorAction SilentlyContinue
  }
  'logs' {
    $k = if ($Service -eq 'all') { 'runner' } else { $Service }
    Get-Content (Join-Path $Root "logs\$($Names[$k]).log") -Tail 50 -Wait:$Follow -Encoding UTF8
  }
  'stop' { foreach ($k in Targets) { Stop-Service $Names[$k]; "$($Names[$k]) stopped" } }
  'start' {
    # Runner before watchdog, so the watchdog's first look finds a fresh heartbeat.
    foreach ($k in @(Targets) | Sort-Object { @('runner', 'watchdog', 'web').IndexOf($_) }) { Start-Service $Names[$k]; "$($Names[$k]) started" }
  }
  'restart' {
    if ($Service -eq 'all' -or $Service -eq 'runner') { Restart-All } elseif ($Service -eq 'watchdog') { Restart-Service $Names.watchdog; 'RotavoxWatchdog restarted' }
    if ($Service -eq 'all' -or $Service -eq 'web') { Restart-Service $Names.web; 'RotavoxWeb restarted' }
  }
  'update' {
    # The whole routine deploy, in the one safe order. Safe to re-run: every step is
    # idempotent, and a failed step stops before the restart, leaving the old code running.
    # One-off steps a release asks for (a station seed, say) stay manual: a seed rewrites
    # data the UI owns, so it must never run on every update.
    Push-Location $Root
    try {
      if (git status --porcelain --untracked-files=no) {
        throw "This checkout has local edits to tracked files (git status). Commit or discard them first; update only deploys what's on GitHub."
      }
      $before = git rev-parse HEAD
      if (-not $NoPull) { Run 'Pull from GitHub' { git pull --ff-only } }
      $after = git rev-parse HEAD
      if ($before -eq $after) { "Already at $($after.Substring(0, 7)); rebuilding and restarting anyway." }
      else { git log --oneline "$before..$after" }

      $lockChanged = $before -ne $after -and (git diff --name-only $before $after -- package-lock.json)
      if ($lockChanged -or -not (Test-Path (Join-Path $Root 'node_modules'))) {
        # npm ci replaces node_modules, which the running services load from. Stop them
        # first; the runner's stop hands playout back to AutoDJ until the restart below.
        Write-Host "`n== Dependencies changed: stopping services (AutoDJ covers playout meanwhile)" -ForegroundColor Cyan
        foreach ($k in 'watchdog', 'runner', 'web') { Stop-Service $Names[$k] }
        Run 'Install dependencies' { npm ci }
      }
      Run 'Migrate the database' { npm run migrate -w @rotavox/schema }
      # The web app is briefly unavailable while this replaces its build; playout is not.
      Run 'Build the web app' { npm run build -w @rotavox/web }

      Write-Host "`n== Restart" -ForegroundColor Cyan
      Restart-All
      Restart-Service $Names.web; 'RotavoxWeb restarted'
      "`nDeployed $(git log --oneline -1)"
    } finally { Pop-Location }
  }
}
