$home0 = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$dir = Join-Path $home0 "tableball"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Content -Path (Join-Path $dir "menu-stop") -Value "stop"
$owners = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and ($_.CommandLine -like "*menu-daemon.cjs*" -or $_.CommandLine -like "*scripts*menu.cjs*") })
$owners | ForEach-Object { Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $_.ProcessId } | Out-Null }
$owners | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { } }
Write-Output ("menu daemon stopped (" + $owners.Count + " process(es))")