using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;
class PetTracker {
 delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
 struct Rect { public int L,T,R,B; } struct Point { public int X,Y; }
 static IntPtr Find(){ IntPtr result=IntPtr.Zero;EnumWindows(delegate(IntPtr h,IntPtr l){
  if(!IsWindowVisible(h)||IsIconic(h))return true;var s=new StringBuilder(256);GetWindowText(h,s,256);
  if(s.ToString().StartsWith("dsh-pet") && s.ToString().Contains("桌宠")){result=h;return false;}return true;
 },IntPtr.Zero);return result; }
 static void Main(){SetProcessDPIAware();IntPtr h=IntPtr.Zero;var timer=Stopwatch.StartNew();long next=0;
  try{while(true){if(h==IntPtr.Zero||!IsWindow(h)||!IsWindowVisible(h)){h=Find();}
   Rect r;Point cursor;GetCursorPos(out cursor);
   if(h!=IntPtr.Zero && GetWindowRect(h,out r) && !IsIconic(h)){
    Console.WriteLine("{\"found\":true,\"t\":"+timer.ElapsedMilliseconds+",\"x\":"+r.L+",\"y\":"+r.T+",\"width\":"+(r.R-r.L)+",\"height\":"+(r.B-r.T)+",\"down\":"+(((GetAsyncKeyState(1)&0x8000)!=0)?"true":"false")+",\"cursorX\":"+cursor.X+",\"cursorY\":"+cursor.Y+"}");
   }else Console.WriteLine("{\"found\":false}");
   next+=16;var delay=next-timer.ElapsedMilliseconds;if(delay>0)Thread.Sleep((int)delay);else next=timer.ElapsedMilliseconds;
  }}catch(System.IO.IOException){} }
}
