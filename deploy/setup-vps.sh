#!/usr/bin/env bash
# =====================================================================
# VetAnest – preparação da VPS (Ubuntu/Debian), rodar UMA vez como root:
#   sudo bash setup-vps.sh app.seudominio.com.br seu@email.com "ssh-ed25519 AAAA... github-deploy"
# Faz: instala nginx + certbot, cria o usuário "deploy" (só para publicar),
# configura o site com HTTPS (Let's Encrypt) e libera o firewall.
# =====================================================================
set -euo pipefail
DOMINIO="${1:?Informe o domínio, ex.: app.seudominio.com.br}"
EMAIL="${2:?Informe um e-mail para o certificado HTTPS}"
CHAVE_PUB="${3:?Informe a chave pública SSH do GitHub (deploy.pub)}"
DIR=/var/www/vetanest

echo "==> Instalando nginx, certbot e rsync"
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx rsync openssh-server

echo "==> Usuário de publicação 'deploy' (sem senha, só chave SSH)"
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
grep -qxF "$CHAVE_PUB" /home/deploy/.ssh/authorized_keys 2>/dev/null || echo "$CHAVE_PUB" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys

echo "==> Pasta do site: $DIR"
install -d -o deploy -g www-data -m 755 "$DIR" "$DIR/download"
[ -f "$DIR/index.html" ] || echo '<!doctype html><meta charset="utf-8"><title>VetAnest</title><p>Em breve.</p>' > "$DIR/index.html"
chown -R deploy:www-data "$DIR"

echo "==> nginx"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
sed "s/SEU_DOMINIO/$DOMINIO/g" "$SCRIPT_DIR/nginx-vetanest.conf" > /etc/nginx/sites-available/vetanest
[ -f /proc/net/if_inet6 ] || sed -i '/listen \[::\]/d' /etc/nginx/sites-available/vetanest   # servidor sem IPv6
ln -sf /etc/nginx/sites-available/vetanest /etc/nginx/sites-enabled/vetanest
if ! nginx -t; then echo "ERRO: configuração do nginx inválida – nada foi alterado no site." >&2; exit 1; fi
systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "==> Firewall: liberando HTTP/HTTPS"; ufw allow 'Nginx Full'
fi

if [ "${SEM_HTTPS:-0}" != "1" ]; then
  echo "==> Certificado HTTPS (o DNS do domínio já precisa apontar para esta VPS)"
  certbot --nginx -d "$DOMINIO" -m "$EMAIL" --agree-tos --non-interactive --redirect
fi

echo
echo "Pronto! Site: https://$DOMINIO"
echo "No GitHub, crie os secrets: VPS_HOST=$(curl -s -4 ifconfig.me || echo IP_DA_VPS)  VPS_USER=deploy  VPS_SSH_KEY=(conteúdo da chave PRIVADA)"
