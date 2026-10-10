const $ = (s) => document.querySelector(s);
const LABEL = { ok: 'Kompatibel', upgrade: 'Wird aktualisiert', bad: 'Inkompatibel', unknown: 'Unbekannt' };
const GAMETYPE = ['Survival', 'Creative', 'Adventure', 'Spectator'];
const state = { worlds: [], servers: [], server: null, status: null, info: null, selected: null, compat: new Map() };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB');
const fmtDate = (t) => (t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–');

async function loadWorlds() {
  const { dirs, worlds } = await api.scanWorlds();
  state.worlds = worlds;
  $('#dirs').textContent = 'Gesucht in: ' + dirs.join(' · ');
  if (state.selected && !worlds.find((w) => w.path === state.selected.path)) state.selected = null;
  await refreshCompat();
}

async function refreshCompat() {
  const server = state.server ? { ...state.server, status: state.status } : null;
  state.compat.clear();
  await Promise.all(state.worlds.map(async (w) => state.compat.set(w.path, await api.checkCompat(w, server))));
  renderWorlds(); renderFooter();
}

function renderWorlds() {
  const el = $('#worlds');
  if (!state.worlds.length) { el.innerHTML = '<div class="hint">Keine Welten gefunden. Über „Ordner hinzufügen…" einen anderen saves-Ordner wählen.</div>'; return; }
  el.innerHTML = state.worlds.map((w, i) => {
    const c = state.compat.get(w.path) || { level: 'unknown', text: '' };
    const ver = w.edition === 'bedrock' ? 'Bedrock' : (w.versionName ? 'Java ' + w.versionName : 'Java (alt)');
    const gt = w.gameType != null ? GAMETYPE[w.gameType] + (w.hardcore ? ' · Hardcore' : '') : '';
    return `<div class="world ${state.selected?.path === w.path ? 'sel' : ''}" data-i="${i}" title="${esc(c.text)}">
      ${w.icon ? `<img src="${w.icon}">` : '<div class="ph"></div>'}
      <div class="winfo"><div class="wname">${esc(w.name)}</div>
        <div class="meta">${esc(ver)}${gt ? ' · ' + gt : ''} · ${fmtSize(w.size)}</div>
        <div class="meta">Zuletzt gespielt: ${fmtDate(w.lastPlayed)} · Ordner: ${esc(w.folder)}</div></div>
      <span class="badge ${c.level}">${LABEL[c.level]}</span></div>`;
  }).join('');
  el.querySelectorAll('.world').forEach((n) => n.onclick = () => { state.selected = state.worlds[n.dataset.i]; renderWorlds(); renderFooter(); });
}

function renderFooter() {
  const w = state.selected, c = w && state.compat.get(w.path);
  const btn = $('#uploadBtn');
  if (!w || !state.server) {
    $('#summary').textContent = !w ? 'Wähle links eine Welt …' : 'Wähle rechts einen Server …';
    btn.disabled = true; return;
  }
  $('#summary').innerHTML = `<b>${esc(w.name)}</b> → <b>${esc(state.server.name)}</b><div class="msg ${c.level}">${esc(c.text)}</div>`;
  btn.disabled = w.edition === 'bedrock' || c.level === 'bad';
}

function renderServerSelect() {
  const sel = $('#serverSelect');
  sel.innerHTML = '<option value="">– Server wählen –</option>' + state.servers.map((s) => `<option value="${s.id}">${esc(s.name)} (${esc(s.host)})</option>`).join('');
  sel.value = state.server?.id || '';
}

async function selectServer(id) {
  state.server = state.servers.find((s) => s.id === id) || null;
  state.status = null; state.info = null;
  renderServerSelect(); renderServerPanel(); renderFooter();
  if (!state.server) { await refreshCompat(); return; }
  const mine = state.server.id;
  const [status, info] = await Promise.all([api.pingServer(mine), api.serverInfo(mine)]);
  if (state.server?.id !== mine) return;
  state.status = status; state.info = info;
  renderServerPanel(); await refreshCompat();
}

function renderServerPanel() {
  const s = state.server, el = $('#serverPanel');
  if (!s) { el.innerHTML = '<p class="hint">Noch kein Server gewählt. Füge einen hinzu, um Specs und Kompatibilität zu sehen.</p>'; return; }
  const st = state.status, info = state.info;
  let h = '';
  if (!st) h += '<p class="hint">Lade Serverdaten …</p>';
  else {
    h += `<div class="srvhead">${st.favicon ? `<img src="${st.favicon}">` : ''}<div>
      <div><span class="dot ${st.online ? 'on' : 'off'}"></span><b>${st.online ? 'Online' : 'Nicht erreichbar'}</b>${st.online ? ` · ${st.latency} ms` : ` (${esc(st.error)})`}</div>
      ${st.online ? `<div class="meta">${esc(st.motd)}</div>` : ''}</div></div>`;
    if (st.online) {
      h += `<dl class="specs"><dt>Version</dt><dd>${esc(st.versionName)}${st.resolved ? '' : ' <span class="meta">(nicht in Tabelle)</span>'}</dd>
        <dt>Protokoll</dt><dd>${st.protocol}</dd>
        <dt>Spieler</dt><dd>${st.players ? st.players.online + ' / ' + st.players.max : '–'}</dd>`;
    } else h += '<dl class="specs">';
    h += `<dt>Adresse</dt><dd>${esc(s.host)}:${s.gamePort || 25565}</dd>`;
    if (!info) h += '<dt>Dateizugriff</dt><dd class="hint">Prüfe …</dd>';
    else if (!info.ok) h += `<dt>Dateizugriff</dt><dd><span class="dot off"></span>${esc(info.error)}</dd>`;
    else {
      h += `<dt>Dateizugriff</dt><dd><span class="dot on"></span>${s.protocol === 'local' ? 'Lokaler Ordner' : s.protocol.toUpperCase() + ' verbunden'}</dd>`;
      const p = info.properties;
      if (!info.hasProps) h += '<dt>server.properties</dt><dd class="meta">nicht gefunden – Server-Verzeichnis prüfen</dd>';
      else {
        const rows = [['Aktive Welt', p['level-name']], ['Spielmodus', p.gamemode], ['Schwierigkeit', p.difficulty], ['Max. Spieler', p['max-players']],
          ['Sichtweite', p['view-distance']], ['Online-Modus', p['online-mode']], ['Whitelist', p['white-list']], ['Hardcore', p.hardcore]];
        h += rows.filter((r) => r[1] != null).map((r) => `<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join('');
      }
      h += `<dt>Welten auf Server</dt><dd>${info.worlds.length ? info.worlds.map(esc).join(', ') : '–'}</dd>`;
    }
    h += '</dl>';
  }
  h += '<div class="panelactions"><button id="refreshSrv" class="ghost">Aktualisieren</button><button id="editSrv" class="ghost">Bearbeiten</button><button id="delSrv" class="ghost">Löschen</button></div>';
  el.innerHTML = h;
  $('#refreshSrv').onclick = () => selectServer(s.id);
  $('#editSrv').onclick = () => openDialog(s);
  $('#delSrv').onclick = async () => { if (confirm(`Server „${s.name}" entfernen?`)) { await api.deleteServer(s.id); await loadServers(); selectServer(''); } };
}

// ---- Server-Dialog
const form = $('#serverForm');
function syncProto() {
  const proto = form.protocol.value, sftp = proto === 'sftp', local = proto === 'local';
  $('#netRow').hidden = $('#authRow').hidden = local; $('#pickDir').hidden = !local;
  $('#keyRow').hidden = !sftp; $('#ftpsRow').hidden = proto !== 'ftp';
  $('#dirHint').textContent = local ? '(Ordner auf diesem Rechner mit server.properties)' : '(Ordner mit server.properties)';
  if (local && form.remoteDir.value === '/') form.remoteDir.value = '';
  if (local && !form.host.value) form.host.value = 'localhost';
  form.filePort.placeholder = sftp ? '22' : '21';
}
form.protocol.onchange = syncProto;
$('#pickDir').onclick = async () => { const p = await api.pickDir(); if (p) form.remoteDir.value = p; };
$('#pickKey').onclick = async () => { const p = await api.pickKey(); if (p) form.privateKeyPath.value = p; };
$('#dlgCancel').onclick = () => $('#serverDlg').close();
function openDialog(s) {
  form.reset(); form.dataset.id = s?.id || '';
  $('#dlgTitle').textContent = s ? 'Server bearbeiten' : 'Server hinzufügen';
  form.password.placeholder = s?.hasPassword ? '(unverändert lassen)' : '';
  if (s) for (const [k, v] of Object.entries(s)) { const f = form.elements[k]; if (f && k !== 'password') { if (f.type === 'checkbox') f.checked = !!v; else f.value = v ?? ''; } }
  syncProto(); $('#serverDlg').showModal();
}
form.onsubmit = async () => {
  const d = Object.fromEntries(new FormData(form));
  d.ftps = form.ftps.checked; d.id = form.dataset.id || undefined;
  d.gamePort = Number(d.gamePort) || 25565; d.filePort = Number(d.filePort) || (d.protocol === 'sftp' ? 22 : 21);
  const saved = await api.saveServer(d);
  await loadServers(); selectServer(saved.id);
};
async function loadServers() { state.servers = await api.listServers(); renderServerSelect(); }

// ---- Upload
const dlg = $('#uploadDlg');
$('#uploadBtn').onclick = () => {
  $('#targetName').value = state.selected.folder; $('#setLevelName').checked = false;
  $('#progressWrap').hidden = true; $('#uploadResult').innerHTML = ''; $('#uploadGo').disabled = false;
  dlg.showModal();
};
$('#uploadCancel').onclick = () => dlg.close();
api.onProgress((p) => {
  $('#bar').max = p.total || 1; $('#bar').value = p.sent;
  $('#progressText').textContent = `${p.index}/${p.count} Dateien · ${fmtSize(p.sent)} / ${fmtSize(p.total)} · ${p.file}`;
});
$('#uploadGo').onclick = async () => {
  const name = $('#targetName').value.trim();
  if (!/^[\w.\- ]+$/.test(name)) { $('#uploadResult').innerHTML = '<div class="msg bad">Ungültiger Ordnername (erlaubt: Buchstaben, Zahlen, Leerzeichen, . _ -).</div>'; return; }
  $('#uploadGo').disabled = true; $('#progressWrap').hidden = false; $('#uploadResult').innerHTML = '';
  const r = await api.upload({ serverId: state.server.id, world: state.selected, targetName: name, setLevelName: $('#setLevelName').checked });
  $('#uploadResult').innerHTML = r.ok
    ? `<div class="msg ok">Fertig: ${r.files} Dateien (${fmtSize(r.bytes)}) hochgeladen.</div>`
    : `<div class="msg bad">${esc(r.error)}</div>`;
  $('#uploadGo').disabled = false;
  if (r.ok) selectServer(state.server.id);
};

$('#serverSelect').onchange = (e) => selectServer(e.target.value);
$('#newServer').onclick = () => openDialog(null);
$('#rescan').onclick = loadWorlds;
$('#addDir').onclick = async () => { if (await api.addWorldDir()) loadWorlds(); };

(async () => { await loadServers(); renderServerPanel(); await loadWorlds(); })();
