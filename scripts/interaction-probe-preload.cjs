const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('probe',{click:()=>ipcRenderer.send('probe-click'),escape:()=>ipcRenderer.send('probe-escape')});
