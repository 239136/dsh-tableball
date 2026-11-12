param([switch]$Bundled, [string]$DataHome)
$ErrorActionPreference = 'Stop'
function Read-ByteDigest([string]$FilePath) {
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($FilePath)
  try { return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
if ($Bundled) {
  $root = Split-Path -Parent $PSScriptRoot
  $candidates = @((Join-Path $root 'resources/runtime/node/node.exe'), (Join-Path $root '.dsh/runtime-cache/node/node.exe'))
  $node = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $node) { throw 'Prepare the complete TableBall runtime first.' }
  # Materialize bytes without carrying a build workspace's security descriptors.
  $digest = (Read-ByteDigest $node)
  $local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData/Local' }
  $bootDir = Join-Path $local ('TableBall/runtimes/bootstrap-node-' + $digest.Substring(0,16))
  New-Item -ItemType Directory -Force -Path $bootDir | Out-Null
  $bootNode = Join-Path $bootDir 'node.exe'
  if (-not (Test-Path -LiteralPath $bootNode)) { [System.IO.File]::WriteAllBytes($bootNode, [System.IO.File]::ReadAllBytes($node)) }
  if ((Read-ByteDigest $bootNode) -ne $digest) { throw 'Bootstrap runtime integrity mismatch' }
  $license = Join-Path (Split-Path -Parent $node) 'LICENSE'
  $bootLicense = Join-Path $bootDir 'LICENSE'
  if ((Test-Path -LiteralPath $license) -and -not (Test-Path -LiteralPath $bootLicense)) { [System.IO.File]::WriteAllBytes($bootLicense,[System.IO.File]::ReadAllBytes($license)) }
  $node = $bootNode
  $entry = Join-Path $root 'runtime/unified-supervisor.cjs'
  $cmd = '"' + $node + '" "' + $entry + '"'
  if ($DataHome) { $data = [System.IO.Path]::GetFullPath($DataHome); if ($data.Contains('"')) { throw 'Invalid data path' }; $cmd += ' --data-home "' + $data + '"' }
  $res = ([wmiclass]'Win32_Process').Create($cmd)
  Write-Output ('wmi create return=' + $res.ReturnValue + ' pid=' + $res.ProcessId)
  if ($res.ReturnValue -ne 0) { exit 1 }
  exit 0
}
$home0 = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$dir = Join-Path $home0 "tableball"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Remove-Item (Join-Path $dir "menu-stop") -Force -ErrorAction SilentlyContinue
$root = Split-Path -Parent $PSScriptRoot
$existing = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and ($_.CommandLine -like "*menu-daemon.cjs*" -or $_.CommandLine -like "*scripts*menu.cjs*") })
if ($existing.Count -gt 0) { Write-Output ("already running " + $existing.Count); exit 0 }
$node = (Get-Command node).Source
$script = Join-Path $root 'scripts/menu-daemon.cjs'
$cmd = '"' + $node + '" "' + $script + '"'
$res = ([wmiclass]"Win32_Process").Create($cmd)
Write-Output ("wmi create return=" + $res.ReturnValue + " pid=" + $res.ProcessId)