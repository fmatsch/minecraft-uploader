# Minecraft Uploader

Lokale Java-Welten auf einen Minecraft-Server hochladen (macOS & Windows) – mit Server-Specs und Kompatibilitätsprüfung.
Download und Beschreibung: https://fmatsch.ist/minecraft-uploader/

    npm install
    npm start          # App starten
    npm test           # Logik-Tests
    npm run dist:mac   # .dmg (arm64 + x64)
    npm run dist:win   # Windows-Installer

- Welten werden in `.minecraft/saves` gefunden (weitere Ordner per Button).
- Server: SFTP, FTP oder lokaler Ordner. Passwörter werden mit dem OS-Schlüsselbund (Electron safeStorage) verschlüsselt.
- Kompatibilität: DataVersion der Welt (`level.dat`) vs. Version des Servers (Status-Ping). Versionstabelle: `src/lib/versions.js`.
- `deploy/server-setup.sh`: richtet Paper + Geyser + Floodgate (Java-Server mit Zugang für iPad/Bedrock) auf Ubuntu 24.04 ein.

MIT-Lizenz. Kein offizielles Produkt von Mojang oder Microsoft.
