const net = require('net');
const dns = require('dns').promises;
const { parseServerVersion } = require('./versions');

function varint(n) {
  const out = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
const packet = (id, body = Buffer.alloc(0)) => {
  const inner = Buffer.concat([varint(id), body]);
  return Buffer.concat([varint(inner.length), inner]);
};
const str = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); };

function readVarint(buf, off = 0) {
  let r = 0, shift = 0, b;
  do {
    if (off >= buf.length) return null;
    b = buf[off++];
    r |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  return { value: r, size: off };
}

function motdText(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  return (d.text || '') + (d.extra || []).map(motdText).join('');
}

async function resolveSrv(host, port) {
  if (port !== 25565) return { host, port };
  try {
    const r = await dns.resolveSrv('_minecraft._tcp.' + host);
    if (r.length) return { host: r[0].name, port: r[0].port };
  } catch { /* kein SRV */ }
  return { host, port };
}

// Minecraft Java "Server List Ping"
async function ping(hostIn, portIn = 25565, timeout = 5000) {
  const { host, port } = await resolveSrv(hostIn, Number(portIn) || 25565);
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    const done = (r) => { sock.destroy(); resolve(r); };
    sock.setTimeout(timeout, () => done({ online: false, error: 'Zeitüberschreitung' }));
    sock.on('error', (e) => done({ online: false, error: e.code || e.message }));
    sock.on('connect', () => {
      const hs = Buffer.concat([varint(767), str(hostIn), Buffer.from([port >> 8, port & 255]), varint(1)]);
      sock.write(Buffer.concat([packet(0, hs), packet(0)]));
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const len = readVarint(buf);
      if (!len || buf.length < len.size + len.value) return;
      const id = readVarint(buf, len.size);
      const sl = readVarint(buf, id.size);
      const total = sl && sl.value;
      if (total == null || buf.length < sl.size + total) return;
      try {
        const j = JSON.parse(buf.slice(sl.size, sl.size + total).toString('utf8'));
        const versionName = j.version && j.version.name;
        const protocol = j.version && j.version.protocol;
        done({
          online: true,
          latency: Date.now() - started,
          versionName,
          protocol,
          resolved: parseServerVersion(versionName, protocol),
          players: j.players ? { online: j.players.online, max: j.players.max } : null,
          motd: motdText(j.description).replace(/§./g, ''),
          favicon: j.favicon || null,
        });
      } catch (e) { done({ online: false, error: 'Ungültige Antwort' }); }
    });
  });
}

module.exports = { ping };
