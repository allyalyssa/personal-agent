const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pipDesktop', {
  interactive: on => ipcRenderer.send('interactive', on),
  dragStart: (x, y) => ipcRenderer.send('drag-start', x, y),
  dragMove: (x, y) => ipcRenderer.send('drag-move', x, y),
  menu: () => ipcRenderer.send('menu'),
  copy: text => ipcRenderer.send('copy', text),
  onCheckCalendar: fn => ipcRenderer.on('check-calendar', fn),
  onPreview: fn => ipcRenderer.on('preview', fn),
  onRefresh: fn => ipcRenderer.on('refresh', fn)
})
