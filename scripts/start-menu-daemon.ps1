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