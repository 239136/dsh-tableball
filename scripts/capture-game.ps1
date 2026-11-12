param([string]$Output='cue-folder-check.png')
Add-Type -AssemblyName System.Drawing
$home0=if($env:DSH_HOME){$env:DSH_HOME}else{Join-Path $env:USERPROFILE '.dsh'}
$s=Get-Content (Join-Path $home0 'tableball/status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$b=$s.work
$bitmap=New-Object System.Drawing.Bitmap ([int]$b.width),([int]$b.height)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen([int]$b.x,[int]$b.y,0,0,$bitmap.Size)
$bitmap.Save((Join-Path (Split-Path -Parent $PSScriptRoot) $Output))
$graphics.Dispose();$bitmap.Dispose()
