'use strict';
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { createApi } = require('./api');

// 단일 실행
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let store = null;

  const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_FILE;
  const launchPath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

  function getAutoLaunch() {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return false;
    try { return !!app.getLoginItemSettings({ path: launchPath() }).openAtLogin; } catch { return false; }
  }
  function setAutoLaunch(on) {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return;
    try { app.setLoginItemSettings({ openAtLogin: on, path: launchPath(), args: [] }); } catch { /* ignore */ }
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1280, height: 860, minWidth: 900, minHeight: 600,
      title: '출석부',
      icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      },
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
    win.on('closed', () => { win = null; });
  }

  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    store = new Store({
      configPath: path.join(app.getPath('userData'), 'config.json'),
      defaultDataDir: process.env.ATTENDANCE_DATA_DIR || path.join(app.getPath('documents'), '출석부'),
    });
    store.load();
    try { store.dailyBackupIfNeeded(); } catch (e) { console.error('backup failed', e); }
    if (store.data.settings.autoLaunch !== getAutoLaunch() && process.platform === 'win32') {
      // 저장된 설정을 우선 적용 (무설치 실행 파일 경로가 바뀐 경우 대비)
      setAutoLaunch(!!store.data.settings.autoLaunch);
    }
    const dispatch = createApi({ store, getWindow: () => win, getAutoLaunch, setAutoLaunch, isPortable });
    ipcMain.handle('api', async (_e, name, payload) => {
      try { return { ok: true, result: await dispatch(name, payload) }; } catch (e) { console.error(name, e); return { ok: false, error: e.message || String(e) }; }
    });
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { app.quit(); });
}
