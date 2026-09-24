param(
  [switch]$Rollback,
  [switch]$Check,
  [string]$Vbs = ""
)
$ErrorActionPreference = "Stop"
# NOTE: param() MUST be the first statement in this file. Anything executable
# above it -- even $ErrorActionPreference = "Stop" -- makes PowerShell stop
# seeing a param block at all and parse the parentheses as a command call.
# So the settings line lives *below* the param block, not above it.
#
# NOTE: intentionally pure ASCII -- PowerShell 5.1 parses a BOM-less .ps1 as
# ANSI/GBK on this machine, so non-ASCII literals here would corrupt paths.
#
# ===========================================================================
# WHY THIS FILE EXISTS  (2026-09-24, real incident on the dev machine)
#
# The skin launcher is normally reached through the desktop / start-menu
# shortcut. But WorkBuddy ALSO registers an autostart entry under
#     HKCU\Software\Microsoft\Windows\CurrentVersion\Run
# named "WorkBuddy.WorkBuddy", pointing straight at WorkBuddy.exe.
#
# At boot Windows runs THAT entry, not the shortcut. So the launcher vbs never
# runs, and neither does the CodeDrobe theme injection it performs. The page
# then has no theme layer at all -- and every skin-layer rule is prefixed with
# "html.codedrobe-host-workbuddy", so the entire layer silently stops matching.
#
# The symptom is badly misleading: CDP still answers (the debugging port comes
# from an environment variable, so it is open no matter who started the app),
# and the wallpaper write still reports success -- only the read-back is empty.
# It looks like "changing the wallpaper is broken", when in fact no theme was
# ever injected.
#
# FIX: repoint the autostart VALUE at the launcher vbs.
# The value NAME is deliberately left untouched:
#   * WorkBuddy's own "launch at login" toggle keeps reading as enabled, so it
#     will not get switched back on and create a SECOND entry -- two entries
#     would start two instances;
#   * worst case, WorkBuddy rewrites the value and we are back to "no skin" --
#     never to "two instances".
#
# Only EXISTING entries are repointed. This script never creates one: whether
# to start at login is the user's decision, not ours.
# ===========================================================================

$root   = Split-Path -Parent $PSScriptRoot
$backup = Join-Path $root "backup"
if (-not (Test-Path -LiteralPath $backup)) { New-Item -ItemType Directory -Path $backup | Out-Null }
if (-not $Vbs) { $Vbs = Join-Path $root "launcher\workbuddy-skin-launcher.vbs" }

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

function Get-RunEntries {
  $out = @()
  if (-not (Test-Path -LiteralPath $runKey)) { return $out }
  $props = Get-ItemProperty -Path $runKey
  foreach ($p in $props.PSObject.Properties) {
    if ($p.Name -like "PS*") { continue }
    $v = [string]$p.Value
    # Match BOTH "still points at WorkBuddy.exe" (not taken over yet) AND
    # "already points at our launcher vbs" (taken over on an earlier run).
    #
    # Why both, and why this is not optional: once we repoint the value it no
    # longer contains "WorkBuddy.exe" anywhere -- it becomes
    #     "<wscript>" "<...>\workbuddy-skin-launcher.vbs"
    # So a filter that only looks for "WorkBuddy.exe" stops seeing the entry
    # it just wrote. Observed 2026-09-24 on the dev machine: the registry held
    # the repointed value while this script reported
    #     NONE (no HKCU Run value points at WorkBuddy.exe)
    # which reads as "this machine does not autostart WorkBuddy" -- the exact
    # opposite of the truth. It also made -Check useless for telling
    # "never had one" apart from "already taken over", and left the
    # ALREADY-OURS branch below as dead code that could never run.
    if ($v -match "WorkBuddy\.exe" -or $v -match "workbuddy-skin-launcher\.vbs") {
      $out += [pscustomobject]@{ Name = $p.Name; Value = $v }
    }
  }
  return ,$out
}

function New-LauncherValue {
  $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
  return ('"' + $wscript + '" "' + $Vbs + '"')
}

# ------------------------------------------------------------------ rollback
if ($Rollback) {
  Write-Output "--- startup autostart: rollback ---"
  $files = @(Get-ChildItem -LiteralPath $backup -Filter "hkcu-run-*.original.json" -ErrorAction SilentlyContinue)
  if ($files.Count -eq 0) { Write-Output "NO-BACKUP (nothing recorded, nothing to restore)"; Write-Output "DONE"; exit 0 }
  foreach ($f in $files) {
    # JSON record -- see the long note at the backup site for why the original
    # hand-rolled "name=... / value=..." text format was abandoned.
    $rec   = Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json
    $name  = [string]$rec.name
    $value = [string]$rec.value
    if (-not $name) { continue }
    Set-ItemProperty -Path $runKey -Name $name -Value $value
    # NOTE: value names may contain dots ("WorkBuddy.WorkBuddy"). Writing
    # $obj.$name would be parsed as a property CHAIN and silently yield $null,
    # which turns this read-back into a false negative (it reported
    # nowPointsAtOurVbs=False while the raw registry already held the new
    # value). Always read back through the indexer / Get-ItemPropertyValue.
    $back = [string](Get-ItemPropertyValue -Path $runKey -Name $name)
    Write-Output ("RESTORED name=" + $name + " matches=" + ($back -eq $value))
  }
  Write-Output "DONE"
  exit 0
}

# --------------------------------------------------------------------- check
Write-Output "--- startup autostart: HKCU Run entries that launch WorkBuddy ---"
$entries = Get-RunEntries
if ($entries.Count -eq 0) {
  Write-Output "NONE (no HKCU Run value launches WorkBuddy, by exe or by our launcher vbs)"
  Write-Output "DONE"
  exit 0
}
foreach ($e in $entries) {
  Write-Output ("FOUND name=" + $e.Name + " value=" + $e.Value)
  Write-Output ("  alreadyOurs=" + ($e.Value -match "workbuddy-skin-launcher\.vbs"))
}
if ($Check) { Write-Output "DONE"; exit 0 }

# ------------------------------------------------------------------- repoint
$want    = New-LauncherValue
$changed = 0
foreach ($e in $entries) {
  if ($e.Value -match "workbuddy-skin-launcher\.vbs") {
    Write-Output ("ALREADY-OURS name=" + $e.Name)
    continue
  }
  $safe = ($e.Name -replace '[\\/:*?"<>|]', '_')
  $bak  = Join-Path $backup ("hkcu-run-" + $safe + ".original.json")
  if (-not (Test-Path -LiteralPath $bak)) {
    # JSON, NOT a hand-rolled two-line text file.
    #
    # The first version wrote @("name=" + $e.Name, "value=" + $e.Value) and that
    # silently collapsed into ONE line: PowerShell binds "," tighter than "+",
    # so the expression parsed as  "name=" + ($e.Name, "value=") + $e.Value  --
    # the middle array stringified to "$e.Name value=" and "+" glued the value
    # on. Result: "name=WorkBuddy.WorkBuddy value=D:\...\WorkBuddy.exe".
    #
    # That one line then broke the rollback path: it read the WHOLE line as the
    # value NAME and wrote an empty value, leaving a junk entry in HKCU Run and
    # reporting matches=True because "" -eq "". JSON has no separator to get
    # wrong, so this class of bug cannot come back.
    $json = [pscustomobject]@{ name = $e.Name; value = $e.Value } | ConvertTo-Json -Compress
    Set-Content -LiteralPath $bak -Encoding UTF8 -Value $json
    Write-Output ("BACKUP -> " + (Split-Path $bak -Leaf))
  }
  Set-ItemProperty -Path $runKey -Name $e.Name -Value $want
  $back = [string](Get-ItemPropertyValue -Path $runKey -Name $e.Name)
  Write-Output ("REPOINTED name=" + $e.Name + " nowPointsAtOurVbs=" + ($back -match "workbuddy-skin-launcher\.vbs"))
  $changed++
}
Write-Output ("CHANGED " + $changed)
Write-Output "DONE"
