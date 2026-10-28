<#
  automation-backup.ps1 - backup-tools-r2 / T2
  ---------------------------------------------------------------------------
  Packages the state needed to rebuild this business repo's automation surface:

    payload (restorable):
      local/protocol/**                 (exclude *.bak*, sent/ unless -IncludeSent,
                                         any .credentials*, token files, local/backups)
      local/protocol/AGENTS.md          (inside local/protocol tree)
      skills/y-task-distribution-auto/templates/**
                                        (the real template source; repo-root
                                         templates/ does NOT exist and is NOT
                                         packaged)
      dispatch-ledger.jsonl             (repo root, if present; otherwise it is
                                         already covered under local/protocol)
      session-map.json                  (repo root, if present; ditto)

    meta (evidence only, not written back by automation-restore.ps1):
      profiles/dev/cordis.patch.yml     (<staging-home>/profiles/staged/cordis.patch.yml)
      profiles/release/cordis.patch.yml (<user-dsh-home>/profiles/release/cordis.patch.yml,
                                         fallback <repo>/release/profile/cordis.patch.yml)
      scheduled-tasks/<name>.xml        (automation.config.json tasks -> Export-ScheduledTask)
      repo/git-info.txt                 (HEAD, branch, dirty-entry count)
      dsh-helper/scripts.sha256.txt     ({{DSH_HELPER_DIR}} scripts: file name + sha256)

  Output (unless -DryRun):
    <OutDir>/backup-<yyyyMMdd-HHmmss>.zip
    <OutDir>/backup-<yyyyMMdd-HHmmss>.MANIFEST.json
  The manifest lists every packaged entry: archive path, restore target (payload
  only), kind, byte length, sha256, plus fileCount/totalBytes/generatedAt/
  sourceRepoHead. Hashes are computed while streaming into the zip, so they
  always describe the exact bytes stored in the archive (live logs keep growing).

  Retention: after a successful zip+manifest write the newest -Keep pairs are
  kept and older backup-*.zip + .MANIFEST.json pairs in OutDir are deleted
  (each file name + byte size is printed before deletion). Delete failures only
  warn and never change the exit code; -Keep 0 disables cleanup.

  Exclusions (hard): any file whose name starts with ".credentials", any file
  whose name contains "token", ".env*"; inside payload trees also *.bak* and
  sent/ (unless -IncludeSent); the OutDir subtree itself; reparse points.

  Parameters:
    -OutDir            output directory, default <repo>/<paths.backupDir>
    -IncludeSent       include <paths.protocolDir>/sent/
    -Keep <n>          keep the newest n backup zip+MANIFEST pairs in OutDir
                       (default 10; -Keep 0 = no cleanup; delete failures warn
                       and do not block)
    -DryRun            print file count + byte total + retention plan only;
                       write nothing
    -SelfTest          build a throw-away fixture in TEMP, run backup + restore
                       and compare sha256 per file; exit 0 only if all checks pass
    -RepoRoot          override repo root (default: paths.repoRoot from
                       automation.config.json, else parent of this script)
    -DshHelperDir      override {{DSH_HELPER_DIR}} root (default: $env:DSH_HELPER or
                       paths.dshHelperDir from automation.config.json)
    -StagingHome       override dev DSH_HOME (default: $env:DSH_HOME or
                       paths.dshHome from automation.config.json)
    -UserDshHome       override user DSH home (default: paths.dshHomeRelease
                       from automation.config.json)
    -SkipScheduledTasks  do not export planned tasks (used by -SelfTest)

  Exit codes: 0 ok, 1 self-verify/self-test failed, 3 required source or zip
  support missing, 4 zip/manifest write failed.

  Compatibility: Windows PowerShell 5.1 and PowerShell 7. This file MUST stay
  UTF-8 with BOM (EF BB BF); 5.1 otherwise parses it as ANSI.
#>
[CmdletBinding()]
param(
  [string]$OutDir = '',
  [switch]$IncludeSent,
  [int]$Keep = 10,
  [switch]$DryRun,
  [switch]$SelfTest,
  [string]$RepoRoot = '',
  [string]$DshHelperDir = '',
  [string]$StagingHome = '',
  [string]$UserDshHome = '',
  [switch]$SkipScheduledTasks
)

$ErrorActionPreference = 'Stop'
$script:Schema = 'automation-backup/manifest@1'
$script:ToolVersion = '1.1.0'
$script:Warnings = New-Object System.Collections.ArrayList
$script:SelftestChecks = 0
$script:SelftestFails = 0
$script:ScriptDir = $PSScriptRoot
$script:ScriptPath = $PSCommandPath
if ([string]::IsNullOrWhiteSpace($script:ScriptPath)) { $script:ScriptPath = $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($script:ScriptDir)) { $script:ScriptDir = Split-Path -Parent $script:ScriptPath }

# automation.config.json is the single source for machine paths, ports and the
# DSH scheduled-task list. The loader is dot-sourced from scripts/lib/.
$script:ConfigLib = Join-Path $script:ScriptDir 'lib\automation-config.ps1'
if (-not (Test-Path -LiteralPath $script:ConfigLib -PathType Leaf)) {
  Write-Host ('[backup] ERROR missing config loader: ' + $script:ConfigLib)
  exit 3
}
. $script:ConfigLib
$script:AutomationConfigPath = Join-Path (Split-Path -Parent $script:ScriptDir) 'automation.config.json'
try {
  $script:AutomationConfig = Get-AutomationConfig -ConfigPath $script:AutomationConfigPath
} catch {
  Write-Host ('[backup] ERROR ' + $_.Exception.Message)
  exit 3
}
$script:DefaultRepoRoot = [string]$script:AutomationConfig['paths']['repoRoot']
$script:DefaultStagingHome = [string]$script:AutomationConfig['paths']['dshHome']
$script:DefaultUserDshHome = [string]$script:AutomationConfig['paths']['dshHomeRelease']
$script:DefaultDshHelper = [string]$script:AutomationConfig['paths']['dshHelperDir']
$script:ProtocolRel = [string]$script:AutomationConfig['paths']['protocolDir']
$script:BackupRel = [string]$script:AutomationConfig['paths']['backupDir']
$script:TemplatesRel = [string]$script:AutomationConfig['paths']['templatesDir']
$script:TaskNames = @($script:AutomationConfig['tasks'])

function Write-BackupLog([string]$Message) {
  Write-Host ('[backup] ' + $Message)
}

function Add-BackupWarning([string]$Message) {
  [void]$script:Warnings.Add($Message)
  Write-Host ('[backup][warn] ' + $Message)
}

function Get-NormalizedDir([string]$PathValue) {
  $full = [System.IO.Path]::GetFullPath($PathValue)
  return $full.TrimEnd([char[]]@([char]92, [char]47))
}

function Get-DefaultRepoRoot {
  if (-not [string]::IsNullOrWhiteSpace($script:DefaultRepoRoot)) {
    return (Get-NormalizedDir $script:DefaultRepoRoot)
  }
  return (Get-NormalizedDir (Split-Path -Parent $script:ScriptDir))
}

function Get-JsonText($Value) {
  if ($null -eq $Value) { return 'null' }
  $s = [string]$Value
  $s = $s.Replace('\', '\\')
  $s = $s.Replace('"', '\"')
  $s = $s.Replace([string][char]13, '\r')
  $s = $s.Replace([string][char]10, '\n')
  $s = $s.Replace([string][char]9, '\t')
  return ('"' + $s + '"')
}

function Get-JsonBool($Value) {
  if ($Value) { return 'true' }
  return 'false'
}

function Get-JsonStringArray($Items) {
  $parts = New-Object System.Collections.ArrayList
  foreach ($i in @($Items)) {
    [void]$parts.Add((Get-JsonText ([string]$i)))
  }
  return ($parts.ToArray() -join ', ')
}

function Write-TextFileUtf8NoBom([string]$PathValue, [string]$Text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($PathValue, $Text, $enc)
}

function Get-Sha256OfFile([string]$PathValue) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = $null
  try {
    $stream = [System.IO.File]::Open($PathValue, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $hash = $sha.ComputeHash($stream)
    return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
    $sha.Dispose()
  }
}

function Get-ZipEntrySha256($Entry) {
  $stream = $Entry.Open()
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($stream)
    return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $sha.Dispose()
  }
}

function Get-ExclusionReason([string]$Name) {
  if ($Name.StartsWith('.credentials', [System.StringComparison]::OrdinalIgnoreCase)) { return 'credentials' }
  if ($Name -match '(?i)token') { return 'token' }
  if ($Name -match '(?i)^\.env(\.|$)') { return 'env' }
  return ''
}

function Test-BakName([string]$Name) {
  if ($Name -match '(?i)\.bak') { return $true }
  return $false
}

function Get-BackupPairBaseName([string]$LeafName) {
  if ($LeafName -match '(?i)^(backup-.+)\.zip$') { return [string]$Matches[1] }
  if ($LeafName -match '(?i)^(backup-.+)\.MANIFEST\.json$') { return [string]$Matches[1] }
  return ''
}

function Get-BackupRetentionPlan {
  param([string]$OutDirFull, [int]$Keep, [string]$CurrentBase, [switch]$IncludeNewPair)
  $plan = @{ Existing = 0; KeepPairs = @(); DeletePairs = @(); DeleteFiles = @(); CurrentBase = $CurrentBase }
  if ($Keep -le 0) { return $plan }
  if (-not (Test-Path -LiteralPath $OutDirFull -PathType Container)) { return $plan }
  $items = @(Get-ChildItem -LiteralPath $OutDirFull -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)^backup-.+\.(zip|MANIFEST\.json)$' })
  $byBase = @{}
  foreach ($f in $items) {
    $base = Get-BackupPairBaseName ([string]$f.Name)
    if ($base -eq '') { continue }
    if (-not $byBase.ContainsKey($base)) { $byBase[$base] = New-Object System.Collections.ArrayList }
    [void]$byBase[$base].Add($f)
  }
  $pairs = New-Object System.Collections.ArrayList
  foreach ($base in @($byBase.Keys)) {
    $files = @($byBase[$base])
    $zip = $null
    $man = $null
    foreach ($f in $files) {
      if ($f.Name -match '(?i)\.MANIFEST\.json$') { if ($null -eq $man) { $man = $f } }
      elseif ($f.Name -match '(?i)\.zip$') { if ($null -eq $zip) { $zip = $f } }
    }
    $anchor = $zip
    if ($null -eq $anchor) { $anchor = $man }
    $time = [datetime]::MinValue
    if ($null -ne $anchor) { $time = [datetime]$anchor.LastWriteTime }
    $bytes = [long]0
    foreach ($f in $files) { $bytes = $bytes + [long]$f.Length }
    [void]$pairs.Add([pscustomobject]@{ Base = [string]$base; Zip = $zip; Manifest = $man; Time = $time; Bytes = $bytes })
  }
  $plan.Existing = [int]$pairs.Count
  if ($IncludeNewPair) {
    # Dry-run: model the pair this run would create, so keep/delete counts are
    # what a real run would produce (the new pair always occupies one slot).
    $pendingBase = 'backup-<pending>'
    [void]$pairs.Add([pscustomobject]@{ Base = $pendingBase; Zip = $null; Manifest = $null; Time = [datetime]::MaxValue; Bytes = [long]0 })
    if ([string]::IsNullOrWhiteSpace($CurrentBase)) { $CurrentBase = $pendingBase }
  }
  $sorted = @($pairs | Sort-Object -Property @{ Expression = { $_.Time }; Descending = $true }, @{ Expression = { $_.Base }; Descending = $true })
  $keepList = New-Object System.Collections.ArrayList
  $current = @($sorted | Where-Object { [string]$_.Base -eq $CurrentBase })
  if ($current.Count -gt 0) { [void]$keepList.Add($current[0]) }
  $slots = $Keep - $keepList.Count
  if ($slots -lt 0) { $slots = 0 }
  $rest = @($sorted | Where-Object { [string]$_.Base -ne $CurrentBase })
  foreach ($p in @($rest | Select-Object -First $slots)) { [void]$keepList.Add($p) }
  $keepBases = @{}
  foreach ($p in $keepList) { $keepBases[[string]$p.Base] = $true }
  $deleteList = New-Object System.Collections.ArrayList
  foreach ($p in $sorted) { if (-not $keepBases.ContainsKey([string]$p.Base)) { [void]$deleteList.Add($p) } }
  $deleteFiles = New-Object System.Collections.ArrayList
  foreach ($p in $deleteList) {
    if ($null -ne $p.Zip) { [void]$deleteFiles.Add($p.Zip) }
    if ($null -ne $p.Manifest) { [void]$deleteFiles.Add($p.Manifest) }
  }
  $plan.KeepPairs = @($keepList.ToArray())
  $plan.DeletePairs = @($deleteList.ToArray())
  $plan.DeleteFiles = @($deleteFiles.ToArray())
  return $plan
}

function Invoke-BackupRetention {
  param([string]$OutDirFull, [int]$Keep, [switch]$DryRun, [string]$CurrentBase)
  $res = @{ Keep = [int]$Keep; Existing = 0; Kept = 0; DeletePairs = 0; DeleteFiles = 0; Deleted = 0; Failed = 0; Disabled = $false }
  if ($Keep -le 0) {
    $res.Disabled = $true
    Write-BackupLog 'retention: disabled (-Keep 0, no cleanup)'
    return $res
  }
  $plan = Get-BackupRetentionPlan -OutDirFull $OutDirFull -Keep $Keep -CurrentBase $CurrentBase -IncludeNewPair:$DryRun
  $pairLabel = 'pairs=' + [string]$plan.Existing
  if ($DryRun) { $pairLabel = 'pairs=' + [string]$plan.Existing + ' (+1 new)' }
  Write-BackupLog ('retention: keep=' + [string]$Keep + '; ' + $pairLabel + '; keep=' + [string]$plan.KeepPairs.Count + ', delete=' + [string]$plan.DeletePairs.Count)
  foreach ($p in @($plan.KeepPairs)) {
    if (($null -eq $p.Zip) -and ($null -eq $p.Manifest)) {
      Write-BackupLog 'retention keep: (new backup, pending)'
    } else {
      Write-BackupLog ('retention keep: ' + [string]$p.Base + ' (' + [string]$p.Bytes + ' bytes)')
    }
  }
  $res.Existing = [int]$plan.Existing
  $res.Kept = [int]$plan.KeepPairs.Count
  $res.DeletePairs = [int]$plan.DeletePairs.Count
  $res.DeleteFiles = [int](@($plan.DeleteFiles).Count)
  foreach ($f in @($plan.DeleteFiles)) {
    if ($DryRun) {
      Write-BackupLog ('retention would delete: ' + [string]$f.Name + ' (' + [string]$f.Length + ' bytes)')
      continue
    }
    Write-BackupLog ('retention delete: ' + [string]$f.Name + ' (' + [string]$f.Length + ' bytes)')
    try {
      Remove-Item -LiteralPath ([string]$f.FullName) -Force -ErrorAction Stop
      $res.Deleted = [int]$res.Deleted + 1
    } catch {
      $res.Failed = [int]$res.Failed + 1
      Add-BackupWarning ('retention delete failed (continuing): ' + [string]$f.Name + ' => ' + $_.Exception.Message)
    }
  }
  if ($DryRun) {
    if ($res.DeletePairs -eq 0) {
      Write-BackupLog 'retention plan: nothing to delete'
    } else {
      Write-BackupLog ('retention plan: would delete ' + [string]$res.DeleteFiles + ' file(s) / ' + [string]$res.DeletePairs + ' pair(s)')
    }
  } elseif ($res.Failed -gt 0) {
    Write-BackupLog ('retention: deleted=' + [string]$res.Deleted + ' failed=' + [string]$res.Failed + ' (non-fatal)')
  } else {
    Write-BackupLog ('retention: deleted=' + [string]$res.Deleted + ' file(s); kept=' + [string]$res.Kept + ' pair(s)')
  }
  return $res
}

function Initialize-ZipTypes {
  try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop } catch { }
  try { Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop } catch { }
  $t = 'System.IO.Compression.ZipFile' -as [type]
  if ($null -eq $t) { throw 'System.IO.Compression.ZipFile is unavailable in this PowerShell host' }
  return $true
}

function Add-FileToZip {
  param($Archive, [string]$SourcePath, [string]$EntryName)
  # Hash while streaming: the sha256 always describes the exact bytes written to
  # the archive, even if the source file (e.g. relay.log) keeps growing.
  $fs = [System.IO.File]::Open($SourcePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    $entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
    try { $entry.LastWriteTime = [System.IO.File]::GetLastWriteTime($SourcePath) } catch { }
    $es = $entry.Open()
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $buffer = New-Object byte[] 81920
    $total = [long]0
    try {
      while ($true) {
        $read = $fs.Read($buffer, 0, $buffer.Length)
        if ($read -le 0) { break }
        $es.Write($buffer, 0, $read)
        [void]$sha.TransformBlock($buffer, 0, $read, $buffer, 0)
        $total = $total + $read
      }
      [void]$sha.TransformFinalBlock($buffer, 0, 0)
      $hash = ([System.BitConverter]::ToString($sha.Hash)).Replace('-', '').ToLowerInvariant()
    } finally {
      $es.Dispose()
      $sha.Dispose()
    }
    return @{ Bytes = $total; Sha256 = $hash }
  } finally {
    $fs.Dispose()
  }
}

function Add-BytesToZip {
  param($Archive, [string]$EntryName, [byte[]]$Bytes, [datetime]$LastWriteTime)
  $entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
  try { $entry.LastWriteTime = $LastWriteTime } catch { }
  $es = $entry.Open()
  try {
    if ($null -ne $Bytes -and $Bytes.Length -gt 0) { $es.Write($Bytes, 0, $Bytes.Length) }
  } finally {
    $es.Dispose()
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    if ($null -eq $Bytes) { $Bytes = New-Object byte[] 0 }
    $hash = ([System.BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
  return @{ Bytes = [long]$Bytes.Length; Sha256 = $hash }
}

function ConvertTo-Utf16LeBytes([string]$Text) {
  # Export-ScheduledTask returns XML whose declaration says encoding="UTF-16".
  $body = [System.Text.Encoding]::Unicode.GetBytes($Text)
  $out = New-Object byte[] ($body.Length + 2)
  $out[0] = 0xFF
  $out[1] = 0xFE
  [System.Array]::Copy($body, 0, $out, 2, $body.Length)
  return $out
}

function New-SourceRecord {
  param([string]$Name, [string]$PathValue, [bool]$Exists, [int]$Files, [long]$Bytes, [string]$Note)
  return [pscustomobject]@{ name = $Name; path = $PathValue; exists = $Exists; files = $Files; bytes = $Bytes; note = $Note }
}

function New-MetaEntry {
  param([string]$Entry, [byte[]]$Bytes, [datetime]$LastWriteTime, [string]$SourcePath)
  if ($null -eq $Bytes) { $Bytes = New-Object byte[] 0 }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = ([System.BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
  return [pscustomobject]@{ Path = $Entry; Target = $null; Kind = 'meta'; BytesData = $Bytes; Bytes = [long]$Bytes.Length; Sha256 = $hash; LastWriteTime = $LastWriteTime; Source = $SourcePath }
}

function Collect-PayloadTree {
  param(
    [string]$Root,
    [string]$TargetPrefix,
    [System.Collections.ArrayList]$Files,
    [hashtable]$Exclusions,
    [string]$OutDirFull,
    [hashtable]$Stats,
    [switch]$SkipSent
  )
  if (-not (Test-Path -LiteralPath $Root)) { return }
  $rootFull = (Get-NormalizedDir $Root)
  $stack = New-Object System.Collections.Stack
  $stack.Push($rootFull)
  while ($stack.Count -gt 0) {
    $dir = [string]$stack.Pop()
    $items = @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop)
    foreach ($it in $items) {
      $isDir = [bool]($it.Attributes -band [System.IO.FileAttributes]::Directory)
      $isReparse = [bool]($it.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
      if ($isReparse) {
        $Exclusions['reparse'] = [int]$Exclusions['reparse'] + 1
        continue
      }
      $reason = Get-ExclusionReason ([string]$it.Name)
      if ($reason -ne '') {
        $Exclusions[$reason] = [int]$Exclusions[$reason] + 1
        continue
      }
      if ($isDir) {
        if ($SkipSent -and ([string]$it.Name -ieq 'sent')) {
          $Exclusions['sent'] = [int]$Exclusions['sent'] + 1
          continue
        }
        if (Test-BakName ([string]$it.Name)) {
          $Exclusions['bak'] = [int]$Exclusions['bak'] + 1
          continue
        }
        if ($it.FullName.StartsWith($OutDirFull, [System.StringComparison]::OrdinalIgnoreCase)) {
          $Exclusions['outdir'] = [int]$Exclusions['outdir'] + 1
          continue
        }
        $stack.Push([string]$it.FullName)
      } else {
        if (Test-BakName ([string]$it.Name)) {
          $Exclusions['bak'] = [int]$Exclusions['bak'] + 1
          continue
        }
        if ($it.FullName.StartsWith($OutDirFull, [System.StringComparison]::OrdinalIgnoreCase)) {
          $Exclusions['outdir'] = [int]$Exclusions['outdir'] + 1
          continue
        }
        $rel = $it.FullName.Substring($rootFull.Length + 1)
        $rel = $rel -replace '\\', '/'
        $target = $TargetPrefix + '/' + $rel
        [void]$Files.Add([pscustomobject]@{ Full = $it.FullName; Target = $target; Bytes = [long]$it.Length; Kind = 'payload' })
        $Stats.Files = [int]$Stats.Files + 1
        $Stats.Bytes = [long]$Stats.Bytes + [long]$it.Length
      }
    }
  }
}

function Invoke-Git {
  param([string]$Repo, [string[]]$GitArgs)
  $oldEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $cmd = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($null -eq $cmd) { $cmd = Get-Command git -ErrorAction SilentlyContinue }
    if ($null -eq $cmd) { return @{ Ok = $false; Text = 'git not found on PATH' } }
    $text = (& $cmd.Source -C $Repo @GitArgs 2>$null | Out-String).Trim()
    $code = $LASTEXITCODE
    if ($code -ne 0) { return @{ Ok = $false; Text = ('git ' + ($GitArgs -join ' ') + ' exit=' + [string]$code) } }
    return @{ Ok = $true; Text = $text }
  } catch {
    return @{ Ok = $false; Text = $_.Exception.Message }
  } finally {
    $ErrorActionPreference = $oldEap
  }
}

function Get-ScheduledTaskExports {
  param([switch]$Skip)
  $res = @{ skipped = $false; reason = ''; exported = 0; names = @(); failed = @(); xmls = @() }
  if ($Skip) {
    $res.skipped = $true
    $res.reason = 'skipped by -SkipScheduledTasks'
    return $res
  }
  $taskNames = @($script:TaskNames)
  if ($taskNames.Count -eq 0) {
    $res.skipped = $true
    $res.reason = 'no task names in automation.config.json'
    return $res
  }
  try {
    $null = Get-Command Get-ScheduledTask -ErrorAction Stop
  } catch {
    $res.skipped = $true
    $res.reason = 'Get-ScheduledTask failed: ' + $_.Exception.Message
    return $res
  }
  foreach ($taskName in $taskNames) {
    $tasks = @()
    try {
      $tasks = @(Get-ScheduledTask -TaskName ([string]$taskName) -ErrorAction Stop)
    } catch {
      $res.failed = @($res.failed) + @(([string]$taskName + ': ' + $_.Exception.Message))
      continue
    }
    if ($tasks.Count -eq 0) {
      $res.failed = @($res.failed) + @(([string]$taskName + ': not found'))
      continue
    }
    foreach ($t in $tasks) {
      $name = [string]$t.TaskName
      $taskPath = [string]$t.TaskPath
      try {
        $eparams = @{ TaskName = $name; ErrorAction = 'Stop' }
        if (-not [string]::IsNullOrWhiteSpace($taskPath)) { $eparams['TaskPath'] = $taskPath }
        $xml = Export-ScheduledTask @eparams
        $res.xmls = @($res.xmls) + @([pscustomobject]@{ Name = $name; Xml = [string]$xml })
        $res.names = @($res.names) + @($name)
        $res.exported = [int]$res.exported + 1
      } catch {
        $res.failed = @($res.failed) + @(($name + ': ' + $_.Exception.Message))
      }
    }
  }
  return $res
}

function New-HelperScriptList {
  param([string]$Dir, [hashtable]$Info)
  $lines = New-Object System.Collections.ArrayList
  [void]$lines.Add('# dsh-helper scripts sha256 list (name + sha256 only, no contents)')
  [void]$lines.Add('# dir: ' + $Dir)
  [void]$lines.Add('# generated: ' + (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz'))
  $rows = New-Object System.Collections.ArrayList
  $count = 0
  $failed = 0
  if (([string]::IsNullOrWhiteSpace($Dir)) -or (-not (Test-Path -LiteralPath $Dir))) {
    [void]$lines.Add('# missing: scripts directory not found')
    $Info.Exists = $false
  } else {
    $Info.Exists = $true
    $files = @(Get-ChildItem -LiteralPath $Dir -Force -ErrorAction Stop | Where-Object { -not $_.PSIsContainer } | Sort-Object Name)
    foreach ($f in $files) {
      if ((Get-ExclusionReason ([string]$f.Name)) -ne '') { continue }
      try {
        $h = Get-Sha256OfFile ([string]$f.FullName)
        [void]$rows.Add(($h + '  ' + [string]$f.Name))
        $count = $count + 1
      } catch {
        [void]$rows.Add(('# hash-failed  ' + [string]$f.Name))
        $failed = $failed + 1
      }
    }
  }
  [void]$lines.Add('# count: ' + [string]$count)
  [void]$lines.Add('# hashFailed: ' + [string]$failed)
  foreach ($r in $rows) { [void]$lines.Add([string]$r) }
  $Info.Count = $count
  $Info.Failed = $failed
  return ($lines.ToArray() -join [string][char]10)
}

function Test-ZipAgainstEntries {
  param([string]$ZipPath, $Entries)
  Initialize-ZipTypes | Out-Null
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $map = @{}
    foreach ($e in $archive.Entries) {
      if (-not [string]::IsNullOrEmpty($e.Name)) { $map[$e.FullName] = $e }
    }
    $mismatches = New-Object System.Collections.ArrayList
    $checked = 0
    foreach ($x in @($Entries)) {
      if (-not $map.ContainsKey([string]$x.Path)) {
        [void]$mismatches.Add(('missing entry: ' + [string]$x.Path))
        continue
      }
      $h = Get-ZipEntrySha256 $map[[string]$x.Path]
      if ($h -ne [string]$x.Sha256) {
        [void]$mismatches.Add(('sha256 mismatch: ' + [string]$x.Path + ' manifest=' + [string]$x.Sha256 + ' zip=' + $h))
      }
      $checked = $checked + 1
    }
    $extra = 0
    $known = @{}
    foreach ($x in @($Entries)) { $known[[string]$x.Path] = $true }
    foreach ($k in $map.Keys) { if (-not $known.ContainsKey($k)) { $extra = $extra + 1 } }
    return @{ Checked = $checked; Mismatches = $mismatches; Extra = $extra; EntryCount = $map.Count }
  } finally {
    $archive.Dispose()
  }
}

function New-FileJsonLines($Entries) {
  $parts = New-Object System.Collections.ArrayList
  foreach ($e in (@($Entries) | Sort-Object { $_.Path })) {
    $target = 'null'
    if (($null -ne $e.Target) -and ([string]$e.Target -ne '')) { $target = Get-JsonText ([string]$e.Target) }
    $line = '    {"path": ' + (Get-JsonText ([string]$e.Path)) + ', "target": ' + $target + ', "kind": ' + (Get-JsonText ([string]$e.Kind)) + ', "bytes": ' + ([string][long]$e.Bytes) + ', "sha256": ' + (Get-JsonText ([string]$e.Sha256)) + '}'
    [void]$parts.Add($line)
  }
  return ($parts.ToArray() -join (',' + [string][char]10))
}

function New-SourceJsonLines($Sources) {
  $parts = New-Object System.Collections.ArrayList
  foreach ($s in @($Sources)) {
    $line = '    {"name": ' + (Get-JsonText ([string]$s.name)) + ', "path": ' + (Get-JsonText ([string]$s.path)) + ', "exists": ' + (Get-JsonBool $s.exists) + ', "files": ' + ([string][int]$s.files) + ', "bytes": ' + ([string][long]$s.bytes) + ', "note": ' + (Get-JsonText ([string]$s.note)) + '}'
    [void]$parts.Add($line)
  }
  return ($parts.ToArray() -join (',' + [string][char]10))
}

function New-ExclusionJsonLines($Exclusions) {
  $parts = New-Object System.Collections.ArrayList
  foreach ($k in (@($Exclusions.Keys) | Sort-Object)) {
    $line = '    {"reason": ' + (Get-JsonText ([string]$k)) + ', "count": ' + ([string][int]$Exclusions[$k]) + '}'
    [void]$parts.Add($line)
  }
  return ($parts.ToArray() -join (',' + [string][char]10))
}

function New-ProfileJson($Profile) {
  if ($null -eq $Profile) { return 'null' }
  return '{ "path": ' + (Get-JsonText ([string]$Profile['path'])) + ', "packaged": ' + (Get-JsonBool $Profile['packaged']) + ', "entry": ' + (Get-JsonText ([string]$Profile['entry'])) + ', "bytes": ' + ([string][long]$Profile['bytes']) + ', "sha256": ' + (Get-JsonText ([string]$Profile['sha256'])) + ' }'
}

function New-ScheduledTasksJson($Info) {
  return '{ "filter": ' + (Get-JsonText ([string]$Info['filter'])) + ', "exported": ' + ([string][int]$Info['exported']) + ', "skipped": ' + (Get-JsonBool $Info['skipped']) + ', "reason": ' + (Get-JsonText ([string]$Info['reason'])) + ', "names": [' + (Get-JsonStringArray $Info['names']) + '], "failed": [' + (Get-JsonStringArray $Info['failed']) + '] }'
}

function New-HelperJson($Info) {
  return '{ "dir": ' + (Get-JsonText ([string]$Info['dir'])) + ', "exists": ' + (Get-JsonBool $Info['exists']) + ', "count": ' + ([string][int]$Info['count']) + ', "hashFailed": ' + ([string][int]$Info['failed']) + ', "listEntry": ' + (Get-JsonText ([string]$Info['listEntry'])) + ' }'
}

function New-ManifestJson {
  param([hashtable]$Ctx)
  $nl = [string][char]10
  $top = New-Object System.Collections.ArrayList
  [void]$top.Add('  "schema": ' + (Get-JsonText $Ctx['Schema']))
  [void]$top.Add('  "tool": ' + (Get-JsonText 'automation-backup.ps1') + ', "toolVersion": ' + (Get-JsonText $Ctx['ToolVersion']))
  [void]$top.Add('  "generatedAt": ' + (Get-JsonText $Ctx['GeneratedAt']))
  [void]$top.Add('  "generatedAtUtc": ' + (Get-JsonText $Ctx['GeneratedAtUtc']))
  [void]$top.Add('  "sourceRepoRoot": ' + (Get-JsonText $Ctx['RepoRoot']))
  [void]$top.Add('  "sourceRepoHead": ' + (Get-JsonText $Ctx['Head']))
  [void]$top.Add('  "sourceRepoBranch": ' + (Get-JsonText $Ctx['Branch']))
  [void]$top.Add('  "sourceRepoDirtyEntries": ' + ([string][int]$Ctx['Dirty']))
  [void]$top.Add('  "includeSent": ' + (Get-JsonBool $Ctx['IncludeSent']))
  [void]$top.Add('  "keep": ' + ([string][int]$Ctx['Keep']))
  [void]$top.Add('  "zipFile": ' + (Get-JsonText $Ctx['ZipPath']))
  [void]$top.Add('  "zipBytes": ' + ([string][long]$Ctx['ZipBytes']))
  [void]$top.Add('  "zipSha256": ' + (Get-JsonText $Ctx['ZipSha']))
  [void]$top.Add('  "fileCount": ' + ([string][int]$Ctx['FileCount']))
  [void]$top.Add('  "totalBytes": ' + ([string][long]$Ctx['TotalBytes']))
  [void]$top.Add('  "payloadCount": ' + ([string][int]$Ctx['PayloadCount']))
  [void]$top.Add('  "payloadBytes": ' + ([string][long]$Ctx['PayloadBytes']))
  [void]$top.Add('  "metaCount": ' + ([string][int]$Ctx['MetaCount']))
  [void]$top.Add('  "metaBytes": ' + ([string][long]$Ctx['MetaBytes']))
  [void]$top.Add('  "profileDev": ' + (New-ProfileJson $Ctx['ProfileDev']))
  [void]$top.Add('  "profileRelease": ' + (New-ProfileJson $Ctx['ProfileRelease']))
  [void]$top.Add('  "scheduledTasks": ' + (New-ScheduledTasksJson $Ctx['ScheduledTasks']))
  [void]$top.Add('  "dshHelper": ' + (New-HelperJson $Ctx['Helper']))
  [void]$top.Add('  "sources": [' + $nl + (New-SourceJsonLines $Ctx['Sources']) + $nl + '  ]')
  [void]$top.Add('  "exclusions": [' + $nl + (New-ExclusionJsonLines $Ctx['Exclusions']) + $nl + '  ]')
  [void]$top.Add('  "warnings": [' + $nl + (New-JsonWarningLines $Ctx['Warnings']) + $nl + '  ]')
  [void]$top.Add('  "files": [' + $nl + (New-FileJsonLines $Ctx['Entries']) + $nl + '  ]')
  return ('{' + $nl + ($top.ToArray() -join (',' + $nl)) + $nl + '}')
}

function New-JsonWarningLines($Warnings) {
  $parts = New-Object System.Collections.ArrayList
  foreach ($w in @($Warnings)) {
    [void]$parts.Add('    ' + (Get-JsonText ([string]$w)))
  }
  return ($parts.ToArray() -join ',')
}

function Invoke-Backup {
  param(
    [string]$RepoRoot,
    [string]$OutDir,
    [switch]$IncludeSent,
    [int]$Keep = 10,
    [switch]$DryRun,
    [string]$DshHelperDir,
    [string]$StagingHome,
    [string]$UserDshHome,
    [switch]$SkipScheduledTasks
  )
  $script:Warnings.Clear()
  $repo = Get-NormalizedDir $RepoRoot
  if ([string]::IsNullOrWhiteSpace($OutDir)) { $OutDir = Resolve-AutomationPath -Path $script:BackupRel -BaseDir $repo }
  $outFull = Get-NormalizedDir $OutDir

  Write-BackupLog ('repo=' + $repo)
  Write-BackupLog ('outDir=' + $outFull)
  if ($DryRun) { Write-BackupLog 'mode=DRYRUN (no zip, no manifest)' } else { Write-BackupLog 'mode=BACKUP' }
  Write-BackupLog ('includeSent=' + [string]([bool]$IncludeSent))
  Write-BackupLog ('keep=' + [string]$Keep + ' (0=no cleanup)')

  $payload = New-Object System.Collections.ArrayList
  $exclusions = @{ credentials = 0; token = 0; env = 0; bak = 0; sent = 0; outdir = 0; reparse = 0 }
  $sources = New-Object System.Collections.ArrayList

  $protocolRel = (([string]$script:ProtocolRel) -replace '\\', '/').TrimEnd('/')
  $protocolRoot = Resolve-AutomationPath -Path $script:ProtocolRel -BaseDir $repo
  if (-not (Test-Path -LiteralPath $protocolRoot)) {
    Write-BackupLog ('ERROR required source missing: ' + $protocolRoot)
    return @{ ExitCode = 3; Message = ($protocolRel + ' missing') }
  }
  $stat = @{ Files = 0; Bytes = [long]0 }
  Collect-PayloadTree -Root $protocolRoot -TargetPrefix $protocolRel -Files $payload -Exclusions $exclusions -OutDirFull $outFull -Stats $stat -SkipSent:(-not $IncludeSent)
  [void]$sources.Add((New-SourceRecord 'protocol' $protocolRoot $true ([int]$stat.Files) ([long]$stat.Bytes) ($protocolRel + ' tree')))
  Write-BackupLog ('source ' + $protocolRel + ': ' + [string]$stat.Files + ' files / ' + [string]$stat.Bytes + ' bytes')

  # The real template source comes from automation.config.json paths.templatesDir;
  # repo-root templates/ does not exist and is deliberately not packaged.
  $templatesRel = (([string]$script:TemplatesRel) -replace '\\', '/').TrimEnd('/')
  $templatesRoot = Resolve-AutomationPath -Path $script:TemplatesRel -BaseDir $repo
  if (Test-Path -LiteralPath $templatesRoot -PathType Container) {
    $stat = @{ Files = 0; Bytes = [long]0 }
    Collect-PayloadTree -Root $templatesRoot -TargetPrefix $templatesRel -Files $payload -Exclusions $exclusions -OutDirFull $outFull -Stats $stat
    [void]$sources.Add((New-SourceRecord 'templates' $templatesRoot $true ([int]$stat.Files) ([long]$stat.Bytes) ('template tree (' + $templatesRel + ')')))
    Write-BackupLog ('source ' + $templatesRel + ': ' + [string]$stat.Files + ' files / ' + [string]$stat.Bytes + ' bytes')
  } else {
    [void]$sources.Add((New-SourceRecord 'templates' $templatesRoot $false 0 0 ('template source not found (' + $templatesRel + ')')))
    Add-BackupWarning ('template source not found: ' + $templatesRoot + '; this source was NOT packaged')
  }

  $ledgerPath = Join-Path $repo 'dispatch-ledger.jsonl'
  if (Test-Path -LiteralPath $ledgerPath -PathType Leaf) {
    $li = Get-Item -LiteralPath $ledgerPath
    [void]$payload.Add([pscustomobject]@{ Full = $li.FullName; Target = 'dispatch-ledger.jsonl'; Bytes = [long]$li.Length; Kind = 'payload' })
    [void]$sources.Add((New-SourceRecord 'dispatch-ledger' $ledgerPath $true 1 ([long]$li.Length) 'repo root'))
    Write-BackupLog ('source dispatch-ledger.jsonl: 1 file / ' + [string]$li.Length + ' bytes')
  } else {
    $covered = Test-Path -LiteralPath (Join-Path $protocolRoot 'dispatch-ledger.jsonl')
    $note = ('not at repo root; packaged under ' + $protocolRel)
    if (-not $covered) { $note = ('not found at repo root or ' + $protocolRel) }
    [void]$sources.Add((New-SourceRecord 'dispatch-ledger' $ledgerPath $false 0 0 $note))
    Write-BackupLog ('source dispatch-ledger.jsonl: ' + $note)
  }

  $sessionPath = Join-Path $repo 'session-map.json'
  if (Test-Path -LiteralPath $sessionPath -PathType Leaf) {
    $si = Get-Item -LiteralPath $sessionPath
    [void]$payload.Add([pscustomobject]@{ Full = $si.FullName; Target = 'session-map.json'; Bytes = [long]$si.Length; Kind = 'payload' })
    [void]$sources.Add((New-SourceRecord 'session-map' $sessionPath $true 1 ([long]$si.Length) 'repo root'))
    Write-BackupLog ('source session-map.json: 1 file / ' + [string]$si.Length + ' bytes')
  } else {
    $covered = Test-Path -LiteralPath (Join-Path $protocolRoot 'session-map.json')
    $note = ('not at repo root; packaged under ' + $protocolRel)
    if (-not $covered) { $note = ('not found at repo root or ' + $protocolRel) }
    [void]$sources.Add((New-SourceRecord 'session-map' $sessionPath $false 0 0 $note))
    Write-BackupLog ('source session-map.json: ' + $note)
  }

  # ---- meta ----
  $meta = New-Object System.Collections.ArrayList
  $headRes = Invoke-Git -Repo $repo -GitArgs @('rev-parse', 'HEAD')
  $branchRes = Invoke-Git -Repo $repo -GitArgs @('rev-parse', '--abbrev-ref', 'HEAD')
  $statusRes = Invoke-Git -Repo $repo -GitArgs @('status', '--porcelain')
  $head = ''
  $branch = ''
  $dirtyCount = -1
  if ($headRes['Ok']) { $head = [string]$headRes['Text'] }
  if ($branchRes['Ok']) { $branch = [string]$branchRes['Text'] }
  if ($statusRes['Ok']) {
    if ([string]::IsNullOrWhiteSpace([string]$statusRes['Text'])) { $dirtyCount = 0 }
    else { $dirtyCount = @(([string]$statusRes['Text']) -split [string][char]10).Count }
  }
  if ($head -eq '') {
    try {
      $headFile = Join-Path $repo '.git\HEAD'
      if (Test-Path -LiteralPath $headFile) {
        $raw = (Get-Content -LiteralPath $headFile -Raw).Trim()
        $head = $raw
        Add-BackupWarning ('git rev-parse failed; HEAD read from .git/HEAD')
      }
    } catch { }
  }
  $gitInfo = New-Object System.Collections.ArrayList
  [void]$gitInfo.Add('repo: ' + $repo)
  [void]$gitInfo.Add('head: ' + $head)
  [void]$gitInfo.Add('branch: ' + $branch)
  [void]$gitInfo.Add('dirtyEntries: ' + [string]$dirtyCount)
  [void]$gitInfo.Add('collectedAt: ' + (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz'))
  if (-not $headRes['Ok']) { [void]$gitInfo.Add('gitError: ' + [string]$headRes['Text']) }
  $gitInfoText = ($gitInfo.ToArray() -join [string][char]10)
  [void]$meta.Add((New-MetaEntry 'meta/repo/git-info.txt' ([System.Text.Encoding]::UTF8.GetBytes($gitInfoText)) (Get-Date) ''))
  if ($head -eq '') { Add-BackupWarning 'repo HEAD is unknown (git unavailable and .git/HEAD unreadable)' }

  $profiles = @{}
  $devCandidates = @()
  if (-not [string]::IsNullOrWhiteSpace($StagingHome)) { $devCandidates += (Join-Path $StagingHome 'profiles\staged\cordis.patch.yml') }
  if (-not [string]::IsNullOrWhiteSpace($env:DSH_HOME)) { $devCandidates += (Join-Path $env:DSH_HOME 'profiles\staged\cordis.patch.yml') }
  $devCandidates += (Join-Path $script:DefaultStagingHome 'profiles\staged\cordis.patch.yml')
  $devPatch = ''
  foreach ($c in $devCandidates) { if (Test-Path -LiteralPath $c -PathType Leaf) { $devPatch = $c; break } }
  if ($devPatch -ne '') {
    $bytes = [System.IO.File]::ReadAllBytes($devPatch)
    $entry = New-MetaEntry 'meta/profiles/dev/cordis.patch.yml' $bytes ([System.IO.File]::GetLastWriteTime($devPatch)) $devPatch
    [void]$meta.Add($entry)
    $profiles['dev'] = @{ path = $devPatch; packaged = $true; entry = 'meta/profiles/dev/cordis.patch.yml'; bytes = [long]$bytes.Length; sha256 = [string]$entry.Sha256 }
    Write-BackupLog ('source profile dev: ' + $devPatch)
  } else {
    $profiles['dev'] = @{ path = ($devCandidates -join '; '); packaged = $false; entry = ''; bytes = [long]0; sha256 = '' }
    Add-BackupWarning ('dev profile cordis.patch.yml not found (looked for: ' + ($devCandidates -join '; ') + ')')
  }

  $relCandidates = @()
  if (-not [string]::IsNullOrWhiteSpace($UserDshHome)) { $relCandidates += (Join-Path $UserDshHome 'profiles\release\cordis.patch.yml') }
  $relCandidates += (Join-Path $repo 'release\profile\cordis.patch.yml')
  $relPatch = ''
  foreach ($c in $relCandidates) { if (Test-Path -LiteralPath $c -PathType Leaf) { $relPatch = $c; break } }
  if ($relPatch -ne '') {
    $bytes = [System.IO.File]::ReadAllBytes($relPatch)
    $entry = New-MetaEntry 'meta/profiles/release/cordis.patch.yml' $bytes ([System.IO.File]::GetLastWriteTime($relPatch)) $relPatch
    [void]$meta.Add($entry)
    $profiles['release'] = @{ path = $relPatch; packaged = $true; entry = 'meta/profiles/release/cordis.patch.yml'; bytes = [long]$bytes.Length; sha256 = [string]$entry.Sha256 }
    Write-BackupLog ('source profile release: ' + $relPatch)
  } else {
    $profiles['release'] = @{ path = ($relCandidates -join '; '); packaged = $false; entry = ''; bytes = [long]0; sha256 = '' }
    Add-BackupWarning ('release profile cordis.patch.yml not found (looked for: ' + ($relCandidates -join '; ') + ')')
  }

  $taskInfo = Get-ScheduledTaskExports -Skip:$SkipScheduledTasks
  $taskInfo['filter'] = 'automation.config.json#tasks'
  foreach ($x in @($taskInfo['xmls'])) {
    $safeName = [string]$x.Name
    $safeName = $safeName -replace '[\\/:*?"<>|]', '_'
    $entryName = 'meta/scheduled-tasks/' + $safeName + '.xml'
    $bytes = ConvertTo-Utf16LeBytes ([string]$x.Xml)
    $entry = New-MetaEntry $entryName $bytes (Get-Date) ''
    [void]$meta.Add($entry)
    [void]$sources.Add((New-SourceRecord ('scheduled-task/' + [string]$x.Name) ('Get-ScheduledTask ' + [string]$x.Name) $true 1 ([long]$bytes.Length) 'Export-ScheduledTask'))
  }
  if ([bool]$taskInfo['skipped']) {
    Add-BackupWarning ('scheduled tasks skipped: ' + [string]$taskInfo['reason'])
  }
  foreach ($f in @($taskInfo['failed'])) {
    Add-BackupWarning ('scheduled task export failed: ' + [string]$f)
  }
  if (-not [bool]$taskInfo['skipped']) {
    Write-BackupLog ('source scheduled-tasks (automation.config.json tasks): ' + [string]$taskInfo['exported'] + ' exported')
    $expectedTasks = @($script:TaskNames).Count
    if ([int]$taskInfo['exported'] -ne $expectedTasks) {
      Add-BackupWarning ('expected ' + [string]$expectedTasks + ' scheduled tasks from automation.config.json, got ' + [string]$taskInfo['exported'])
    }
  }

  $helperScriptsDir = ''
  if (-not [string]::IsNullOrWhiteSpace($DshHelperDir)) { $helperScriptsDir = Join-Path $DshHelperDir 'scripts' }
  $helperInfo = @{ Exists = $false; Count = 0; Failed = 0 }
  $helperListText = New-HelperScriptList -Dir $helperScriptsDir -Info $helperInfo
  $helperListEntryName = 'meta/dsh-helper/scripts.sha256.txt'
  [void]$meta.Add((New-MetaEntry $helperListEntryName ([System.Text.Encoding]::UTF8.GetBytes($helperListText)) (Get-Date) $helperScriptsDir))
  if (-not [bool]$helperInfo['Exists']) {
    Add-BackupWarning ('{{DSH_HELPER_DIR}} scripts dir not found: ' + $helperScriptsDir + ' (list records missing)')
  } else {
    Write-BackupLog ('source dsh-helper scripts: ' + [string]$helperInfo['Count'] + ' files hashed (' + [string]$helperInfo['Failed'] + ' failed)')
  }

  $payloadBytes = [long]0
  foreach ($p in $payload) { $payloadBytes = $payloadBytes + [long]$p.Bytes }
  $metaBytes = [long]0
  foreach ($m in $meta) { $metaBytes = $metaBytes + [long]$m.Bytes }
  $plannedCount = $payload.Count + $meta.Count
  $plannedBytes = $payloadBytes + $metaBytes

  if ($DryRun) {
    Write-BackupLog ('DRYRUN would package ' + [string]$plannedCount + ' files, ' + [string]$plannedBytes + ' bytes')
    Write-BackupLog ('DRYRUN payload=' + [string]$payload.Count + ' files/' + [string]$payloadBytes + ' bytes, meta=' + [string]$meta.Count + ' files/' + [string]$metaBytes + ' bytes')
    $excText = @()
    foreach ($k in (@($exclusions.Keys) | Sort-Object)) { $excText += ([string]$k + '=' + [string]$exclusions[$k]) }
    Write-BackupLog ('DRYRUN exclusions: ' + ($excText -join ' '))
    $retention = Invoke-BackupRetention -OutDirFull $outFull -Keep $Keep -DryRun
    Write-BackupLog 'DRYRUN: no zip and no manifest written'
    return @{ ExitCode = 0; DryRun = $true; FileCount = [int]$plannedCount; TotalBytes = [long]$plannedBytes; PayloadCount = [int]$payload.Count; MetaCount = [int]$meta.Count; PayloadBytes = [long]$payloadBytes; MetaBytes = [long]$metaBytes; Exclusions = $exclusions; Sources = $sources; Warnings = $script:Warnings; Retention = $retention }
  }

  Initialize-ZipTypes | Out-Null
  [void][System.IO.Directory]::CreateDirectory($outFull)
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $baseName = 'backup-' + $stamp
  $zipPath = Join-Path $outFull ($baseName + '.zip')
  $manifestPath = Join-Path $outFull ($baseName + '.MANIFEST.json')
  $suffix = 1
  while ((Test-Path -LiteralPath $zipPath) -or (Test-Path -LiteralPath $manifestPath)) {
    $baseName = 'backup-' + $stamp + '-' + [string]$suffix
    $zipPath = Join-Path $outFull ($baseName + '.zip')
    $manifestPath = Join-Path $outFull ($baseName + '.MANIFEST.json')
    $suffix = $suffix + 1
  }
  Write-BackupLog ('zip=' + $zipPath)

  $entries = New-Object System.Collections.ArrayList
  $failed = New-Object System.Collections.ArrayList
  $archive = $null
  try {
    $archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    foreach ($p in (@($payload) | Sort-Object Target)) {
      $entryName = 'files/' + [string]$p.Target
      try {
        $r = Add-FileToZip -Archive $archive -SourcePath ([string]$p.Full) -EntryName $entryName
        [void]$entries.Add([pscustomobject]@{ Path = $entryName; Target = [string]$p.Target; Kind = 'payload'; Bytes = [long]$r.Bytes; Sha256 = [string]$r.Sha256 })
      } catch {
        [void]$failed.Add(([string]$p.Target + ': ' + $_.Exception.Message))
        Add-BackupWarning ('pack failed: ' + [string]$p.Target + ' => ' + $_.Exception.Message)
      }
    }
    foreach ($m in (@($meta) | Sort-Object Path)) {
      $r = Add-BytesToZip -Archive $archive -EntryName ([string]$m.Path) -Bytes ([byte[]]$m.BytesData) -LastWriteTime ([datetime]$m.LastWriteTime)
      [void]$entries.Add([pscustomobject]@{ Path = [string]$m.Path; Target = $null; Kind = 'meta'; Bytes = [long]$r.Bytes; Sha256 = [string]$r.Sha256 })
    }
  } finally {
    if ($null -ne $archive) { $archive.Dispose() }
  }

  if (-not (Test-Path -LiteralPath $zipPath)) {
    Write-BackupLog ('ERROR zip not created: ' + $zipPath)
    return @{ ExitCode = 4; Message = 'zip not created' }
  }
  $zipItem = Get-Item -LiteralPath $zipPath
  $zipSha = Get-Sha256OfFile $zipPath

  $totalBytes = [long]0
  $payloadCount = 0
  $metaCount = 0
  foreach ($e in $entries) {
    $totalBytes = $totalBytes + [long]$e.Bytes
    if ([string]$e.Kind -eq 'payload') { $payloadCount = $payloadCount + 1 } else { $metaCount = $metaCount + 1 }
  }

  $ctx = @{
    Schema = $script:Schema
    ToolVersion = $script:ToolVersion
    GeneratedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    GeneratedAtUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    RepoRoot = $repo
    Head = $head
    Branch = $branch
    Dirty = $dirtyCount
    IncludeSent = [bool]$IncludeSent
    Keep = [int]$Keep
    ZipPath = $zipPath
    ZipBytes = [long]$zipItem.Length
    ZipSha = $zipSha
    FileCount = [int]$entries.Count
    TotalBytes = [long]$totalBytes
    PayloadCount = [int]$payloadCount
    PayloadBytes = [long]$payloadBytes
    MetaCount = [int]$metaCount
    MetaBytes = [long]$metaBytes
    ProfileDev = $profiles['dev']
    ProfileRelease = $profiles['release']
    ScheduledTasks = $taskInfo
    Helper = @{ dir = $helperScriptsDir; exists = [bool]$helperInfo['Exists']; count = [int]$helperInfo['Count']; failed = [int]$helperInfo['Failed']; listEntry = $helperListEntryName }
    Sources = $sources
    Exclusions = $exclusions
    Warnings = $script:Warnings
    Entries = $entries
  }
  $json = New-ManifestJson -Ctx $ctx
  Write-TextFileUtf8NoBom $manifestPath $json
  Write-BackupLog ('manifest=' + $manifestPath)

  $verify = Test-ZipAgainstEntries -ZipPath $zipPath -Entries $entries
  $verifyOk = (@($verify['Mismatches']).Count -eq 0) -and ([int]$verify['Extra'] -eq 0)
  Write-BackupLog ('zip bytes=' + [string]$zipItem.Length + ' sha256=' + $zipSha)
  Write-BackupLog ('packaged files=' + [string]$entries.Count + ' totalBytes=' + [string]$totalBytes + ' payload=' + [string]$payloadCount + ' meta=' + [string]$metaCount)
  Write-BackupLog ('verify ' + [string]$verify['Checked'] + '/' + [string]$entries.Count + ' entries against manifest: ' + $(if ($verifyOk) { 'OK' } else { 'FAILED' }))
  if (-not $verifyOk) {
    foreach ($m in @($verify['Mismatches'])) { Write-BackupLog ('verify mismatch: ' + [string]$m) }
    if ([int]$verify['Extra'] -ne 0) { Write-BackupLog ('verify extra entries in zip: ' + [string]$verify['Extra']) }
  }
  $exitCode = 0
  if (-not $verifyOk) { $exitCode = 1 }
  if (@($failed).Count -gt 0) { $exitCode = 1; Write-BackupLog ('pack failures: ' + [string]@($failed).Count) }
  $retention = $null
  if ($exitCode -eq 0) {
    $retention = Invoke-BackupRetention -OutDirFull $outFull -Keep $Keep -CurrentBase $baseName
  } else {
    Write-BackupLog 'retention: skipped (backup did not verify; nothing deleted)'
  }
  Write-BackupLog ('done exit=' + [string]$exitCode)
  return @{ ExitCode = $exitCode; ZipPath = $zipPath; ManifestPath = $manifestPath; FileCount = [int]$entries.Count; TotalBytes = [long]$totalBytes; PayloadCount = [int]$payloadCount; MetaCount = [int]$metaCount; Entries = $entries; Exclusions = $exclusions; Sources = $sources; Verify = $verify; Retention = $retention }
}

function Get-TempRoot {
  $cands = New-Object System.Collections.ArrayList
  if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) { [void]$cands.Add($env:TEMP) }
  if (-not [string]::IsNullOrWhiteSpace($env:TMP)) { [void]$cands.Add($env:TMP) }
  try { [void]$cands.Add([System.IO.Path]::GetTempPath()) } catch { }
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { [void]$cands.Add((Join-Path $env:LOCALAPPDATA 'Temp')) }
  if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) { [void]$cands.Add((Join-Path $env:USERPROFILE 'AppData\Local\Temp')) }
  foreach ($c in $cands) {
    if ([string]::IsNullOrWhiteSpace([string]$c)) { continue }
    try {
      $full = [System.IO.Path]::GetFullPath([string]$c)
      [void][System.IO.Directory]::CreateDirectory($full)
      $probe = Join-Path $full ('selftest-probe-' + [string]$PID + '.tmp')
      Write-TextFileUtf8NoBom $probe 'probe'
      Remove-Item -LiteralPath $probe -Force
      return $full
    } catch { }
  }
  return ''
}

function Invoke-ChildScript {
  param([string]$TargetScript, [string[]]$Arguments)
  $exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path -LiteralPath $exe)) { $exe = Join-Path $PSHOME 'pwsh.exe' }
  if (-not (Test-Path -LiteralPath $exe)) { $exe = 'pwsh.exe' }
  $argv = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $TargetScript) + @($Arguments)
  try {
    $output = (& $exe @argv 2>&1 | Out-String)
    $code = $LASTEXITCODE
  } catch {
    return @{ ExitCode = -99; Output = $_.Exception.Message }
  }
  return @{ ExitCode = [int]$code; Output = $output }
}

function Add-SelftestCheck {
  param([string]$Name, [bool]$Ok, [string]$Detail)
  $script:SelftestChecks = $script:SelftestChecks + 1
  $tag = 'OK  '
  if (-not $Ok) {
    $tag = 'FAIL'
    $script:SelftestFails = $script:SelftestFails + 1
  }
  $line = '[selftest] ' + $tag + ' ' + $Name
  if (-not [string]::IsNullOrWhiteSpace($Detail)) { $line = $line + ' :: ' + $Detail }
  Write-Host $line
}

function New-SelftestFixture {
  param([string]$Root)
  $specs = @(
    @{ Rel = 'repo\local\protocol\AGENTS.md'; Text = '# fixture protocol agents' },
    @{ Rel = 'repo\local\protocol\state\state.json'; Text = '{"slot":"a1","n":1}' },
    @{ Rel = 'repo\local\protocol\sent\sent-001.md'; Text = 'sent payload fixture' },
    @{ Rel = 'repo\local\protocol\AGENTS.md.bak-before-x'; Text = 'bak fixture' },
    @{ Rel = 'repo\local\protocol\notes.json.bak-20261019'; Text = 'bak fixture 2' },
    @{ Rel = 'repo\local\protocol\.credentials.yaml'; Text = 'fixture decoy, not a real credential' },
    @{ Rel = 'repo\local\protocol\token.json'; Text = '{"token":"fixture-not-real"}' },
    @{ Rel = 'repo\local\protocol\sub\.credentials.key'; Text = 'fixture decoy' },
    @{ Rel = 'repo\skills\y-task-distribution-auto\templates\a.txt'; Text = 'template a' },
    @{ Rel = 'repo\skills\y-task-distribution-auto\templates\nested\b.txt'; Text = 'template b' },
    @{ Rel = 'repo\dispatch-ledger.jsonl'; Text = '{"seq":1}' + [string][char]10 + '{"seq":2}' },
    @{ Rel = 'repo\session-map.json'; Text = '{"slots":{}}' },
    @{ Rel = 'repo\local\backups\backup-old.zip'; Text = 'old zip decoy' },
    @{ Rel = 'staging\profiles\staged\cordis.patch.yml'; Text = 'fixture dev profile patch' },
    @{ Rel = 'userdsh\profiles\release\cordis.patch.yml'; Text = 'fixture release profile patch' },
    @{ Rel = 'helper\scripts\start-x.ps1'; Text = 'Write-Host fixture-start' },
    @{ Rel = 'helper\scripts\check-y.mjs'; Text = 'export const fixture = 1;' },
    @{ Rel = 'helper\scripts\.credentials.yaml'; Text = 'fixture helper decoy' }
  )
  foreach ($s in $specs) {
    $p = Join-Path $Root ([string]$s['Rel'])
    $d = Split-Path -Parent $p
    [void][System.IO.Directory]::CreateDirectory($d)
    Write-TextFileUtf8NoBom $p ([string]$s['Text'])
  }
}

function Initialize-FixtureGit {
  param([string]$Repo)
  $oldEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $cmd = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($null -eq $cmd) { $cmd = Get-Command git -ErrorAction SilentlyContinue }
  if ($null -eq $cmd) { $ErrorActionPreference = $oldEap; return $false }
  try {
    $null = & $cmd.Source -C $Repo init -q 2>&1
    $initCode = $LASTEXITCODE
    $null = & $cmd.Source -C $Repo -c 'user.email=selftest@example.invalid' -c 'user.name=selftest' add -A 2>&1
    $addCode = $LASTEXITCODE
    $null = & $cmd.Source -C $Repo -c 'user.email=selftest@example.invalid' -c 'user.name=selftest' commit -q -m 'selftest fixture' 2>&1
    $commitCode = $LASTEXITCODE
    $ErrorActionPreference = $oldEap
    return (($initCode -eq 0) -and ($addCode -eq 0) -and ($commitCode -eq 0))
  } catch {
    $ErrorActionPreference = $oldEap
    return $false
  }
}

function Get-ManifestFile([string]$PathValue) {
  $raw = [System.IO.File]::ReadAllText($PathValue, [System.Text.Encoding]::UTF8)
  return ($raw | ConvertFrom-Json)
}

function Invoke-SelfTest {
  $script:SelftestChecks = 0
  $script:SelftestFails = 0
  $tempRoot = Get-TempRoot
  if ($tempRoot -eq '') {
    Write-Host '[selftest] FAIL cannot find a writable temp directory'
    return 1
  }
  $root = Join-Path $tempRoot ('automation-backup-selftest-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '-' + [string]$PID)
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
  [void][System.IO.Directory]::CreateDirectory($root)
  $fixtureRepo = Join-Path $root 'repo'
  $fixtureHelper = Join-Path $root 'helper'
  $fixtureStaging = Join-Path $root 'staging'
  $fixtureUserDsh = Join-Path $root 'userdsh'
  $out1 = Join-Path $root 'out1'
  $out2 = Join-Path $root 'out2'
  $out3 = Join-Path $root 'out3'
  $restore1 = Join-Path $root 'restored'
  $restore2 = Join-Path $root 'restored-conflict'
  Write-Host ('[selftest] temp fixture: ' + $root)
  New-SelftestFixture $root
  $gitOk = Initialize-FixtureGit $fixtureRepo
  Add-SelftestCheck 'fixture built' (Test-Path -LiteralPath (Join-Path $fixtureRepo 'local\protocol\AGENTS.md')) ('gitFixture=' + [string]$gitOk)

  $restoreScript = Join-Path $script:ScriptDir 'automation-restore.ps1'
  $defaultRepo = Get-DefaultRepoRoot
  Add-SelftestCheck 'default repo root is this checkout' ((Test-Path -LiteralPath (Join-Path $defaultRepo 'local\protocol')) -and (Test-Path -LiteralPath (Join-Path $defaultRepo 'scripts\automation-backup.ps1'))) $defaultRepo
  Add-SelftestCheck 'sibling restore script present' (Test-Path -LiteralPath $restoreScript) $restoreScript
  if (-not (Test-Path -LiteralPath $restoreScript)) {
    Write-Host ('[selftest] FAILED ' + [string]$script:SelftestFails + '/' + [string]$script:SelftestChecks + ' checks failed; fixture kept at ' + $root)
    return 1
  }

  $r1 = Invoke-ChildScript -TargetScript $script:ScriptPath -Arguments @('-RepoRoot', $fixtureRepo, '-OutDir', $out1, '-DshHelperDir', $fixtureHelper, '-StagingHome', $fixtureStaging, '-UserDshHome', $fixtureUserDsh, '-SkipScheduledTasks')
  Add-SelftestCheck 'backup child exit=0' ($r1['ExitCode'] -eq 0) ('exit=' + [string]$r1['ExitCode'])
  if ($r1['ExitCode'] -ne 0) { Write-Host $r1['Output'] }
  $zipFiles = @()
  if (Test-Path -LiteralPath $out1) { $zipFiles = @(Get-ChildItem -LiteralPath $out1 -Filter '*.zip' -File) }
  Add-SelftestCheck 'one zip produced' ($zipFiles.Count -eq 1) ('count=' + [string]$zipFiles.Count)
  if ($zipFiles.Count -ne 1) {
    Write-Host ('[selftest] FAILED ' + [string]$script:SelftestFails + '/' + [string]$script:SelftestChecks + ' checks failed; fixture kept at ' + $root)
    return 1
  }
  $zipPath = [string]$zipFiles[0].FullName
  $manifestPath = Join-Path $out1 ([System.IO.Path]::GetFileNameWithoutExtension($zipPath) + '.MANIFEST.json')
  Add-SelftestCheck 'manifest written next to zip' (Test-Path -LiteralPath $manifestPath) $manifestPath
  $man = Get-ManifestFile $manifestPath
  Add-SelftestCheck 'manifest fileCount matches files array' ([int]$man.fileCount -eq @($man.files).Count) ('fileCount=' + [string]$man.fileCount + ' files=' + [string](@($man.files).Count))
  Add-SelftestCheck 'manifest totalBytes matches files array' ([long]$man.totalBytes -eq ([long](@($man.files) | Measure-Object -Property bytes -Sum).Sum)) ('totalBytes=' + [string]$man.totalBytes)
  Add-SelftestCheck 'manifest fileCount=10 (payload 6 + meta 4)' ([int]$man.fileCount -eq 10) ('fileCount=' + [string]$man.fileCount)
  Add-SelftestCheck 'payloadCount=6 (sent/bak/credentials excluded)' ([int]$man.payloadCount -eq 6) ('payloadCount=' + [string]$man.payloadCount)
  Add-SelftestCheck 'metaCount=4 (git-info, dev, release, helper list)' ([int]$man.metaCount -eq 4) ('metaCount=' + [string]$man.metaCount)
  Add-SelftestCheck 'dev profile patch packaged' ([bool]$man.profileDev.packaged) ('entry=' + [string]$man.profileDev.entry)
  Add-SelftestCheck 'release profile patch packaged' ([bool]$man.profileRelease.packaged) ('entry=' + [string]$man.profileRelease.entry)
  Add-SelftestCheck 'helper list has 2 entries (credentials excluded)' ([int]$man.dshHelper.count -eq 2) ('count=' + [string]$man.dshHelper.count)
  if ($gitOk) {
    $headRes = & (Get-Command git.exe -ErrorAction SilentlyContinue).Source -C $fixtureRepo rev-parse HEAD 2>$null
    $head = ([string]$headRes).Trim()
    Add-SelftestCheck 'manifest sourceRepoHead = fixture HEAD' ([string]$man.sourceRepoHead -eq $head) ('head=' + [string]$man.sourceRepoHead)
  }
  $verify = Test-ZipAgainstEntries -ZipPath $zipPath -Entries @($man.files)
  Add-SelftestCheck 'every zip entry sha256 = manifest' ((@($verify['Mismatches']).Count -eq 0) -and ([int]$verify['Extra'] -eq 0)) ('checked=' + [string]$verify['Checked'] + ' mismatches=' + [string](@($verify['Mismatches']).Count) + ' extra=' + [string]$verify['Extra'])
  if (@($verify['Mismatches']).Count -gt 0) {
    foreach ($m in @($verify['Mismatches'])) { Write-Host ('[selftest]   ' + [string]$m) }
  }
  $entryNames = @($man.files | ForEach-Object { [string]$_.path })
  $leaks = @($entryNames | Where-Object { $_ -match '(?i)credentials|token|\.bak|(^|/)sent/|(^|/)local/backups/' })
  Add-SelftestCheck 'no credentials/token/bak/sent/local-backups entry' ($leaks.Count -eq 0) ('leaks=' + [string]$leaks.Count)
  $tplEntries = @($entryNames | Where-Object { $_ -eq 'files/skills/y-task-distribution-auto/templates/a.txt' })
  $oldTplEntries = @($entryNames | Where-Object { $_ -like 'files/templates/*' })
  Add-SelftestCheck 'templates packaged under skills/y-task-distribution-auto/templates' (($tplEntries.Count -eq 1) -and ($oldTplEntries.Count -eq 0)) ('skillsEntries=' + [string]$tplEntries.Count + ' rootTemplatesEntries=' + [string]$oldTplEntries.Count)
  Add-SelftestCheck 'manifest carries sourceRepoHead' (-not [string]::IsNullOrWhiteSpace([string]$man.sourceRepoHead)) ('head=' + [string]$man.sourceRepoHead)
  Add-SelftestCheck 'manifest generatedAt present' (-not [string]::IsNullOrWhiteSpace([string]$man.generatedAt)) ([string]$man.generatedAt)

  $r2 = Invoke-ChildScript -TargetScript $restoreScript -Arguments @('-Backup', $zipPath, '-Dest', $restore1)
  Add-SelftestCheck 'restore dry-run exit=0' ($r2['ExitCode'] -eq 0) ('exit=' + [string]$r2['ExitCode'])
  $dryFiles = @()
  if (Test-Path -LiteralPath $restore1) { $dryFiles = @(Get-ChildItem -LiteralPath $restore1 -Recurse -Force -File) }
  Add-SelftestCheck 'restore dry-run wrote nothing' ($dryFiles.Count -eq 0) ('files=' + [string]$dryFiles.Count)

  $r3 = Invoke-ChildScript -TargetScript $restoreScript -Arguments @('-Backup', $zipPath, '-Dest', $restore1, '-Apply')
  Add-SelftestCheck 'restore apply exit=0' ($r3['ExitCode'] -eq 0) ('exit=' + [string]$r3['ExitCode'])
  $payloadEntries = @($man.files | Where-Object { [string]$_.kind -eq 'payload' })
  $restoredBad = 0
  foreach ($p in $payloadEntries) {
    $dst = Join-Path $restore1 (([string]$p.target) -replace '/', '\')
    if (-not (Test-Path -LiteralPath $dst -PathType Leaf)) { $restoredBad = $restoredBad + 1; continue }
    if ((Get-Sha256OfFile $dst) -ne [string]$p.sha256) { $restoredBad = $restoredBad + 1 }
  }
  Add-SelftestCheck 'restored payload files sha256 match manifest' ($restoredBad -eq 0) ('files=' + [string]$payloadEntries.Count + ' bad=' + [string]$restoredBad)

  $guardDir = Join-Path $restore2 'local\protocol'
  [void][System.IO.Directory]::CreateDirectory($guardDir)
  Write-TextFileUtf8NoBom (Join-Path $guardDir 'AGENTS.md') 'PRE-EXISTING'
  $r4 = Invoke-ChildScript -TargetScript $restoreScript -Arguments @('-Backup', $zipPath, '-Dest', $restore2, '-Apply')
  Add-SelftestCheck 'restore refuses non-empty dest without -Force' ($r4['ExitCode'] -eq 2) ('exit=' + [string]$r4['ExitCode'])
  $guardText = [System.IO.File]::ReadAllText((Join-Path $guardDir 'AGENTS.md'))
  Add-SelftestCheck 'refused restore left target untouched' ($guardText -eq 'PRE-EXISTING') $guardText
  $r5 = Invoke-ChildScript -TargetScript $restoreScript -Arguments @('-Backup', $zipPath, '-Dest', $restore2, '-Apply', '-Force')
  Add-SelftestCheck 'restore -Force exit=0' ($r5['ExitCode'] -eq 0) ('exit=' + [string]$r5['ExitCode'])
  $conflictDirs = @()
  $conflictBase = Join-Path $restore2 'local\backups'
  if (Test-Path -LiteralPath $conflictBase) { $conflictDirs = @(Get-ChildItem -LiteralPath $conflictBase -Directory -Filter 'restore-conflict-*') }
  Add-SelftestCheck 'conflict backup dir created' ($conflictDirs.Count -eq 1) ('dirs=' + [string]$conflictDirs.Count)
  if ($conflictDirs.Count -eq 1) {
    $saved = Join-Path $conflictDirs[0].FullName 'local\protocol\AGENTS.md'
    $savedOk = (Test-Path -LiteralPath $saved) -and ([System.IO.File]::ReadAllText($saved) -eq 'PRE-EXISTING')
    Add-SelftestCheck 'conflict backup holds pre-existing bytes' $savedOk $saved
  } else {
    Add-SelftestCheck 'conflict backup holds pre-existing bytes' $false 'no conflict dir'
  }
  $restoredText = [System.IO.File]::ReadAllText((Join-Path $guardDir 'AGENTS.md'))
  Add-SelftestCheck 'forced restore overwrote target' ($restoredText -ne 'PRE-EXISTING') ('len=' + [string]$restoredText.Length)

  $r6 = Invoke-ChildScript -TargetScript $script:ScriptPath -Arguments @('-RepoRoot', $fixtureRepo, '-OutDir', $out2, '-DshHelperDir', $fixtureHelper, '-StagingHome', $fixtureStaging, '-UserDshHome', $fixtureUserDsh, '-SkipScheduledTasks', '-IncludeSent')
  $zip2 = @()
  if (Test-Path -LiteralPath $out2) { $zip2 = @(Get-ChildItem -LiteralPath $out2 -Filter '*.zip' -File) }
  Add-SelftestCheck 'backup -IncludeSent exit=0' ($r6['ExitCode'] -eq 0) ('exit=' + [string]$r6['ExitCode'])
  if ($zip2.Count -eq 1) {
    $man2 = Get-ManifestFile (Join-Path $out2 ([System.IO.Path]::GetFileNameWithoutExtension($zip2[0].FullName) + '.MANIFEST.json'))
    Add-SelftestCheck '-IncludeSent adds sent/ (11 files)' ([int]$man2.fileCount -eq 11) ('fileCount=' + [string]$man2.fileCount)
  } else {
    Add-SelftestCheck '-IncludeSent adds sent/ (11 files)' $false ('zipCount=' + [string]$zip2.Count)
  }

  $dry = Invoke-Backup -RepoRoot $fixtureRepo -OutDir $out3 -DshHelperDir $fixtureHelper -StagingHome $fixtureStaging -UserDshHome $fixtureUserDsh -SkipScheduledTasks -DryRun
  Add-SelftestCheck 'in-process -DryRun exit=0' ([int]$dry['ExitCode'] -eq 0) ('exit=' + [string]$dry['ExitCode'])
  Add-SelftestCheck 'in-process -DryRun counts 10 files' ([int]$dry['FileCount'] -eq 10) ('files=' + [string]$dry['FileCount'] + ' bytes=' + [string]$dry['TotalBytes'])
  Add-SelftestCheck '-DryRun wrote no zip' (-not (Test-Path -LiteralPath $out3)) ('out3exists=' + [string](Test-Path -LiteralPath $out3))
  $r7 = Invoke-ChildScript -TargetScript $script:ScriptPath -Arguments @('-RepoRoot', $fixtureRepo, '-OutDir', $out3, '-DshHelperDir', $fixtureHelper, '-StagingHome', $fixtureStaging, '-UserDshHome', $fixtureUserDsh, '-SkipScheduledTasks', '-DryRun')
  Add-SelftestCheck 'child -DryRun exit=0 and no zip' (($r7['ExitCode'] -eq 0) -and (-not (Test-Path -LiteralPath $out3))) ('exit=' + [string]$r7['ExitCode'])

  # ---- retention (-Keep) ----
  $retDir = Join-Path $root 'retention'
  [void][System.IO.Directory]::CreateDirectory($retDir)
  $oldBases = @('backup-20200101-000000', 'backup-20200102-000000', 'backup-20200103-000000')
  $day = 0
  foreach ($bn in $oldBases) {
    $day = $day + 1
    $t = Get-Date -Year 2020 -Month 1 -Day $day -Hour 0 -Minute 0 -Second 0
    $zp = Join-Path $retDir ($bn + '.zip')
    $mp = Join-Path $retDir ($bn + '.MANIFEST.json')
    Write-TextFileUtf8NoBom $zp 'fake old zip (never opened)'
    Write-TextFileUtf8NoBom $mp '{"fake":true}'
    (Get-Item -LiteralPath $zp).LastWriteTime = $t
    (Get-Item -LiteralPath $mp).LastWriteTime = $t
  }
  $rKeep = Invoke-ChildScript -TargetScript $script:ScriptPath -Arguments @('-RepoRoot', $fixtureRepo, '-OutDir', $retDir, '-DshHelperDir', $fixtureHelper, '-StagingHome', $fixtureStaging, '-UserDshHome', $fixtureUserDsh, '-SkipScheduledTasks', '-Keep', '2')
  Add-SelftestCheck 'backup -Keep 2 exit=0' ($rKeep['ExitCode'] -eq 0) ('exit=' + [string]$rKeep['ExitCode'])
  $keepZips = @(Get-ChildItem -LiteralPath $retDir -Filter '*.zip' -File)
  $keepMans = @(Get-ChildItem -LiteralPath $retDir -Filter '*.MANIFEST.json' -File)
  $oldestGone = (-not (Test-Path -LiteralPath (Join-Path $retDir 'backup-20200101-000000.zip'))) -and (-not (Test-Path -LiteralPath (Join-Path $retDir 'backup-20200101-000000.MANIFEST.json')))
  $newestOldKept = Test-Path -LiteralPath (Join-Path $retDir 'backup-20200103-000000.zip')
  Add-SelftestCheck '-Keep 2 keeps newest 2 pairs' (($keepZips.Count -eq 2) -and ($keepMans.Count -eq 2) -and $oldestGone -and $newestOldKept) ('zips=' + [string]$keepZips.Count + ' manifests=' + [string]$keepMans.Count + ' oldestGone=' + [string]$oldestGone + ' newestOldKept=' + [string]$newestOldKept)
  $delLogOk = ($rKeep['Output'] -match 'retention delete: backup-20200101-000000\.zip \(\d+ bytes\)') -and ($rKeep['Output'] -match 'retention delete: backup-20200102-000000\.MANIFEST\.json \(\d+ bytes\)')
  Add-SelftestCheck '-Keep prints each delete file + bytes before deleting' $delLogOk ('deleteLines=' + [string]$delLogOk)
  $rKeep0 = Invoke-ChildScript -TargetScript $script:ScriptPath -Arguments @('-RepoRoot', $fixtureRepo, '-OutDir', $retDir, '-DshHelperDir', $fixtureHelper, '-StagingHome', $fixtureStaging, '-UserDshHome', $fixtureUserDsh, '-SkipScheduledTasks', '-Keep', '0', '-DryRun')
  Add-SelftestCheck '-Keep 0 disables cleanup' (($rKeep0['ExitCode'] -eq 0) -and ($rKeep0['Output'] -match 'retention: disabled')) ('exit=' + [string]$rKeep0['ExitCode'])

  $lockDir = Join-Path $root 'retention-locked'
  [void][System.IO.Directory]::CreateDirectory($lockDir)
  $day = 0
  foreach ($bn in $oldBases) {
    $day = $day + 1
    $t = Get-Date -Year 2020 -Month 1 -Day $day -Hour 0 -Minute 0 -Second 0
    $zp = Join-Path $lockDir ($bn + '.zip')
    $mp = Join-Path $lockDir ($bn + '.MANIFEST.json')
    Write-TextFileUtf8NoBom $zp 'fake old zip (never opened)'
    Write-TextFileUtf8NoBom $mp '{"fake":true}'
    (Get-Item -LiteralPath $zp).LastWriteTime = $t
    (Get-Item -LiteralPath $mp).LastWriteTime = $t
  }
  $lockedZip = Join-Path $lockDir 'backup-20200101-000000.zip'
  $lock = [System.IO.File]::Open($lockedZip, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
  try {
    $rLock = Invoke-ChildScript -TargetScript $script:ScriptPath -Arguments @('-RepoRoot', $fixtureRepo, '-OutDir', $lockDir, '-DshHelperDir', $fixtureHelper, '-StagingHome', $fixtureStaging, '-UserDshHome', $fixtureUserDsh, '-SkipScheduledTasks', '-Keep', '2')
  } finally {
    $lock.Dispose()
  }
  $lockWarnOk = ($rLock['ExitCode'] -eq 0) -and ($rLock['Output'] -match 'retention delete failed') -and ($rLock['Output'] -match 'non-fatal')
  Add-SelftestCheck 'delete failure warns and exit stays 0' $lockWarnOk ('exit=' + [string]$rLock['ExitCode'])
  $lockContinueOk = (Test-Path -LiteralPath $lockedZip) -and (-not (Test-Path -LiteralPath (Join-Path $lockDir 'backup-20200101-000000.MANIFEST.json'))) -and (-not (Test-Path -LiteralPath (Join-Path $lockDir 'backup-20200102-000000.zip')))
  Add-SelftestCheck 'delete failure does not stop later deletes' $lockContinueOk 'lockedZipKept-manifestDeleted'

  $summary = '[selftest] ' + [string]$script:SelftestChecks + ' checks, ' + [string]$script:SelftestFails + ' failed'
  if ($script:SelftestFails -eq 0) {
    Write-Host ($summary + ' - PASS')
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    return 0
  }
  Write-Host ($summary + ' - FAILED; fixture kept at ' + $root)
  return 1
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
if ($SelfTest) {
  $rc = Invoke-SelfTest
  exit $rc
}

$repo = Get-DefaultRepoRoot
if (-not [string]::IsNullOrWhiteSpace($RepoRoot)) { $repo = Get-NormalizedDir $RepoRoot }

$helperDir = $DshHelperDir
if ([string]::IsNullOrWhiteSpace($helperDir)) {
  if (-not [string]::IsNullOrWhiteSpace($env:DSH_HELPER)) { $helperDir = $env:DSH_HELPER }
  elseif (Test-Path -LiteralPath $script:DefaultDshHelper) { $helperDir = $script:DefaultDshHelper }
  else { $helperDir = '' }
}
$staging = $StagingHome
if ([string]::IsNullOrWhiteSpace($staging)) {
  if (-not [string]::IsNullOrWhiteSpace($env:DSH_HOME)) { $staging = $env:DSH_HOME }
  elseif (Test-Path -LiteralPath $script:DefaultStagingHome) { $staging = $script:DefaultStagingHome }
  else { $staging = '' }
}
$userDsh = $UserDshHome
if ([string]::IsNullOrWhiteSpace($userDsh)) { $userDsh = $script:DefaultUserDshHome }
if ([string]::IsNullOrWhiteSpace($userDsh)) { $userDsh = '' }

$result = Invoke-Backup -RepoRoot $repo -OutDir $OutDir -IncludeSent:$IncludeSent -Keep $Keep -DryRun:$DryRun -DshHelperDir $helperDir -StagingHome $staging -UserDshHome $userDsh -SkipScheduledTasks:$SkipScheduledTasks
if ([int]$result['ExitCode'] -ne 0) { exit [int]$result['ExitCode'] }
exit 0
