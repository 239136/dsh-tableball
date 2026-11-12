param([int]$X,[int]$Y,[int]$Milliseconds=850,[int]$CueX=-1,[int]$CueY=-1)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class TableBallMouse {
 [StructLayout(LayoutKind.Sequential)]public struct Point{public int X,Y;}
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint data,UIntPtr extra);
}
'@
$p=New-Object TableBallMouse+Point
[void][TableBallMouse]::GetCursorPos([ref]$p)
try{
 if($CueX -lt 0){try{$s=Get-Content -Raw -Encoding UTF8 (Join-Path $env:USERPROFILE '.dsh/tableball/status.json')|ConvertFrom-Json;if($s.cueSource -eq 'owned'){$CueX=[int]($s.work.x+$s.cue.x);$CueY=[int]($s.work.y+$s.cue.y)}}catch{}}
 if($CueX -ge 0){[void][TableBallMouse]::SetCursorPos($CueX,$CueY);Start-Sleep -Milliseconds 120;for($i=1;$i -le 18;$i++){[void][TableBallMouse]::SetCursorPos([int]($CueX+($X-$CueX)*$i/18),[int]($CueY+($Y-$CueY)*$i/18));Start-Sleep -Milliseconds 12}}
 [void][TableBallMouse]::SetCursorPos($X,$Y)
 Start-Sleep -Milliseconds 120
 [TableBallMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds $Milliseconds
 & (Join-Path $PSScriptRoot 'capture-game.ps1') -Output 'cue-charge-check.png'
}finally{[TableBallMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 180;[void][TableBallMouse]::SetCursorPos($p.X,$p.Y)}
