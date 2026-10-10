const { contextBridge, ipcRenderer } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('api', {
  scanWorlds: inv('worlds:scan'), addWorldDir: inv('worlds:addDir'), pickKey: inv('dialog:key'), pickDir: inv('dialog:dir'),
  listServers: inv('servers:list'), saveServer: inv('servers:save'), deleteServer: inv('servers:delete'),
  pingServer: inv('servers:ping'), serverInfo: inv('servers:info'),
  checkCompat: inv('compat:check'), upload: inv('upload:start'),
  onProgress: (cb) => ipcRenderer.on('upload:progress', (_e, p) => cb(p)),
});
