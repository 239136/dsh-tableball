param([int]$X,[int]$Y,[switch]$ExitWithEscape)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;public class TableBallPopupMouse{
 [StructLayout(LayoutKind.Sequential)]public struct Point{public int X,Y;}
 [DllImport("user32.dll")]public static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint data,UIntPtr extra);
}
'@
$p=New-Object TableBallPopupMouse+Point
[void][TableBallPopupMouse]::GetCursorPos([ref]$p)
try{
 [void][TableBallPopupMouse]::SetCursorPos($X,$Y)
 Start-Sleep -Milliseconds 180
 [TableBallPopupMouse]::mouse_event(8,0,0,0,[UIntPtr]::Zero)
 [TableBallPopupMouse]::mouse_event(16,0,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 3000
 & (Join-Path $PSScriptRoot 'capture-game.ps1') -Output 'menu-clean-check.png'
}finally{if($ExitWithEscape){(New-Object -ComObject WScript.Shell).SendKeys('{ESC}')}else{$s=Get-Content -Raw -Encoding UTF8 (Join-Path $env:USERPROFILE '.dsh/tableball/status.json')|ConvertFrom-Json;[void][TableBallPopupMouse]::SetCursorPos([int]($s.work.x+[Math]::Max(30,$s.cue.x-75)),[int]($s.work.y+[Math]::Max(180,$s.cue.y-120)));Start-Sleep -Milliseconds 120;[TableBallPopupMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 50;[TableBallPopupMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)};[void][TableBallPopupMouse]::SetCursorPos($p.X,$p.Y)}
