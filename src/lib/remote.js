const fs = require('fs');
const path = require('path');
const { Readable, Writable } = require('stream');
const SftpClient = require('ssh2-sftp-client');
const ftp = require('basic-ftp');

let native = false; // true bei lokalem Modus (Windows-Pfade)
const join = (...p) => (native ? path.join(...p) : p.join('/').replace(/\/+/g, '/'));

class SftpRemote {
  async connect(s) {
    this.c = new SftpClient();
    await this.c.connect({
      host: s.fileHost || s.host, port: Number(s.filePort) || 22,
      username: s.user, password: s.password || undefined,
      privateKey: s.privateKeyPath ? fs.readFileSync(s.privateKeyPath) : undefined,
      readyTimeout: 10000,
    });
  }
  async list(dir) {
    const l = await this.c.list(dir);
    return l.map((e) => ({ name: e.name, isDir: e.type === 'd' }));
  }
  async exists(p) { return !!(await this.c.exists(p)); }
  async mkdirp(p) { await this.c.mkdir(p, true); }
  async put(local, remote) { await this.c.fastPut(local, remote); }
  async readText(p) { return (await this.c.get(p)).toString('utf8'); }
  async writeText(p, t) { await this.c.put(Buffer.from(t, 'utf8'), p); }
  async close() { try { await this.c.end(); } catch { /* ignore */ } }
}

class FtpRemote {
  async connect(s) {
    this.c = new ftp.Client(15000);
    await this.c.access({
      host: s.fileHost || s.host, port: Number(s.filePort) || 21,
      user: s.user, password: s.password, secure: !!s.ftps,
      secureOptions: s.ftps ? { rejectUnauthorized: false } : undefined,
    });
  }
  async list(dir) {
    const l = await this.c.list(dir);
    return l.map((e) => ({ name: e.name, isDir: e.isDirectory }));
  }
  async exists(p) {
    const dir = path.posix.dirname(p), name = path.posix.basename(p);
    try { return (await this.list(dir)).some((e) => e.name === name); } catch { return false; }
  }
  async mkdirp(p) { await this.c.ensureDir(p); await this.c.cd('/'); }
  async put(local, remote) { await this.c.uploadFrom(local, remote); }
  async readText(p) {
    const chunks = [];
    await this.c.downloadTo(new Writable({ write(ch, _e, cb) { chunks.push(ch); cb(); } }), p);
    return Buffer.concat(chunks).toString('utf8');
  }
  async writeText(p, t) { await this.c.uploadFrom(Readable.from([Buffer.from(t, 'utf8')]), p); }
  async close() { this.c.close(); }
}

class LocalRemote {
  async connect(s) {
    this.base = s.remoteDir;
    if (!fs.existsSync(this.base) || !fs.statSync(this.base).isDirectory()) throw new Error('Server-Ordner existiert nicht: ' + this.base);
  }
  async list(dir) { return (await fs.promises.readdir(dir, { withFileTypes: true })).map((e) => ({ name: e.name, isDir: e.isDirectory() })); }
  async exists(p) { return fs.existsSync(p); }
  async mkdirp(p) { await fs.promises.mkdir(p, { recursive: true }); }
  async put(local, remote) { await fs.promises.copyFile(local, remote); }
  async readText(p) { return fs.promises.readFile(p, 'utf8'); }
  async writeText(p, t) { await fs.promises.writeFile(p, t); }
  async close() {}
}

async function open(server) {
  const r = server.protocol === 'local' ? new LocalRemote() : server.protocol === 'ftp' ? new FtpRemote() : new SftpRemote();
  await r.connect(server);
  return r;
}

function parseProperties(text) {
  const o = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return o;
}

// Dateien eines lokalen Ordners rekursiv sammeln (session.lock überspringen)
async function walk(dir, base = dir, out = { dirs: [], files: [] }) {
  for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(base, p).split(path.sep).join('/');
    if (e.isDirectory()) { out.dirs.push(rel); await walk(p, base, out); }
    else if (e.isFile() && e.name !== 'session.lock') {
      out.files.push({ rel, abs: p, size: (await fs.promises.stat(p)).size });
    }
  }
  return out;
}

async function serverInfo(server) {
  native = server.protocol === 'local';
  const r = await open(server);
  try {
    const dir = server.remoteDir || '/';
    const info = { properties: null, worlds: [], hasProps: false };
    const props = join(dir, 'server.properties');
    if (await r.exists(props)) {
      info.hasProps = true;
      info.properties = parseProperties(await r.readText(props));
    }
    for (const e of await r.list(dir)) {
      if (e.isDir && (await r.exists(join(dir, e.name, 'level.dat')))) info.worlds.push(e.name);
    }
    return info;
  } finally { await r.close(); }
}

// opts: { world, targetName, setLevelName }
async function upload(server, opts, onProgress) {
  native = server.protocol === 'local';
  const r = await open(server);
  try {
    const dir = server.remoteDir || '/';
    const target = join(dir, opts.targetName);
    if (await r.exists(target)) throw new Error(`Auf dem Server existiert bereits „${opts.targetName}". Bitte anderen Namen wählen.`);
    const { dirs, files } = await walk(opts.world.path);
    const total = files.reduce((a, f) => a + f.size, 0);
    let sent = 0;
    await r.mkdirp(target);
    for (const d of dirs) await r.mkdirp(join(target, d));
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      await r.put(f.abs, join(target, f.rel));
      sent += f.size;
      onProgress({ file: f.rel, index: i + 1, count: files.length, sent, total });
    }
    if (opts.setLevelName) {
      const props = join(dir, 'server.properties');
      if (await r.exists(props)) {
        let t = await r.readText(props);
        t = /^level-name=.*$/m.test(t)
          ? t.replace(/^level-name=.*$/m, 'level-name=' + opts.targetName)
          : t.trimEnd() + '\nlevel-name=' + opts.targetName + '\n';
        await r.writeText(props, t);
      }
    }
    return { files: files.length, bytes: total };
  } finally { await r.close(); }
}

module.exports = { serverInfo, upload, open };
