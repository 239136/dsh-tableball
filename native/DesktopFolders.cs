using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;
using System.Drawing;
using System.Windows.Automation;
using System.Web.Script.Serialization;
class DesktopFolders {
 [DllImport("user32.dll")]static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")]static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string name);
 delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc cb,IntPtr l);
 [DllImport("user32.dll")]static extern bool DestroyIcon(IntPtr h);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct SHFILEINFO{public IntPtr hIcon;public int iIcon;public uint dwAttributes;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string szDisplayName;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=80)]public string szTypeName;}
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)]static extern IntPtr SHGetFileInfo(string file,uint attr,out SHFILEINFO info,uint size,uint flags);
 static string IconPng(string path){SHFILEINFO info;SHGetFileInfo(path,0,out info,(uint)Marshal.SizeOf(typeof(SHFILEINFO)),0x100);if(info.hIcon==IntPtr.Zero)return null;try{using(var ico=Icon.FromHandle(info.hIcon))using(var bitmap=ico.ToBitmap())using(var stream=new MemoryStream()){bitmap.Save(stream,System.Drawing.Imaging.ImageFormat.Png);return "data:image/png;base64,"+Convert.ToBase64String(stream.ToArray());}}finally{DestroyIcon(info.hIcon);}}
 static IntPtr DesktopView(){IntPtr view=IntPtr.Zero;EnumWindows(delegate(IntPtr h,IntPtr l){var def=FindWindowEx(h,IntPtr.Zero,"SHELLDLL_DefView",null);if(def!=IntPtr.Zero){view=FindWindowEx(def,IntPtr.Zero,"SysListView32",null);return view==IntPtr.Zero;}return true;},IntPtr.Zero);return view;}
 [STAThread]static void Main(){Console.OutputEncoding=new UTF8Encoding(false);SetProcessDPIAware();var folders=new List<Dictionary<string,object>>();var positions=new Dictionary<string,List<System.Windows.Rect>>(StringComparer.OrdinalIgnoreCase);string reason=null;
 try{var view=DesktopView();if(view==IntPtr.Zero)throw new Exception("Explorer desktop view not found");var root=AutomationElement.FromHandle(view);var items=root.FindAll(TreeScope.Children,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.ListItem));foreach(AutomationElement item in items){var current=item.Current;var rect=current.BoundingRectangle;if(rect.IsEmpty||rect.Width<=0||rect.Height<=0)continue;if(!positions.ContainsKey(current.Name))positions[current.Name]=new List<System.Windows.Rect>();positions[current.Name].Add(rect);}}catch(Exception e){reason="Position lookup unavailable: "+e.GetType().Name;}
 try{dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));dynamic desktop=shell.NameSpace(0);foreach(dynamic item in desktop.Items()){string full=(string)item.Path;if(!Directory.Exists(full))continue;string name=(string)item.Name;var entry=new Dictionary<string,object>{{"id",full},{"name",name},{"path",full},{"x",null},{"y",null}};List<System.Windows.Rect> list;if(positions.TryGetValue(name,out list)&&list.Count==1){entry["x"]=list[0].X+list[0].Width/2;entry["y"]=list[0].Y+Math.Min(32,list[0].Height/2);}else reason="Some icon positions are unavailable or ambiguous; generated positions used for those folders";try{entry["iconDataUrl"]=IconPng(full);}catch{}folders.Add(entry);}Marshal.FinalReleaseComObject(desktop);Marshal.FinalReleaseComObject(shell);}catch(Exception e){reason="Desktop enumeration unavailable: "+e.GetType().Name;}
 bool exact=reason==null;var result=new Dictionary<string,object>{{"folders",folders},{"positionsExact",exact},{"reason",reason},{"readOnly",true}};Console.WriteLine(new JavaScriptSerializer{MaxJsonLength=16*1024*1024}.Serialize(result));
 }
}
