# dsh-dialogue-alert-message 构建链（PowerShell 版，等价于 xllh-analysis-model-list 的 scripts/build.sh）
#
# 步骤：
#   1. 在插件自己的 node_modules 下建**精确 junction**，指向 dsh checkout 里对应的真实包位置
#      （绝不整体 junction 到 checkout\node_modules —— 那样拿不到 cordis）。
#   2. tsc -p tsconfig.json（host 半；tsconfig 的 exclude 已排除 src/client）→ lib\index.js
#   3. tsdown（client 半）→ lib\client.js（window.__ModuleLoader__.load 工厂格式）
#   4. 产物自检（存在性 + 客户端加载器 banner）
#
# 纪律（红线）：不使用 Remove-Item -Recurse / fs.rmSync(recursive) 处理链接；
#              重建链接时只在确认是 reparse point（符号链接/junction）时 Remove-Item -Force 删链接本身。
# 注意：本脚本**不跑 test\**（测试是独立步骤，见报告）。
[CmdletBinding()]
param(
  [string]$Checkout = 'C:\Users\<user>\Documents\Deepseek\_upgrade\dsh-v0.1.5-rc.1\src\deepseek-harness-dsh-v0.1.5-rc.1',
  [switch]$SkipLinks,
  [switch]$SkipClient
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot | Split-Path -Parent
Set-Location $root
Write-Host "== dsh-dialogue-alert-message build @ $root"

if (-not (Test-Path "$Checkout\packages")) { throw "checkout 不可用: $Checkout" }
$tsc = Join-Path $Checkout 'node_modules\.bin\tsc.cmd'
if (-not (Test-Path $tsc)) { throw "tsc 缺失: $tsc" }
$tsdownRun = Join-Path $Checkout 'node_modules\tsdown\dist\run.mjs'
if (-not (Test-Path $tsdownRun)) { throw "tsdown 缺失: $tsdownRun" }

$hoist = Join-Path $Checkout 'node_modules\.pnpm\node_modules'
$links = [ordered]@{
  'node_modules\cordis'                                = (Join-Path $Checkout 'vendor\cordis')
  'node_modules\@deepseek-ai\cordis'                   = (Join-Path $Checkout 'vendor\cordis')
  'node_modules\schemastery'                           = (Join-Path $Checkout 'vendor\schemastery')
  'node_modules\@deepseek-ai\schemastery'              = (Join-Path $Checkout 'vendor\schemastery')
  'node_modules\@deepseek-ai\dsh-tools'                = (Join-Path $hoist '@deepseek-ai\dsh-tools')
  'node_modules\@deepseek-ai\dsh-llm'                  = (Join-Path $hoist '@deepseek-ai\dsh-llm')
  'node_modules\react'                                 = (Join-Path $hoist 'react')
  'node_modules\react-dom'                             = (Join-Path $hoist 'react-dom')
  'node_modules\@types\node'                           = (Join-Path $Checkout 'node_modules\@types\node')
  'node_modules\@deepseek-ai\dsh-client-ui-slots'       = (Join-Path $hoist '@deepseek-ai\dsh-client-ui-slots')
  'node_modules\@deepseek-ai\dsh-client-ui-sidebar'     = (Join-Path $hoist '@deepseek-ai\dsh-client-ui-sidebar')
  'node_modules\tsdown'                                = (Join-Path $Checkout 'node_modules\tsdown')
}

if (-not $SkipLinks) {
  Write-Host "== linking build dependencies (checkout: $Checkout)"
  foreach ($rel in $links.Keys) {
    $target = $links[$rel]
    if (-not (Test-Path $target)) { throw "依赖目标不存在: $target  (链接 $rel)" }
    $link = Join-Path $root $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $link -Parent) | Out-Null
    $existing = Get-Item $link -Force -ErrorAction SilentlyContinue
    if ($existing) {
      if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Remove-Item $link -Force                      # 只删链接本身（不用 -Recurse）
      } elseif ($existing.PSIsContainer) {
        $n = (Get-ChildItem $link -Force -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($n -gt 0) { throw "拒绝覆盖非空真实目录: $link ($n 个条目)——请人工确认" }
        Remove-Item $link -Force
      } else {
        Remove-Item $link -Force
      }
    }
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    Write-Host ("   junction {0}  ->  {1}" -f $rel, $target)
  }
  # npm run build:client 用的 bin 垫片（与模板 build.sh 行为一致）
  New-Item -ItemType Directory -Force -Path (Join-Path $root 'node_modules\.bin') | Out-Null
  Set-Content -Path (Join-Path $root 'node_modules\.bin\tsdown.cmd') -Value "@ECHO off`r`nnode `"%~dp0\..\tsdown\dist\run.mjs`" %*`r`n" -NoNewline
}

Write-Host "== tsc -p tsconfig.json (host half)"
& $tsc -p (Join-Path $root 'tsconfig.json')
$tscCode = $LASTEXITCODE
Write-Host "   tsc exit code = $tscCode"
if ($tscCode -ne 0) { throw "tsc 失败，退出码 $tscCode" }
$entry = Join-Path $root 'lib\index.js'
if (-not (Test-Path $entry)) { throw "编译后缺少 lib\index.js" }
Write-Host ("   lib\index.js  {0}B" -f (Get-Item $entry).Length)

if (-not $SkipClient) {
  Write-Host "== tsdown (client half) -> lib\client.js"
  & node $tsdownRun
  $tsdownCode = $LASTEXITCODE
  Write-Host "   tsdown exit code = $tsdownCode"
  if ($tsdownCode -ne 0) { throw "tsdown 失败，退出码 $tsdownCode" }
  $client = Join-Path $root 'lib\client.js'
  if (-not (Test-Path $client)) { throw "tsdown 后缺少 lib\client.js" }
  $text = Get-Content $client -Raw
  if ($text -notmatch 'window\.__ModuleLoader__\.load\(\{') { throw "lib\client.js 缺少 window.__ModuleLoader__.load 工厂头" }
  if ($text -notmatch [regex]::Escape('@dsh-external/dsh-dialogue-alert-message')) { throw "lib\client.js 缺少插件 id" }
  if ($text -notmatch 'factory:\s*\(require\)\s*=>\s*\{') { throw "lib\client.js 缺少 factory 签名" }
  if ($text -notmatch 'return module\.exports;\s*\}\s*\}\);') { throw "lib\client.js 缺少工厂尾" }
  Write-Host ("   lib\client.js {0}B  (ModuleLoader factory OK)" -f (Get-Item $client).Length)
}

Write-Host "== build 完成（未运行 test\：测试为独立步骤）"
