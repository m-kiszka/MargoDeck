'use strict';

const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_MAPPING = path.join(__dirname, '..', 'config', 'default-mapping.json');

function loadMapping() {
  const base = JSON.parse(fs.readFileSync(DEFAULT_MAPPING, 'utf8'));
  const userFile = path.join(app.getPath('userData'), 'mapping.json');
  if (!fs.existsSync(userFile)) {
    try { fs.writeFileSync(userFile, JSON.stringify(base, null, 2)); } catch (_) {}
    return base;
  }
  try {
    const user = JSON.parse(fs.readFileSync(userFile, 'utf8'));
    return { ...base, ...user, buttons: { ...base.buttons, ...user.buttons }, chords: { ...base.chords, ...user.chords } };
  } catch (err) {
    console.error('Invalid mapping.json, using defaults:', err.message);
    return base;
  }
}

let win;
let mapping;

const IN_APP_POPUP_HOSTS = [
  /(^|\.)margonem\.(pl|com)$/,
  /(^|\.)google\.com$/,
  /(^|\.)googleusercontent\.com$/,
  /(^|\.)facebook\.com$/,
  /(^|\.)apple\.com$/,
];

function isInAppHost(url) {
  try {
    const { hostname } = new URL(url);
    return IN_APP_POPUP_HOSTS.some((re) => re.test(hostname));
  } catch (_) {
    return url === 'about:blank' || url === '';
  }
}

function popupHandler({ url }) {
  if (url === 'about:blank' || isInAppHost(url)) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: win,
        width: 900,
        height: 700,
        center: true,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          partition: 'persist:margonem',
          contextIsolation: true,
          nodeIntegration: false,
        },
      },
    };
  }
  shell.openExternal(url);
  return { action: 'deny' };
}

function setupPopup(child) {
  child.setMenu(null);
  child.webContents.setWindowOpenHandler(popupHandler);
  child.webContents.on('did-create-window', setupPopup);
  child.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && input.control) child.close();
  });
}

function cleanUserAgent(ua) {
  return ua.replace(/\s?Electron\/\S+/, '').replace(/\s?margodeck\/\S+/i, '');
}

function createWindow() {
  mapping = loadMapping();
  const display = mapping.display || {};
  const windowed = process.argv.includes('--windowed') || display.fullscreen === false;

  win = new BrowserWindow({
    width: display.width || 1280,
    height: display.height || 800,
    useContentSize: true,
    fullscreen: !windowed,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'MargoDeck',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:margonem',
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);

  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(mapping.zoom || 1.0);
  });

  win.webContents.setWindowOpenHandler(popupHandler);
  win.webContents.on('did-create-window', setupPopup);

  win.on('enter-full-screen', broadcastDisplay);
  win.on('leave-full-screen', broadcastDisplay);
  win.on('resized', broadcastDisplay);

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') setDisplay({ fullscreen: !win.isFullScreen() });
    if (input.key === 'F5') win.webContents.reload();
  });

  win.loadURL(mapping.url);
}

function keyCodeFor(key) {
  const special = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Escape', Enter: 'Return', ' ': 'Space' };
  return special[key] || key;
}

ipcMain.on('md:key', (e, { key, down }) => {
  const wc = e.sender;
  const keyCode = keyCodeFor(key);
  wc.sendInputEvent({ type: down ? 'keyDown' : 'keyUp', keyCode });
  if (down && key.length === 1) wc.sendInputEvent({ type: 'char', keyCode });
});

const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_PX = 6;
const lastClicks = new WeakMap();

function clickCountFor(wc, button, x, y) {
  const now = Date.now();
  const prev = lastClicks.get(wc);
  const isRepeat = prev && prev.button === button && now - prev.time <= DOUBLE_CLICK_MS
    && Math.abs(prev.x - x) <= DOUBLE_CLICK_PX && Math.abs(prev.y - y) <= DOUBLE_CLICK_PX;
  const count = isRepeat ? prev.count + 1 : 1;
  lastClicks.set(wc, { button, time: now, x, y, count });
  return count;
}

ipcMain.on('md:mouse', (e, { kind, x, y, button }) => {
  const wc = e.sender;
  const zoom = wc.getZoomFactor();
  const ev = { x: Math.round(x * zoom), y: Math.round(y * zoom) };
  if (kind === 'move') {
    wc.sendInputEvent({ type: 'mouseMove', ...ev });
  } else if (kind === 'down') {
    const clickCount = clickCountFor(wc, button, ev.x, ev.y);
    wc.sendInputEvent({ type: 'mouseDown', button, clickCount, ...ev });
  } else {
    const clickCount = lastClicks.get(wc)?.count || 1;
    wc.sendInputEvent({ type: 'mouseUp', button, clickCount, ...ev });
  }
});

ipcMain.on('md:wheel', (e, { x, y, dy }) => {
  const wc = e.sender;
  const zoom = wc.getZoomFactor();
  wc.sendInputEvent({ type: 'mouseWheel', x: Math.round(x * zoom), y: Math.round(y * zoom), deltaX: 0, deltaY: dy, canScroll: true });
});

ipcMain.on('md:action', (e, action) => {
  const wc = e.sender;
  const owner = BrowserWindow.fromWebContents(wc);
  switch (action) {
    case 'closePopup': if (owner && owner !== win) owner.close(); break;
    case 'keyboard': shell.openExternal('steam://open/keyboard'); break;
    case 'zoomIn': wc.setZoomFactor(Math.min(3, wc.getZoomFactor() + 0.1)); break;
    case 'zoomOut': wc.setZoomFactor(Math.max(0.5, wc.getZoomFactor() - 0.1)); break;
    case 'zoomReset': wc.setZoomFactor(mapping.zoom || 1.0); break;
    case 'reload': wc.reload(); break;
    case 'toggleFullscreen': setDisplay({ fullscreen: !win.isFullScreen() }); break;
    case 'quit': app.quit(); break;
  }
});

ipcMain.handle('md:mapping', () => mapping);

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

function loadLocales() {
  const out = {};
  for (const file of fs.readdirSync(LOCALES_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      out[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
    } catch (err) {
      console.error(`Invalid locale ${file}:`, err.message);
    }
  }
  return out;
}

ipcMain.handle('md:locales', () => loadLocales());

function saveMapping(m) {
  mapping = m;
  fs.writeFileSync(path.join(app.getPath('userData'), 'mapping.json'), JSON.stringify(m, null, 2));
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('md:mapping-updated', m);
  return m;
}

ipcMain.handle('md:saveMapping', (_e, m) => saveMapping(m));
ipcMain.handle('md:resetMapping', () => {
  const defaults = JSON.parse(fs.readFileSync(DEFAULT_MAPPING, 'utf8'));
  if (mapping.display) defaults.display = mapping.display;
  if (mapping.language) defaults.language = mapping.language;
  return saveMapping(defaults);
});

function displayState() {
  const [width, height] = win.getContentSize();
  return { fullscreen: win.isFullScreen(), width, height };
}

function broadcastDisplay() {
  if (!win) return;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('md:display-updated', displayState());
}

function setDisplay({ fullscreen, width, height }) {
  if (width && height) {
    if (win.isFullScreen()) win.setFullScreen(false);
    win.setContentSize(width, height);
    win.center();
  }
  if (typeof fullscreen === 'boolean') win.setFullScreen(fullscreen);
  const [w, h] = width && height ? [width, height] : win.getContentSize();
  const isFullscreen = typeof fullscreen === 'boolean' ? fullscreen : (width && height ? false : win.isFullScreen());
  saveMapping({ ...mapping, display: { fullscreen: isFullscreen, width: w, height: h } });
  broadcastDisplay();
  return { fullscreen: isFullscreen, width: w, height: h };
}

ipcMain.handle('md:display', () => displayState());
ipcMain.handle('md:setDisplay', (_e, opts) => setDisplay(opts));

app.whenReady().then(() => {
  const ses = session.fromPartition('persist:margonem');
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
