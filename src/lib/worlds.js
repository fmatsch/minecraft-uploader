const fs = require('fs');
const path = require('path');
const os = require('os');
const nbt = require('prismarine-nbt');

function defaultSavesDirs() {
  const home = os.homedir();
  if (process.platform === 'darwin') return [path.join(home, 'Library/Application Support/minecraft/saves')];
  if (process.platform === 'win32') return [path.join(process.env.APPDATA || path.join(home, 'AppData/Roaming'), '.minecraft', 'saves')];
  return [path.join(home, '.minecraft/saves')];
}

async function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += (await fs.promises.stat(p)).size; } catch { /* ignore */ } }
    }
  }
  return total;
}

async function readWorld(dir) {
  const folder = path.basename(dir);
  const levelDat = path.join(dir, 'level.dat');
  const isBedrock = fs.existsSync(path.join(dir, 'levelname.txt')) && fs.existsSync(path.join(dir, 'db'));
  if (isBedrock) {
    const name = fs.readFileSync(path.join(dir, 'levelname.txt'), 'utf8').trim();
    return { folder, path: dir, name, edition: 'bedrock', size: await dirSize(dir) };
  }
  if (!fs.existsSync(levelDat)) return null;

  const world = { folder, path: dir, name: folder, edition: 'java', size: await dirSize(dir) };
  try {
    const { parsed } = await nbt.parse(fs.readFileSync(levelDat));
    const d = nbt.simplify(parsed).Data || {};
    world.name = d.LevelName || folder;
    world.dataVersion = d.DataVersion != null ? Number(d.DataVersion) : null;
    world.versionName = d.Version && d.Version.Name ? d.Version.Name : null;
    world.lastPlayed = d.LastPlayed != null ? Number(d.LastPlayed) : null;
    world.gameType = d.GameType;
    world.hardcore = !!d.hardcore;
    world.seed = d.WorldGenSettings && d.WorldGenSettings.seed != null ? String(d.WorldGenSettings.seed) : (d.RandomSeed != null ? String(d.RandomSeed) : null);
  } catch (e) {
    world.error = 'level.dat nicht lesbar: ' + e.message;
  }
  const icon = path.join(dir, 'icon.png');
  if (fs.existsSync(icon)) world.icon = 'data:image/png;base64,' + fs.readFileSync(icon).toString('base64');
  return world;
}

async function scanSaves(dirs) {
  const worlds = [];
  for (const base of dirs) {
    let entries;
    try { entries = await fs.promises.readdir(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const w = await readWorld(path.join(base, e.name));
      if (w) worlds.push(w);
    }
  }
  worlds.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  return worlds;
}

module.exports = { defaultSavesDirs, scanSaves, readWorld };
