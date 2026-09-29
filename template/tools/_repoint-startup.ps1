param(
  [switch]$Check,
  [switch]$Rollback
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
# WHAT THIS FILE DOES NOW  (rewritten 2026-09-29)
#
# HISTORY, because the wrong version of this file cost two incidents.
#
# 2026-09-24: the skin's "restores after reboot" promise was false. WorkBuddy
# registers its own autostart entry under
#     HKCU\Software\Microsoft\Windows\CurrentVersion\Run\WorkBuddy.WorkBuddy
# pointing at WorkBuddy.exe. At boot Windows runs THAT, not the desktop
# shortcut -- so the launcher vbs never ran and the CodeDrobe theme layer was
# never injected. Every skin-layer rule is prefixed with
# "html.codedrobe-host-workbuddy", so the whole layer silently stops matching.
# The first fix was: repoint that value at our launcher vbs, keeping the value
# NAME untouched so WorkBuddy's own toggle would still read as enabled.
#
# 2026-09-29: the same symptom came back. It turns out the first fix cannot
# work, and here is the proof from the app's own code
# (src/main/features/desktop-host/auto-launch-controller.ts):
#
#     reconcileOnStartup() -> getEnabled():
#         const settings = app.getLoginItemSettings();
#         const desired  = await readAutoLaunchDesired();
#         if (desired === false) { setCurrentBundleAutoLaunch(false); return false; }
#         if (desired === true || settings.openAtLogin === true)
#             return enableCurrentBundleAutoLaunch(desired !== true);
#         ... default-on ...
#         return enableCurrentBundleAutoLaunch(true);
#
#     enableCurrentBundleAutoLaunch() -> setCurrentBundleAutoLaunch(true)
#         -> app.setLoginItemSettings({ openAtLogin: true })
#
# setLoginItemSettings() on Windows writes that Run value back to the app's own
# exe. EVERY branch ends in that same write, and it runs on every app start.
# So the value is ours only until the next time WorkBuddy launches.
#
# The old design note was exactly backwards: keeping the value name is what
# GUARANTEES the rewrite. getLoginItemSettings() finds the value present, so
# openAtLogin reads true, which is one of the two conditions on the rewrite
# line.
#
# Timeline measured on this machine:
#   09-24 11:27  we repointed the value at our vbs
#   09-27 08:02  the vbs ran at boot, then the app started and rewrote the value
#   09-28 10:29  app log [AutoLaunch] read state {desired:true, openAtLogin:true},
#                no launcher log entry -> already bypassing the launcher again
#   09-29 09:24  same, user reports "the skin is gone again"
#
# So: we stop competing for that value. It belongs to the app; let it own it.
# The durable place for our entry is the per-user Startup folder, installed by
# tools\_install-startup-entry.ps1 -- a location the app does not manage.
#
# WHAT THIS SCRIPT IS FOR NOW
#   - default / -Check : report the Run entries and say whether any of them is
#                        still pointed at our launcher (a leftover from the old
#                        design, on machines that ran it).
#   - default (no flag): ALSO hand any such entry back -- restore the original
#                        value we saved in backup\hkcu-run-<name>.original.json.
#   - -Rollback        : accepted as an alias of the default, because that is
#                        what the flag used to mean and older docs still say so.
#
# THREE SELF-IMPOSED RULES (unchanged):
#   - we never CREATE a Run entry -- whether to start at login is the user's call
#   - we never DELETE one either (that would silently switch the user's
#     autostart off) -- the value name always stays, only its value is restored
#   - the original value is kept in backup\ as JSON, so this is reversible
#
# The file name is kept deliberately. "Repoint" is still accurate -- it now
# repoints the value back to the app instead of away from it -- and renaming it
# would ripple through the publish chain, the initializer and three documents
# for no functional gain.
# ===========================================================================

$root   = Split-Path -Parent $PSScriptRoot
$backup = Join-Path $root "backup"
if (-not (Test-Path -LiteralPath $backup)) { New-Item -ItemType Directory -Path $backup | Out-Null }

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

function Get-RunEntries {
  $out = @()
  if (-not (Test-Path -LiteralPath $runKey)) { return $out }
  $props = Get-ItemProperty -Path $runKey
  foreach ($p in $props.PSObject.Properties) {
    if ($p.Name -like "PS*") { continue }
    $v = [string]$p.Value
    # Match BOTH "points at WorkBuddy.exe" (the normal state, the app owns it)
    # AND "still points at our launcher vbs" (a leftover from the old design).
    #
    # Why both, and why this is not optional: an earlier version matched only
    # "WorkBuddy.exe", so once the value was ours this script stopped seeing the
    # entry it had just written and reported
    #     NONE (no HKCU Run value points at WorkBuddy.exe)
    # which reads as "this machine does not autostart WorkBuddy" -- the exact
    # opposite of the truth. Observed 2026-09-24.
    if ($v -match "WorkBuddy\.exe" -or $v -match "workbuddy-skin-launcher\.vbs") {
      $out += [pscustomobject]@{ Name = $p.Name; Value = $v }
    }
  }
  return ,$out
}

# ------------------------------------------------------------------ report
Write-Output "--- startup autostart: HKCU Run entries that launch WorkBuddy ---"
$entries = Get-RunEntries
if ($entries.Count -eq 0) {
  Write-Output "NONE (no HKCU Run value launches WorkBuddy, by exe or by our launcher vbs)"
  Write-Output "DONE"
  exit 0
}

$ours = @()
foreach ($e in $entries) {
  Write-Output ("FOUND name=" + $e.Name + " value=" + $e.Value)
  $isOurs = ($e.Value -match "workbuddy-skin-launcher\.vbs")
  Write-Output ("  alreadyOurs=" + $isOurs)
  if ($isOurs) { $ours += $e } else { Write-Output ("NORMAL " + $e.Name) }
}

if ($Check) { Write-Output "CHANGED 0"; Write-Output "DONE"; exit 0 }

# ------------------------------------------------------------------ restore
$changed = 0
foreach ($e in $ours) {
  $safe = ($e.Name -replace '[\\/:*?"<>|]', '_')
  $bak  = Join-Path $backup ("hkcu-run-" + $safe + ".original.json")
  if (-not (Test-Path -LiteralPath $bak)) {
    # We repointed it but kept no record of what it was. Do NOT guess at a
    # replacement -- writing a made-up value into the user's autostart entry is
    # worse than leaving it alone.
    Write-Output ("RESTORE-NO-BACKUP name=" + $e.Name)
    continue
  }
  $rec = Get-Content -LiteralPath $bak -Raw | ConvertFrom-Json
  if (([string]$rec.name) -ne $e.Name) {
    # A name mismatch means the backup file belongs to a different entry.
    # Refuse rather than restore the wrong thing.
    Write-Output ("RESTORE-NAME-MISMATCH name=" + $e.Name)
    continue
  }
  $orig = [string]$rec.value
  Set-ItemProperty -Path $runKey -Name $e.Name -Value $orig
  # Read back through the indexer: value names contain dots
  # ("WorkBuddy.WorkBuddy"), and $obj.$name would parse as a property CHAIN
  # and silently yield $null -- turning this read-back into a false negative.
  $back = [string](Get-ItemPropertyValue -Path $runKey -Name $e.Name)
  Write-Output ("RESTORED name=" + $e.Name + " matches=" + ($back -eq $orig))
  $changed++
}
Write-Output ("CHANGED " + $changed)
Write-Output "DONE"
