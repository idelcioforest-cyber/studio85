#!/usr/bin/env bash
# Atualiza a ponte de WhatsApp na VPS (PM2: studio85-whatsapp em /root/studio85-whatsapp).
# Usa a chave SSH (sem senha) e não mexe no .env nem na sessão do número (auth_info/).
#   VPS=root@IP-DA-VPS ./services/whatsapp-bridge/deploy-vps.sh
set -euo pipefail

: "${VPS:?Defina VPS=usuario@ip-da-vps}"
DIR=/root/studio85-whatsapp

cd "$(dirname "$0")"
scp -q server.js package.json package-lock.json "$VPS:$DIR/"
ssh "$VPS" "cd $DIR && npm ci --omit=dev --no-audit --no-fund && pm2 restart studio85-whatsapp --update-env && pm2 save"
ssh "$VPS" "pm2 describe studio85-whatsapp | grep -E 'status|restarts'"
