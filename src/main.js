const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const worlds = require('./lib/worlds');
const { ping } = require('./lib/mcping');
const remote = require('./lib/remote');
const { checkCompat } = require('./lib/compat');

const storeFile = () => path.join(app.getPath('userData'), 'servers.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };

function enc(pw) {
  if (!pw) return '';
  return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(pw).toString('base64') : 'raw:' + pw;
}
function dec(v) {
  if (!v) return '';
  if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
  return v.slice(4);
}
const loadServers = () => readJson(storeFile(), []);
const withPw = (s) => ({ ...s, password: dec(s.password) });
const publicServer = (s) => ({ ...s, password: undefined, hasPassword: !!s.password });

function createWindow() {
  const win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 600,
    title: 'Minecraft Uploader',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
}

ipcMain.handle('worlds:scan', async () => {
  const s = readJson(settingsFile(), {});
  const dirs = [...worlds.defaultSavesDirs(), ...(s.extraDirs || [])];
  return { dirs, worlds: await worlds.scanSaves(dirs) };
});
ipcMain.handle('worlds:addDir', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Ordner mit Welten (z. B. „saves") wählen' });
  if (r.canceled) return null;
  const s = readJson(settingsFile(), {});
  s.extraDirs = [...new Set([...(s.extraDirs || []), r.filePaths[0]])];
  fs.writeFileSync(settingsFile(), JSON.stringify(s));
  return r.filePaths[0];
});
ipcMain.handle('dialog:key', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], title: 'Privaten SSH-Schlüssel wählen' });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:dir', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Server-Ordner wählen' });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('servers:list', () => loadServers().map(publicServer));
ipcMain.handle('servers:save', (_e, s) => {
  const all = loadServers();
  const old = all.find((x) => x.id === s.id);
  const rec = { ...s, id: s.id || crypto.randomUUID() };
  delete rec.hasPassword;
  rec.password = s.password ? enc(s.password) : (old ? old.password : '');
  const next = old ? all.map((x) => (x.id === rec.id ? rec : x)) : [...all, rec];
  fs.writeFileSync(storeFile(), JSON.stringify(next, null, 2));
  return publicServer(rec);
});
ipcMain.handle('servers:delete', (_e, id) => {
  fs.writeFileSync(storeFile(), JSON.stringify(loadServers().filter((x) => x.id !== id), null, 2));
});

ipcMain.handle('servers:ping', (_e, id) => {
  const s = loadServers().find((x) => x.id === id);
  return ping(s.host, s.gamePort || 25565);
});
ipcMain.handle('servers:info', async (_e, id) => {
  const s = withPw(loadServers().find((x) => x.id === id));
  try { return { ok: true, ...(await remote.serverInfo(s)) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('compat:check', (_e, world, server) => checkCompat(world, server));

ipcMain.handle('upload:start', async (e, { serverId, world, targetName, setLevelName }) => {
  const s = withPw(loadServers().find((x) => x.id === serverId));
  try {
    const res = await remote.upload(s, { world, targetName, setLevelName }, (p) => e.sender.send('upload:progress', p));
    return { ok: true, ...res };
  } catch (err) { return { ok: false, error: err.message }; }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
