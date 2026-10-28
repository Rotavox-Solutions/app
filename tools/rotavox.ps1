# rotavox.ps1 — operate the Rotavox services on the broadcast box.
#
#   .\tools\rotavox.ps1 status            services, heartbeat age, last log lines
#   .\tools\rotavox.ps1 restart [svc]     all three in a safe order, or one: runner | watchdog | web
#   .\tools\rotavox.ps1 stop [svc]        stop (all = watchdog first, so it can't fail over to AutoDJ mid-stop)
#   .\tools\rotavox.ps1 start [svc]
#   .\tools\rotavox.ps1 logs [svc] [-Follow]
#   .\tools\rotavox.ps1 update [-NoPull]  deploy what's on GitHub: pull, deps, migrate, build, restart
#   .\tools\rotavox.ps1 update -Revision <sha>   the same, to one commit on GitHub's main (fast-forward only)
#   .\tools\rotavox.ps1 self-update      run by the "Rotavox Update" task when staff update the Runner from
#                                         Rotavox's staff console; not for typing (see below)
#
# Stopping the runner without the watchdog hands playout to AutoDJ within ~20s; that is
# the fail-safe working, not a fault. Needs elevation unless tools\install-services.ps1
# was run with -OperatorUser for this account.
param(
  [Parameter(Position = 0)][ValidateSet('status', 'start', 'stop', 'restart', 'logs', 'update', 'self-update')][string]$Command = 'status',
  [Parameter(Position = 1)][ValidateSet('all', 'runner', 'watchdog', 'web')][string]$Service = 'all',
  [switch]$Follow,
  [switch]$NoPull,
  [ValidatePattern('^[0-9a-f]{7,40}$')][string]$Revision,
  [switch]$NoRestart
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

# Since the cloud cutover (DEPLOY-CLOUD.md) the web app and its database live at
# app.rotavox.com and RotavoxWeb is disabled here; a box like that only runs the runner.
function WebHere { (Get-Service $Names.web -ErrorAction SilentlyContinue).StartType -ne 'Disabled' }

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
    foreach ($k in @(Targets) | Sort-Object { @('runner', 'watchdog', 'web').IndexOf($_) }) {
      if ($k -eq 'web' -and -not (WebHere)) { 'RotavoxWeb is disabled (the web app runs in the cloud); not started'; continue }
      Start-Service $Names[$k]; "$($Names[$k]) started"
    }
  }
  'restart' {
    if ($Service -eq 'all' -or $Service -eq 'runner') { Restart-All } elseif ($Service -eq 'watchdog') { Restart-Service $Names.watchdog; 'RotavoxWatchdog restarted' }
    if (($Service -eq 'all' -or $Service -eq 'web') -and (WebHere)) { Restart-Service $Names.web; 'RotavoxWeb restarted' }
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
      if ($Revision) {
        # Only ever forward, and only to what GitHub's main holds: the revision comes from
        # Rotavox, but the code comes from GitHub, so Rotavox can't hand a box code of its own.
        Run 'Fetch from GitHub' { git fetch --quiet origin }
        $target = git rev-parse --verify --quiet "$Revision^{commit}"
        if (-not $target) { throw "Commit $Revision isn't on GitHub. Push it, then update again. Nothing changed." }
        git merge-base --is-ancestor $target origin/main
        if ($LASTEXITCODE -ne 0) { throw "Commit $Revision isn't on GitHub's main branch, and the box only takes commits from there. Nothing changed." }
        git merge-base --is-ancestor $before $target
        if ($LASTEXITCODE -ne 0) { throw "This box is at $($before.Substring(0, 7)), which $Revision doesn't include: the box is ahead of it, or has diverged. Nothing changed." }
        Run "Move to $Revision" { git merge --ff-only --quiet $target }
      } elseif (-not $NoPull) { Run 'Pull from GitHub' { git pull --ff-only } }
      $after = git rev-parse HEAD
      if ($before -eq $after) { "Already at $($after.Substring(0, 7)); rebuilding and restarting anyway." }
      else { git log --oneline "$before..$after" }

      $lockChanged = $before -ne $after -and (git diff --name-only $before $after -- package-lock.json)
      if ($lockChanged -or -not (Test-Path (Join-Path $Root 'node_modules'))) {
        # npm ci replaces node_modules, which the running services load from. Stop them
        # first; the runner's stop hands playout back to AutoDJ until the restart below.
        Write-Host "`n== Dependencies changed: stopping services (AutoDJ covers playout meanwhile)" -ForegroundColor Cyan
        foreach ($k in 'watchdog', 'runner', 'web') { if ($k -ne 'web' -or (WebHere)) { Stop-Service $Names[$k] } }
        Run 'Install dependencies' { npm ci }
      }
      if (WebHere) {
        Run 'Migrate the database' { npm run migrate -w @rotavox/schema }
        # The web app is briefly unavailable while this replaces its build; playout is not.
        Run 'Build the web app' { npm run build -w @rotavox/web }
      } else { "`nRotavoxWeb is disabled: the web app and database are in the cloud (tools/cloud/cloud.sh deploy). Updating the runner only." }

      if ($NoRestart) { "`nReady at $(git log --oneline -1); not restarted (-NoRestart)."; return }
      Write-Host "`n== Restart" -ForegroundColor Cyan
      Restart-All
      if (WebHere) { Restart-Service $Names.web; 'RotavoxWeb restarted' }
      "`nDeployed $(git log --oneline -1)"
    } finally { Pop-Location }
  }
  'self-update' {
    # Staff press "Update Runner" in Rotavox; the Runner writes what to update to in
    # runner-update.json and starts the "Rotavox Update" scheduled task (install-services.ps1),
    # which runs this as SYSTEM. It has to be a task: the update restarts the Runner, and
    # NSSM would take anything the Runner started down with it.
    #
    # The update runs in a child PowerShell, so its whole output lands in the log however it
    # ends. The services restart only after the result is written, so the new Runner finds
    # it at startup and reports the job; if the update failed, the services are started
    # again on whatever code is there, and the old Runner, still waiting, reports it.
    $request = Join-Path $Root 'apps\runner\runner-update.json'
    $result = Join-Path $Root 'apps\runner\runner-update-result.json'
    $log = Join-Path $Root 'logs\RotavoxUpdate.log'
    if (-not (Test-Path $request)) { 'No update was requested.'; return }
    $ask = Get-Content $request -Raw | ConvertFrom-Json
    Remove-Item $request
    # SYSTEM doesn't own the checkout, and must never wait on a sign-in prompt nobody sees.
    $env:GIT_CONFIG_COUNT = '1'; $env:GIT_CONFIG_KEY_0 = 'safe.directory'; $env:GIT_CONFIG_VALUE_0 = '*'
    $env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
    $ok = $false
    try {
      if ("$($ask.revision)" -notmatch '^[0-9a-f]{7,40}$') { throw "Refused: '$($ask.revision)' isn't a commit id." }
      $errLog = "$log.err"
      $p = Start-Process powershell.exe -Wait -PassThru -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError $errLog `
        -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", 'update', '-Revision', $ask.revision, '-NoRestart'
      Add-Content $log (Get-Content $errLog -Raw -ErrorAction SilentlyContinue); Remove-Item $errLog -ErrorAction SilentlyContinue
      $ok = $p.ExitCode -eq 0
      $summary = if ($ok) { "Updated to $($ask.revision.Substring(0, 7))" } else {
        $why = @(Get-Content $log | Where-Object { $_ -match '\S' -and $_ -notmatch '^\s*(At |\+ |CategoryInfo|FullyQualifiedErrorId)' }) | Select-Object -Last 1
        "Update failed: $why"
      }
    } catch { $summary = "Update failed: $($_.Exception.Message)"; Add-Content $log $summary }
    $output = Get-Content $log -Raw -ErrorAction SilentlyContinue
    [ordered]@{
      jobId = $ask.jobId; ok = $ok; revision = $ask.revision; fromVersion = $ask.fromVersion
      summary = $summary; output = "$output"; finishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content $result -Encoding utf8
    if ($ok) { Restart-All } else {
      # A dependency install stops the services before it starts; never leave them stopped.
      foreach ($k in 'runner', 'watchdog') { if ((Get-Service $Names[$k]).Status -ne 'Running') { Start-Service $Names[$k] } }
    }
  }
}
