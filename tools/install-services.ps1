# install-services.ps1 — define the three Rotavox Windows services (NSSM), and the task
# the Runner updates itself with, against the checkout this script lives in. Run once per
# box from an elevated PowerShell, and again whenever the checkout moves. Idempotent:
# existing services and the task are reconfigured in place.
#
#   powershell -ExecutionPolicy Bypass -File tools\install-services.ps1 [-OperatorUser broadcast]
#
# It only writes configuration. Running services pick up the new paths on their next
# restart; use tools\rotavox.ps1 restart for that, which restarts in a safe order.
#
# -OperatorUser grants that (non-admin) Windows account start/stop/query on the three
# services, so the operator can run tools\rotavox.ps1 without elevation.
param([string]$OperatorUser)
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Node = (Get-Command node).Source
$Nssm = (Get-Command nssm).Source
$Logs = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force $Logs | Out-Null

$services = @(
  @{ Name = 'RotavoxRunner';   Dir = 'apps\runner'; Args = "`"$Root\node_modules\tsx\dist\cli.mjs`" src\pace.ts";     Env = @('NODE_ENV=production') },
  @{ Name = 'RotavoxWatchdog'; Dir = 'apps\runner'; Args = "`"$Root\node_modules\tsx\dist\cli.mjs`" src\watchdog.ts"; Env = @('NODE_ENV=production') },
  @{ Name = 'RotavoxWeb';      Dir = 'apps\web';    Args = "`"$Root\node_modules\next\dist\bin\next`" start -p 3000 -H 127.0.0.1"; Env = @('NEXT_TELEMETRY_DISABLED=1', 'NODE_ENV=production') }
)

foreach ($s in $services) {
  $name = $s.Name
  if (-not (Get-Service $name -ErrorAction SilentlyContinue)) { & $Nssm install $name $Node | Out-Null }
  & $Nssm set $name Application $Node | Out-Null
  & $Nssm set $name AppParameters $s.Args | Out-Null
  & $Nssm set $name AppDirectory (Join-Path $Root $s.Dir) | Out-Null
  & $Nssm set $name AppEnvironmentExtra @($s.Env) | Out-Null
  & $Nssm set $name AppStdout (Join-Path $Logs "$name.log") | Out-Null
  & $Nssm set $name AppStderr (Join-Path $Logs "$name.log") | Out-Null
  & $Nssm set $name AppRotateFiles 1 | Out-Null
  # Rotate at service start only. With online rotation, NSSM 2.24-101 kills the app on
  # stop and then never reports the service stopped: StopPending until its nssm.exe is
  # killed by an admin (2026-10-20, all three services, reproduced and fixed by this).
  & $Nssm set $name AppRotateOnline 0 | Out-Null
  & $Nssm set $name AppRotateBytes 10485760 | Out-Null
  & $Nssm set $name AppRestartDelay 5000 | Out-Null
  # Ctrl+C first, with time to act on it: the pacer's SIGINT handler hands playout back
  # to AutoDJ over REST, which NSSM's default 1.5s window can cut off.
  & $Nssm set $name AppStopMethodConsole 10000 | Out-Null
  # A disabled service stays disabled: since the cloud cutover RotavoxWeb is, and
  # rotavox.ps1 update reads that as "the web app isn't on this box" (DEPLOY-CLOUD.md).
  if ((Get-Service $name).StartType -ne 'Disabled') { & $Nssm set $name Start SERVICE_AUTO_START | Out-Null }
  # No DependOnService between Runner and Watchdog, deliberately: the watchdog's job is
  # to keep working when the runner doesn't (DEPLOY.md step 11).
  Write-Host "$name -> $(Join-Path $Root $s.Dir)"
}

# The Runner's self-update (tools\rotavox.ps1 self-update): a task with no trigger, which the
# Runner starts when Rotavox staff press "Update Runner". It runs as SYSTEM, outside the
# Runner's service, because the update restarts that service. The Runner runs as
# LocalSystem, which may start any task; nothing else is granted.
$task = 'Rotavox Update'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $Root `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Root\tools\rotavox.ps1`" self-update"
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "$task task -> $Root\tools\rotavox.ps1 self-update"

if ($OperatorUser) {
  $sid = (New-Object Security.Principal.NTAccount $OperatorUser).Translate([Security.Principal.SecurityIdentifier]).Value
  # RP start, WP stop, LC/LO/CC/SW query and interrogate. No change-config, no delete.
  $ace = "(A;;RPWPLCLOCCSWRC;;;$sid)"
  foreach ($s in $services) {
    $sddl = ((& sc.exe sdshow $s.Name) -join '').Trim()
    if ($sddl -notmatch [regex]::Escape(";;;$sid)")) {
      $sddl = $sddl -replace '^(D:(?:\([^)]*\))*)', "`$1$ace"
      & sc.exe sdset $s.Name $sddl | Out-Null
    }
  }
  Write-Host "$OperatorUser can now start, stop and query the Rotavox services."
}

# The heartbeat must be one absolute path that both Runner and Watchdog read, or the
# watchdog sees "unknown" forever and never fails over (DEPLOY.md step 10).
$envFile = Join-Path $Root 'apps\runner\.env'
$hb = Join-Path $Root 'apps\runner\runner.heartbeat'
if (Test-Path $envFile) {
  $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch '^\s*RUNNER_HEARTBEAT_PATH=' })
  Set-Content -Path $envFile -Value ($lines + "RUNNER_HEARTBEAT_PATH=$hb") -Encoding ascii
  Write-Host "RUNNER_HEARTBEAT_PATH=$hb"
} else {
  Write-Warning "$envFile is missing; copy it from apps\runner\.env.example and fill it in."
}
