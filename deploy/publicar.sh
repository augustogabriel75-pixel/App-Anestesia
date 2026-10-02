#!/usr/bin/env bash
# =====================================================================
# Publica na VPS via SSH + rsync (usado pelos workflows do GitHub Actions).
#   publicar.sh site www/               → atualiza o app web (mantém /download)
#   publicar.sh apk  VetAnest.apk       → atualiza https://SEU_DOMINIO/download/VetAnest.apk
# Variáveis: VPS_HOST, VPS_USER, VPS_SSH_KEY (chave privada)
#            opcionais: VPS_PORT (22), VPS_PATH (/var/www/vetanest), VPS_KNOWN_HOSTS
# =====================================================================
set -euo pipefail
: "${VPS_HOST:?defina VPS_HOST}" "${VPS_USER:?defina VPS_USER}" "${VPS_SSH_KEY:?defina VPS_SSH_KEY}"
PORT="${VPS_PORT:-22}"; DEST="${VPS_PATH:-/var/www/vetanest}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
printf '%s\n' "$VPS_SSH_KEY" > "$TMP/key"; chmod 600 "$TMP/key"
# Impressão digital do servidor: use VPS_KNOWN_HOSTS (mais seguro) ou leia na hora.
if [ -n "${VPS_KNOWN_HOSTS:-}" ]; then printf '%s\n' "$VPS_KNOWN_HOSTS" > "$TMP/known"
else ssh-keyscan -p "$PORT" "$VPS_HOST" > "$TMP/known" 2>/dev/null; fi
SSH="ssh -p $PORT -i $TMP/key -o UserKnownHostsFile=$TMP/known -o StrictHostKeyChecking=yes -o BatchMode=yes"

case "${1:-}" in
  site)
    [ -f "${2:?pasta}/index.html" ] || { echo "ERRO: $2/index.html não existe" >&2; exit 1; }
    rsync -rlz --delete --chmod=D755,F644 --exclude 'download/' -e "$SSH" "$2"/ "$VPS_USER@$VPS_HOST:$DEST/"
    echo "Site publicado em $VPS_HOST:$DEST" ;;
  apk)
    [ -f "${2:?arquivo}" ] || { echo "ERRO: $2 não existe" >&2; exit 1; }
    rsync -z --chmod=F644 -e "$SSH" "$2" "$VPS_USER@$VPS_HOST:$DEST/download/VetAnest.apk.tmp"
    $SSH "$VPS_USER@$VPS_HOST" "mv -f '$DEST/download/VetAnest.apk.tmp' '$DEST/download/VetAnest.apk'"   # troca atômica
    echo "APK publicado em $VPS_HOST:$DEST/download/VetAnest.apk" ;;
  *) echo "uso: $0 site <pasta> | apk <arquivo.apk>" >&2; exit 2 ;;
esac
