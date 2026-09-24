# 恢复 dsh-ptc-task 构建链：把 src\index.ts 编译成 lib\index.js。
#
# 依据与边界（必读）：
#   - transcript 证据表明该插件原本就有 tsconfig.json 与 scripts\build.sh，但两者内容
#     在 transcript 中**没有完整基线** ⇒ 本脚本与 tsconfig.json 是按本机既定插件形态
#     编写的【推断】，不是逐字恢复。
#   - 该插件是**纯 host 插件**（src 下只有 index.ts，无 client 半）⇒ 不需要 tsdown 客户端打包。
#
# 依赖解析策略：在插件自己的 node_modules 下建**精确 junction**，指向 checkout 里
# 对应的真实包位置。绝不整体 junction 到 checkout\node_modules（那样拿不到 cordis）。
#
# 纪律：不使用 fs.rmSync({recursive}) / Remove-Item -Recurse 碰 junction；
#      只用 Remove-Item -Force 删链接本身。清理只删本脚本显式记录的那几个链接名。
[CmdletBinding()]
param(
  [string]$Checkout = 'C:\Users\<user>\Documents\Deepseek\_upgrade\dsh-v0.1.5-rc.1\src\deepseek-harness-dsh-v0.1.5-rc.1',
  [switch]$SkipLink
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot | Split-Path -Parent
Set-Location $root
Write-Host "== dsh-ptc-task build @ $root"

if (-not (Test-Path "$Checkout\packages")) { throw "checkout 不可用: $Checkout" }
$tsc = Join-Path $Checkout 'node_modules\.bin\tsc.cmd'
if (-not (Test-Path $tsc)) { throw "tsc 缺失: $tsc" }

# 依赖链接表：<链接相对路径> = <目标路径>
$hoist = Join-Path $Checkout 'node_modules\.pnpm\node_modules'
$links = [ordered]@{
  'node_modules\@deepseek-ai\cordis'     = (Join-Path $Checkout 'vendor\cordis')
  'node_modules\cordis'                  = (Join-Path $Checkout 'vendor\cordis')
  'node_modules\@deepseek-ai\schemastery'= (Join-Path $Checkout 'vendor\schemastery')
  'node_modules\schemastery'             = (Join-Path $Checkout 'vendor\schemastery')
  'node_modules\@deepseek-ai\dsh-tools'  = (Join-Path $hoist '@deepseek-ai\dsh-tools')
  'node_modules\@types\node'             = (Join-Path $Checkout 'node_modules\@types\node')
}

if (-not $SkipLink) {
  foreach ($rel in $links.Keys) {
    $target = $links[$rel]
    if (-not (Test-Path $target)) { throw "依赖目标不存在: $target  (链接 $rel)" }
    $link = Join-Path $root $rel
    $parent = Split-Path $link -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null

    $existing = Get-Item $link -Force -ErrorAction SilentlyContinue
    if ($existing) {
      if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Remove-Item $link -Force              # 只删链接本身
      } elseif ($existing.PSIsContainer) {
        $n = (Get-ChildItem $link -Force -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($n -gt 0) { throw "拒绝覆盖非空真实目录: $link ($n 个条目)——请人工确认" }
        Remove-Item $link -Force
      } else {
        Remove-Item $link -Force
      }
    }
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    Write-Host ("-- junction {0}  ->  {1}" -f $rel, $target)
  }
}

# 编译
Write-Host "== tsc -p tsconfig.json"
& $tsc -p (Join-Path $root 'tsconfig.json')
if ($LASTEXITCODE -ne 0) { throw "tsc 失败，退出码 $LASTEXITCODE" }

# 校验产物
$entry = Join-Path $root 'lib\index.js'
if (-not (Test-Path $entry)) { throw "编译后缺少 lib\index.js" }
Write-Host ("== 产物 lib\index.js  {0}B" -f (Get-Item $entry).Length)
Write-Host "== 语法自检 node --check"
& node --check $entry
if ($LASTEXITCODE -ne 0) { throw "node --check 失败" }
Write-Host "== 完成"
