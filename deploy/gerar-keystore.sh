#!/usr/bin/env bash
# =====================================================================
# Gera a chave de assinatura do app Android (rodar UMA vez, na sua VPS ou PC):
#   bash gerar-keystore.sh
# Sem uma chave fixa, cada APK sai assinado com uma chave diferente e o
# Android recusa a atualização (o cliente teria que desinstalar o app).
# GUARDE o arquivo vetanest-release.keystore e as senhas em local seguro:
# sem eles não é possível atualizar o app instalado pelos clientes.
# =====================================================================
set -euo pipefail
command -v keytool >/dev/null || { echo "==> Instalando Java (keytool)"; sudo apt-get update -y && sudo apt-get install -y default-jre-headless; }
ARQ=vetanest-release.keystore
[ -e "$ARQ" ] && { echo "ERRO: $ARQ já existe – não sobrescrevo uma chave em uso." >&2; exit 1; }
SENHA="$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"   # 32 caracteres hexadecimais aleatórios
keytool -genkeypair -v -keystore "$ARQ" -alias vetanest -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$SENHA" -keypass "$SENHA" -dname "CN=VetAnest, O=VetAnest, C=BR" >/dev/null 2>&1
chmod 600 "$ARQ"
echo
echo "Chave criada: $(pwd)/$ARQ  (faça uma cópia de segurança!)"
echo "Crie estes SECRETS no GitHub (Settings → Secrets and variables → Actions → Secrets):"
echo "  ANDROID_KEYSTORE_PASSWORD = $SENHA"
echo "  ANDROID_KEY_PASSWORD      = $SENHA"
echo "  ANDROID_KEY_ALIAS         = vetanest"
echo "  ANDROID_KEYSTORE_BASE64   = (o texto abaixo, tudo numa linha só)"
echo
base64 -w0 "$ARQ"; echo
