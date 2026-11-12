using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Threading;using System.Web.Script.Serialization;
class PetVisibility{
 delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc p,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll")]static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr h,int mode);
 [DllImport("user32.dll")]static extern bool SetProcessDPIAware();
 [DllImport("kernel32.dll")]static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll")]static extern uint WaitForSingleObject(IntPtr h,uint ms);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);
 [StructLayout(LayoutKind.Sequential)]struct FileTime{public uint Low,High;}
 [DllImport("kernel32.dll")]static extern bool GetProcessTimes(IntPtr h,out FileTime c,out FileTime e,out FileTime k,out FileTime u);
 struct Rect{public int L,T,R,B;}
 static JavaScriptSerializer Json=new JavaScriptSerializer();
 static string Title(IntPtr h){var b=new StringBuilder(1024);GetWindowText(h,b,1024);return b.ToString();}
 static void Emit(object v){try{Console.WriteLine(Json.Serialize(v));Console.Out.Flush();}catch{}}
 static bool Alive(int pid){var h=OpenProcess(0x100000,false,(uint)pid);if(h==IntPtr.Zero)return false;try{return WaitForSingleObject(h,0)==258;}finally{CloseHandle(h);}}
 static string Started(uint pid){var h=OpenProcess(0x1000,false,pid);if(h==IntPtr.Zero)throw new Exception("Cannot inspect process");try{FileTime c,e,k,u;if(!GetProcessTimes(h,out c,out e,out k,out u))throw new Exception("Cannot identify process");return c.High+":"+c.Low;}finally{CloseHandle(h);}}
 static Dictionary<string,object> Find(){Dictionary<string,object> result=null;EnumWindows(delegate(IntPtr h,IntPtr l){string title=Title(h);if(!IsWindowVisible(h)||!title.StartsWith("dsh-pet")||!title.Contains("桌宠"))return true;uint pid;GetWindowThreadProcessId(h,out pid);string started;try{started=Started(pid);}catch{return true;}Rect r;GetWindowRect(h,out r);result=new Dictionary<string,object>{{"hwnd",h.ToInt64().ToString()},{"pid",(int)pid},{"started",started},{"title",title},{"visible",true},{"x",r.L},{"y",r.T},{"width",r.R-r.L},{"height",r.B-r.T}};return false;},IntPtr.Zero);return result;}
 static bool Matches(Dictionary<string,object> j){IntPtr h=new IntPtr(long.Parse((string)j["hwnd"]));if(!((string)j["title"]).StartsWith("dsh-pet")||!((string)j["title"]).Contains("桌宠")||!IsWindow(h)||Title(h)!=(string)j["title"])return false;uint pid;GetWindowThreadProcessId(h,out pid);if(pid!=Convert.ToUInt32(j["pid"]))return false;try{return Started(pid)==(string)j["started"];}catch{return false;}}
 static bool OwnerAlive(Dictionary<string,object> j){int pid=Convert.ToInt32(j["owner"]);if(!Alive(pid))return false;object value;if(!j.TryGetValue("ownerStarted",out value))return true;try{return Started((uint)pid)==(string)value;}catch{return false;}}
 static Dictionary<string,object> Decode(string value){return Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(Convert.FromBase64String(value)));}
 static void Restore(Dictionary<string,object> j){if(Matches(j)&&(bool)j["visible"])ShowWindow(new IntPtr(long.Parse((string)j["hwnd"])),4);}
 static int Main(string[] args){try{Console.OutputEncoding=new UTF8Encoding(false);}catch{}SetProcessDPIAware();try{
 if(args[0]=="identity"){Emit(new{started=Started(uint.Parse(args[1]))});return 0;}
 if(args[0]=="inspect"){var w=Find();Emit(new{found=w!=null,window=w});return 0;}
 if(args[0]=="status"){var record=Decode(args[1]);bool ready=false;try{using(var ev=EventWaitHandle.OpenExisting((string)record["eventName"]+"-ready"))ready=ev.WaitOne(0);}catch{}bool matches=Matches(record);Emit(new{matches=matches,hidden=matches&&!IsWindowVisible(new IntPtr(long.Parse((string)record["hwnd"]))),guardReady=ready});return 0;}
 if(args[0]=="signal"){using(var ev=EventWaitHandle.OpenExisting(args[1]))ev.Set();Emit(new{released=true});return 0;}
 var j=Decode(args[1]);int owner=Convert.ToInt32(j["owner"]);
 if(args[0]=="restore"){if(OwnerAlive(j)&&(args.Length<3||int.Parse(args[2])!=owner))throw new Exception("Another live game owns this pet");Restore(j);Emit(new{restored=true});return 0;}
 if(args[0]!="hold"||!OwnerAlive(j)||!Matches(j))throw new Exception("Original pet or owner changed before hide");
 using(var ready=new EventWaitHandle(false,EventResetMode.ManualReset,(string)j["eventName"]+"-ready"))using(var released=new EventWaitHandle(false,EventResetMode.ManualReset,(string)j["eventName"])){
 try{ShowWindow(new IntPtr(long.Parse((string)j["hwnd"])),0);ready.Set();Emit(new{hidden=true});while(!released.WaitOne(25)&&OwnerAlive(j)){if(!Matches(j)){Emit(new{lost=true});break;}var h=new IntPtr(long.Parse((string)j["hwnd"]));if(IsWindowVisible(h))ShowWindow(h,0);}}
 finally{Restore(j);Emit(new{restored=true});}}return 0;
 }catch(Exception e){Emit(new{error=e.Message});return 1;}}
}
