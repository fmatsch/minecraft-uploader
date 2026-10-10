const { byName } = require('./versions');

// Liefert { level: 'ok'|'upgrade'|'bad'|'unknown', text }
function checkCompat(world, server) {
  if (world.edition === 'bedrock') {
    return { level: 'bad', text: 'Bedrock-Welt – Java-Server können sie nicht laden.' };
  }
  if (!server) return { level: 'unknown', text: 'Kein Server gewählt.' };
  if (!server.status || !server.status.online) {
    return { level: 'unknown', text: 'Server nicht erreichbar – Version unbekannt.' };
  }
  const sv = server.status.resolved;
  if (!sv) {
    return { level: 'unknown', text: `Serverversion „${server.status.versionName}" ist nicht in der Versionstabelle.` };
  }
  if (world.dataVersion == null) {
    return { level: 'upgrade', text: 'Sehr alte Welt (vor 1.9). Wird beim ersten Laden konvertiert – vorher Backup anlegen.' };
  }
  if (world.dataVersion > sv.dataVersion) {
    return {
      level: 'bad',
      text: `Welt wurde mit ${world.versionName || 'einer neueren Version'} gespeichert, Server läuft ${sv.name}. Welten lassen sich nicht herunterstufen.`,
    };
  }
  if (world.dataVersion === sv.dataVersion) {
    return { level: 'ok', text: `Passt exakt zu Server-Version ${sv.name}.` };
  }
  const wv = world.versionName ? ` (${world.versionName})` : '';
  return {
    level: 'upgrade',
    text: `Welt${wv} ist älter als Server ${sv.name} und wird beim ersten Laden aktualisiert – danach nicht mehr rückwärts nutzbar.`,
  };
}

module.exports = { checkCompat, byName };
