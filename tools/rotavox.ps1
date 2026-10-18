# rotavox.ps1 — operate the Rotavox services on the broadcast box.
#
#   .\tools\rotavox.ps1 status            services, heartbeat age, last log lines
#   .\tools\rotavox.ps1 restart [svc]     all three in a safe order, or one: runner | watchdog | web
#   .\tools\rotavox.ps1 stop [svc]        stop (all = watchdog first, so it can't fail over to AutoDJ mid-stop)
#   .\tools\rotavox.ps1 start [svc]
#   .\tools\rotavox.ps1 logs [svc] [-Follow]
#
# Stopping the runner without the watchdog hands playout to AutoDJ within ~20s; that is
# the fail-safe working, not a fault. Needs elevation unless tools\install-services.ps1
# was run with -OperatorUser for this account.
param(
  [Parameter(Position = 0)][ValidateSet('status', 'start', 'stop', 'restart', 'logs')][string]$Command = 'status',
  [Parameter(Position = 1)][ValidateSet('all', 'runner', 'watchdog', 'web')][string]$Service = 'all',
  [switch]$Follow
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

function Targets { if ($Service -eq 'all') { 'watchdog', 'runner', 'web' } else { $Service } }

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
    if ($Service -eq 'all' -or $Service -eq 'runner') {
      # Watchdog down first so a runner restart isn't mistaken for a dead pacer, then
      # back up only once the new runner is heartbeating.
      Stop-Service $Names.watchdog
      Restart-Service $Names.runner
      if (WaitForHeartbeat) { 'RotavoxRunner restarted, heartbeat fresh' } else { Write-Warning 'RotavoxRunner has not written a heartbeat in 60s; check: .\tools\rotavox.ps1 logs runner' }
      Start-Service $Names.watchdog; 'RotavoxWatchdog started'
    } elseif ($Service -eq 'watchdog') { Restart-Service $Names.watchdog; 'RotavoxWatchdog restarted' }
    if ($Service -eq 'all' -or $Service -eq 'web') { Restart-Service $Names.web; 'RotavoxWeb restarted' }
  }
}
