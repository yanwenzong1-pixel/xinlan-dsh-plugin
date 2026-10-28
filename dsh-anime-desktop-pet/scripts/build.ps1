# dsh-anime-desktop-pet build chain (PowerShell)
#   1. exact junctions into the DSH checkout for build/test-only tools
#   2. tsc -p tsconfig.json  -> lib/index.js + lib/types (host half)
#   3. tsdown                -> lib/client.js (window.__ModuleLoader__ factory)
# Fails when the animation asset is missing: run `python scripts/build-gif.py` first.
[CmdletBinding()]
param(
  [string]$Checkout = $env:DSH_CHECKOUT,
  [switch]$SkipLinks
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot | Split-Path -Parent
Set-Location $root
Write-Host "== dsh-anime-desktop-pet build @ $root"

if ([string]::IsNullOrWhiteSpace($Checkout)) { throw 'missing dsh checkout: pass -Checkout <path> or set DSH_CHECKOUT' }
$tsc = Join-Path $Checkout 'node_modules\.bin\tsc.cmd'
if (-not (Test-Path $tsc)) { throw "tsc missing: $tsc" }
$tsdownRun = Join-Path $Checkout 'node_modules\tsdown\dist\run.mjs'
if (-not (Test-Path $tsdownRun)) { throw "tsdown missing: $tsdownRun" }

if (-not (Test-Path (Join-Path $root 'assets\blue-fat-fish-working.gif'))) {
  throw 'missing assets/blue-fat-fish-working.gif - run: python scripts/build-gif.py'
}

$links = [ordered]@{
  'node_modules\@types\node' = (Join-Path $Checkout 'node_modules\@types\node')
  'node_modules\jsdom' = (Join-Path $Checkout 'node_modules\jsdom')
}
if (-not $SkipLinks) {
  Write-Host "== linking build/test dependencies (checkout: $Checkout)"
  foreach ($rel in $links.Keys) {
    $target = $links[$rel]
    if (-not (Test-Path $target)) { throw "dependency target missing: $target  (link $rel)" }
    $link = Join-Path $root $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $link -Parent) | Out-Null
    $existing = Get-Item $link -Force -ErrorAction SilentlyContinue
    if ($existing) {
      if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        # PS 5.1 Remove-Item on junctions throws; delete only the link itself.
        [IO.Directory]::Delete($link, $false)
      } else {
        throw "refusing to overwrite a real directory: $link - check manually"
      }
    }
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    Write-Host ("   junction {0}  ->  {1}" -f $rel, $target)
  }
}

Write-Host '== tsc -p tsconfig.json (host half)'
& $tsc -p (Join-Path $root 'tsconfig.json')
if ($LASTEXITCODE -ne 0) { throw "tsc failed with exit code $LASTEXITCODE" }
if (-not (Test-Path (Join-Path $root 'lib\index.js'))) { throw 'lib\index.js missing after tsc' }

Write-Host '== tsdown (client half) -> lib/client.js'
& node $tsdownRun
if ($LASTEXITCODE -ne 0) { throw "tsdown failed with exit code $LASTEXITCODE" }
$client = Join-Path $root 'lib\client.js'
if (-not (Test-Path $client)) { throw 'lib/client.js missing after tsdown' }
$text = Get-Content $client -Raw
if ($text -notmatch 'window\.__ModuleLoader__\.load\(\{') { throw 'lib/client.js misses the ModuleLoader factory banner' }
if ($text -notmatch [regex]::Escape('@dsh-external/dsh-anime-desktop-pet')) { throw 'lib/client.js misses the plugin id' }
Write-Host ("== build done: lib/client.js {0}B (tests: npm test)" -f (Get-Item $client).Length)
