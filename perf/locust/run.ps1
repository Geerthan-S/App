<#
.SYNOPSIS
  Runs the Locust user simulation headless and writes stats, outcomes and an
  HTML report to perf/results/locust-<users>u-<target>-<timestamp>/ (or
  locust-<profile>-<target>-<timestamp>/ with -Profile).

  -Profile load|spike|soak uses a load pattern from shapes/, which sets the
  user count over time; -Users, -SpawnRate and -Duration are then ignored.

.EXAMPLE
  .\run.ps1 -Users 50
  .\run.ps1 -Users 100 -SpawnRate 10 -Duration 10m
  .\run.ps1 -Profile spike
  .\run.ps1 -Profile load -Target cloud -Confirm doctor-c7c29
#>
param(
  [int]$Users = 50,
  [int]$SpawnRate = 5,
  [string]$Duration = '5m',
  [ValidateSet('emulator', 'cloud')][string]$Target = 'emulator',
  [string]$Confirm = '',
  [ValidateSet('', 'load', 'spike', 'soak')][string]$Profile = ''
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = Resolve-Path (Join-Path $here '..\..')

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$label = if ($Profile) { $Profile } else { "$($Users)u" }
$out = Join-Path $repo "perf\results\locust-$label-$Target-$stamp"
New-Item -ItemType Directory -Force $out | Out-Null

$files = Join-Path $here 'locustfile.py'
if ($Profile) { $files += ',' + (Join-Path $here "shapes\$Profile.py") }

$locustArgs = @('-m', 'locust', '-f', $files, '--headless', '--stop-timeout', '30',
  '--target', $Target, '--results-dir', $out,
  '--csv', (Join-Path $out 'stats'), '--html', (Join-Path $out 'report.html'),
  '--logfile', (Join-Path $out 'locust.log'), '--only-summary')
if (-not $Profile) { $locustArgs += @('-u', $Users, '-r', $SpawnRate, '-t', $Duration) }
if ($Confirm) { $locustArgs += @('--confirm', $Confirm) }

Push-Location $here
# Locust prints its summary to stderr; Windows PowerShell would treat that as an error under 'Stop'.
$ErrorActionPreference = 'Continue'
try { & python @locustArgs 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.TargetObject } else { $_ } }; $code = $LASTEXITCODE } finally { Pop-Location }

Write-Host ""
Write-Host "Results: $out"
Write-Host "Report:  $(Join-Path $out 'report.html')"
exit $code
