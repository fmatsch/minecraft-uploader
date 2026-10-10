#!/usr/bin/env bash
# Richtet Paper + Geyser + Floodgate auf Ubuntu 24.04 ein (Java-Server, iPad/Bedrock über Geyser).
# Aufruf als root:  bash server-setup.sh
# Optional: PUBKEY="ssh-ed25519 AAAA..." legt zusätzlich ein SFTP-only-Konto "mcupload" für den Uploader an.
# Das Mojang-EULA wird NICHT akzeptiert – das macht der Betreiber selbst (eula.txt).
set -euo pipefail
PAPER_VERSION="${PAPER_VERSION:-26.1.2}"
MC=/srv/minecraft

apt-get update -qq || echo "WARNUNG: apt update meldet Fehler (Drittanbieter-Repo), fahre fort"
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-25-jre-headless curl jq

id minecraft &>/dev/null || useradd --system --home-dir "$MC" --shell /usr/sbin/nologin minecraft
install -d -o minecraft -g minecraft -m 2775 "$MC" "$MC/plugins"

fetch() { # url sha256 ziel
  curl -fsSL "$1" -o "$3.tmp"
  [ -z "$2" ] || echo "$2  $3.tmp" | sha256sum -c - >/dev/null
  mv "$3.tmp" "$3"
}

# Paper
B=$(curl -fsS "https://fill.papermc.io/v3/projects/paper/versions/$PAPER_VERSION/builds/latest")
fetch "$(jq -r '.downloads["server:default"].url' <<<"$B")" "$(jq -r '.downloads["server:default"].checksums.sha256' <<<"$B")" "$MC/paper.jar"

# Geyser + Floodgate (Spigot/Paper-Varianten)
for p in geyser floodgate; do
  V=$(curl -fsS "https://download.geysermc.org/v2/projects/$p" | jq -r '.versions[-1]')
  I=$(curl -fsS "https://download.geysermc.org/v2/projects/$p/versions/$V/builds/latest")
  SHA=$(jq -r '.downloads.spigot.sha256' <<<"$I")
  fetch "https://download.geysermc.org/v2/projects/$p/versions/$V/builds/latest/downloads/spigot" "$SHA" "$MC/plugins/$p-spigot.jar"
done

[ -f "$MC/eula.txt" ] || printf '# https://aka.ms/MinecraftEULA – auf true setzen = Zustimmung\neula=false\n' > "$MC/eula.txt"
[ -f "$MC/server.properties" ] || cat > "$MC/server.properties" <<'P'
motd=Minecraft (Java + iPad/Bedrock)
server-port=25565
online-mode=true
white-list=true
enforce-whitelist=true
max-players=10
difficulty=normal
view-distance=10
simulation-distance=8
enable-rcon=false
level-name=world
P
chown -R minecraft:minecraft "$MC"

cat > /etc/systemd/system/minecraft.socket <<'U'
[Unit]
Description=Minecraft Konsole (stdin)
[Socket]
ListenFIFO=/run/minecraft.stdin
SocketUser=minecraft
SocketGroup=minecraft
SocketMode=0660
RemoveOnStop=true
U
cat > /etc/systemd/system/minecraft.service <<'U'
[Unit]
Description=Minecraft Server (Paper + Geyser)
After=network-online.target
Wants=network-online.target
Requires=minecraft.socket
After=minecraft.socket
[Service]
User=minecraft
Group=minecraft
WorkingDirectory=/srv/minecraft
Sockets=minecraft.socket
StandardInput=socket
StandardOutput=journal
StandardError=journal
ExecStart=/usr/bin/java -Xms2G -Xmx6G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+DisableExplicitGC -XX:+PerfDisableSharedMem -XX:G1HeapRegionSize=8M -XX:InitiatingHeapOccupancyPercent=15 -jar paper.jar --nogui
ExecStop=/bin/sh -c 'echo stop > /run/minecraft.stdin'
TimeoutStopSec=90
Restart=on-failure
RestartSec=10
Nice=5
MemoryMax=8G
UMask=0002
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/srv/minecraft
[Install]
WantedBy=multi-user.target
U
systemctl daemon-reload

# Optional: SFTP-only Upload-Konto
if [ -n "${PUBKEY:-}" ]; then
  id mcupload &>/dev/null || useradd --home-dir /home/mcupload --create-home --shell /usr/sbin/nologin -G minecraft mcupload
  cat > /etc/ssh/sshd_config.d/60-minecraft-upload.conf <<'S'
Match User mcupload
    ForceCommand internal-sftp -u 0002
    PasswordAuthentication no
    AllowTcpForwarding no
    X11Forwarding no
    PermitTTY no
S
  install -d -m 700 -o mcupload -g mcupload /home/mcupload/.ssh
  echo "$PUBKEY" > /home/mcupload/.ssh/authorized_keys
  chown mcupload:mcupload /home/mcupload/.ssh/authorized_keys; chmod 600 /home/mcupload/.ssh/authorized_keys
  sshd -t && systemctl reload ssh
fi
echo "FERTIG. Nächster Schritt: eula.txt prüfen/akzeptieren, dann: systemctl enable --now minecraft"
