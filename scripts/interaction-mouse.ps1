param([string]$Action='click',[int]$X,[int]$Y,[int]$CueX,[int]$CueY,[int]$Milliseconds=700,[string]$Keys='')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;public class InteractionMouse{[StructLayout(LayoutKind.Sequential)]public struct Point{public int X,Y;}[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool GetCursorPos(out Point p);[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);}
'@
[void][InteractionMouse]::SetProcessDPIAware()
$p=New-Object InteractionMouse+Point
[void][InteractionMouse]::GetCursorPos([ref]$p)
try{
 if($Action -eq 'keys'){(New-Object -ComObject WScript.Shell).SendKeys($Keys);Start-Sleep -Milliseconds 160;return}
 if($Action -eq 'drag'){[void][InteractionMouse]::SetCursorPos($CueX,$CueY);Start-Sleep -Milliseconds 160;[InteractionMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero);for($i=1;$i -le 20;$i++){[void][InteractionMouse]::SetCursorPos([int]($CueX+($X-$CueX)*$i/20),[int]($CueY+($Y-$CueY)*$i/20));Start-Sleep -Milliseconds 12};return}
 if($Action -eq 'shoot'){
  [void][InteractionMouse]::SetCursorPos($CueX,$CueY);Start-Sleep -Milliseconds 120
  for($i=1;$i -le 18;$i++){[void][InteractionMouse]::SetCursorPos([int]($CueX+($X-$CueX)*$i/18),[int]($CueY+($Y-$CueY)*$i/18));Start-Sleep -Milliseconds 12}
 }else{[void][InteractionMouse]::SetCursorPos($X,$Y)}
 Start-Sleep -Milliseconds 160
 [InteractionMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
 if($Action -eq 'shoot'){Start-Sleep -Milliseconds $Milliseconds}else{Start-Sleep -Milliseconds 40}
}finally{if($Action -ne 'keys'){[InteractionMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 180;[void][InteractionMouse]::SetCursorPos($p.X,$p.Y)}}
