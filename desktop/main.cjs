const { app, BrowserWindow, Menu, clipboard, ipcMain, screen, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const URL = `http://localhost:${process.env.PORT || 3000}`
const SIZE = { width: 330, height: 500 }

let server = null
let pip = null
let panel = null
let dragFrom = null
let quitting = false
let restarts = []

async function serverUp() {
  try {
    return (await fetch(`${URL}/api/pip`)).ok
  } catch {
    return false
  }
}

async function startServer() {
  if (await serverUp()) return
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true })
  const log = fs.openSync(path.join(ROOT, 'data', 'pip-server.log'), 'a')
  server = spawn('node', ['--env-file-if-exists=.env', 'server/index.ts'], { cwd: ROOT, stdio: ['ignore', log, log], windowsHide: true })
  server.on('exit', () => {
    server = null
    restarts = [...restarts.filter(t => t > Date.now() - 60000), Date.now()]
    if (!quitting && restarts.length <= 5) setTimeout(startServer, 1000)
  })
  for (let i = 0; i < 60 && !(await serverUp()); i++) await new Promise(r => setTimeout(r, 500))
}

function createPip() {
  const area = screen.getPrimaryDisplay().workArea
  pip = new BrowserWindow({
    ...SIZE,
    x: area.x + area.width - SIZE.width,
    y: area.y + area.height - SIZE.height,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') }
  })
  pip.setBounds({ ...SIZE, x: area.x + area.width - SIZE.width, y: area.y + area.height - SIZE.height })
  pip.setAlwaysOnTop(true, 'screen-saver')
  pip.setVisibleOnAllWorkspaces(true)
  pip.setIgnoreMouseEvents(true, { forward: true })
  pip.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  pip.loadURL(`${URL}/pip.html`)
}

function openPanel(page) {
  if (panel && !panel.isDestroyed()) {
    panel.loadURL(`${URL}/${page}`)
    panel.show()
    panel.focus()
    return
  }
  panel = new BrowserWindow({ width: 560, height: 780, title: 'Pip', autoHideMenuBar: true })
  panel.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  panel.loadURL(`${URL}/${page}`)
  panel.on('closed', () => pip?.webContents.send('refresh'))
}

ipcMain.on('interactive', (_, on) => pip?.setIgnoreMouseEvents(!on, { forward: true }))
ipcMain.on('copy', (_, text) => clipboard.writeText(String(text)))
ipcMain.on('drag-start', (_, x, y) => {
  const [wx, wy] = pip.getPosition()
  dragFrom = { x, y, wx, wy }
})
// setBounds with a fixed size: setPosition alone grows the window a little on every call at 125% scaling.
ipcMain.on('drag-move', (_, x, y) => {
  if (!dragFrom) return
  const want = { x: dragFrom.wx + x - dragFrom.x, y: dragFrom.wy + y - dragFrom.y, ...SIZE }
  const area = screen.getDisplayMatching(want).workArea
  pip.setBounds({
    ...SIZE,
    x: Math.round(Math.min(Math.max(want.x, area.x), area.x + area.width - SIZE.width)),
    y: Math.round(Math.min(Math.max(want.y, area.y), area.y + area.height - SIZE.height))
  })
})
ipcMain.on('menu', () => {
  Menu.buildFromTemplate([
    { label: 'Show next reminder now', click: () => pip.webContents.send('preview') },
    { label: 'Check my calendar now', click: () => pip.webContents.send('check-calendar') },
    { type: 'separator' },
    { label: "Today's meals…", click: () => openPanel('pip-meals.html') },
    { label: 'My details…', click: () => openPanel('pip-settings.html#details') },
    { label: "Pip's look…", click: () => openPanel('pip-settings.html#look') },
    { type: 'separator' },
    { label: 'Quit Pip', click: () => app.quit() }
  ]).popup({ window: pip })
})

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.whenReady().then(async () => {
    await startServer()
    createPip()
  })
  app.on('window-all-closed', () => {})
  app.on('before-quit', () => {
    quitting = true
    server?.kill()
  })
}
