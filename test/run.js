const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), net = require('net');
const nbt = require('prismarine-nbt');
const { scanSaves } = require('../src/lib/worlds');
const { checkCompat } = require('../src/lib/compat');
const { ping } = require('../src/lib/mcping');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsaves-'));
  const mk = (folder, name, dv, vn) => {
    const dir = path.join(tmp, folder); fs.mkdirSync(path.join(dir, 'region'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'region/r.0.0.mca'), 'x');
    const data = nbt.comp({ Data: nbt.comp({ LevelName: nbt.string(name), DataVersion: nbt.int(dv), LastPlayed: nbt.long([0, 1700000000]), GameType: nbt.int(0), Version: nbt.comp({ Name: nbt.string(vn), Id: nbt.int(dv) }) }) });
    fs.writeFileSync(path.join(dir, 'level.dat'), zlib.gzipSync(nbt.writeUncompressed(data, 'big')));
  };
  mk('alt', 'Alte Welt', 2586, '1.16.5'); mk('neu', 'Neue Welt', 4189, '1.21.4'); mk('gleich', 'Gleich', 3465, '1.20.1');
  const worlds = await scanSaves([tmp]);
  assert.equal(worlds.length, 3);

  // Mock-Server (Status-Antwort)
  const body = JSON.stringify({ version: { name: 'Paper 1.20.1', protocol: 763 }, players: { online: 2, max: 20 }, description: { text: '§aHallo' } });
  const vi = (n) => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return Buffer.from(o); };
  const srv = net.createServer((s) => s.once('data', () => {
    const j = Buffer.from(body); const inner = Buffer.concat([vi(0), vi(j.length), j]);
    s.write(Buffer.concat([vi(inner.length), inner]));
  })).listen(0);
  const st = await ping('127.0.0.1', srv.address().port);
  srv.close();
  assert(st.online && st.resolved.name === '1.20.1' && st.motd === 'Hallo');

  const res = Object.fromEntries(worlds.map((w) => [w.folder, checkCompat(w, { status: st }).level]));
  assert.deepEqual(res, { alt: 'upgrade', neu: 'bad', gleich: 'ok' });
  assert.equal(checkCompat(worlds[0], { status: { online: false } }).level, 'unknown');
  // Lokaler Upload
  const remote = require('../src/lib/remote');
  const srvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcserver-'));
  fs.writeFileSync(path.join(srvDir, 'server.properties'), 'level-name=world\nmotd=x\n');
  const local = { protocol: 'local', remoteDir: srvDir };
  const info = await remote.serverInfo(local);
  assert.equal(info.properties['level-name'], 'world');
  const w = worlds.find((x) => x.folder === 'gleich');
  const r = await remote.upload(local, { world: w, targetName: 'gleich', setLevelName: true }, () => {});
  assert.equal(r.files, 2);
  assert(fs.existsSync(path.join(srvDir, 'gleich/region/r.0.0.mca')));
  assert(/level-name=gleich/.test(fs.readFileSync(path.join(srvDir, 'server.properties'), 'utf8')));
  await assert.rejects(remote.upload(local, { world: w, targetName: 'gleich' }, () => {}), /existiert bereits/);
  console.log('alle Tests ok', res);
})().catch((e) => { console.error(e); process.exit(1); });
