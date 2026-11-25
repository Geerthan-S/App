<#
.SYNOPSIS
  Runs a JMeter plan headless and writes results plus an HTML report to
  perf/results/<plan>-<target>-<timestamp>/.

.EXAMPLE
  .\run.ps1 functional
  .\run.ps1 concurrency
  .\run.ps1 baseline -Threads 10 -Duration 60
  .\run.ps1 functional -Target cloud
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('functional', 'concurrency', 'baseline')][string]$Plan,
  [ValidateSet('emulator', 'cloud')][string]$Target = 'emulator',
  [int]$Threads = 10,
  [int]$Duration = 60,
  [int]$Rampup = 10
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = Resolve-Path (Join-Path $here '..\..')
$jmeter = Join-Path $repo 'tools\apache-jmeter-5.6.3\bin\jmeter.bat'
if (-not (Test-Path $jmeter)) { throw "JMeter not found at $jmeter" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = if ($Plan -eq 'baseline') { "$Plan-$($Threads)t-$Target-$stamp" } else { "$Plan-$Target-$stamp" }
$out = Join-Path $repo "perf\results\$name"
New-Item -ItemType Directory -Force $out | Out-Null

$jmeterArgs = @('-n', '-t', (Join-Path $here "$Plan.jmx"),
  '-l', (Join-Path $out 'results.jtl'), '-j', (Join-Path $out 'jmeter.log'),
  '-e', '-o', (Join-Path $out 'report'),
  "-Jthreads=$Threads", "-Jduration=$Duration", "-Jrampup=$Rampup")

if ($Target -eq 'cloud') {
  $services = Get-Content (Join-Path $repo 'google-services.json') -Raw | ConvertFrom-Json
  $apiKey = $services.client[0].api_key[0].current_key
  $jmeterArgs += @('-q', (Join-Path $here 'cloud.properties'), "-Japi_key=$apiKey")
}

Push-Location $here
try { & $jmeter @jmeterArgs } finally { Pop-Location }

Write-Host ""
Write-Host "Results: $out"
Write-Host "Report:  $(Join-Path $out 'report\index.html')"
