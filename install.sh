#!/usr/bin/env bash
# VPN Telegram Bot — one-shot installer
# Usage:
#   sudo bash install.sh
# Or one-liner:
#   curl -fsSL https://raw.githubusercontent.com/redf0x2811/myvpn/main/install.sh | sudo bash

set -euo pipefail

REPO="${REPO:-https://github.com/redf0x2811/myvpn.git}"
DIR="${DIR:-/opt/myvpn}"
PORT_WG="${PORT_WG:-51820}"

cyan()  { printf '\e[1;36m%s\e[0m\n' "$*"; }
green() { printf '\e[1;32m%s\e[0m\n' "$*"; }
red()   { printf '\e[1;31m%s\e[0m\n' "$*" >&2; }

[ "$(id -u)" -eq 0 ] || { red "Cần root: sudo bash install.sh"; exit 1; }

cyan "==> 1. Kiểm tra virtualization"
VIRT=$(systemd-detect-virt 2>/dev/null || echo unknown)
echo "    Kiểu: $VIRT"
case "$VIRT" in
  lxc|openvz)
    red "VPS là $VIRT — kernel không cho tạo WireGuard interface."
    red "Cần VPS KVM (Vultr/Hetzner/DigitalOcean/AWS...)."
    exit 1
    ;;
esac

cyan "==> 2. Cài Docker nếu thiếu"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
else
  echo "    Docker: $(docker --version)"
fi
docker compose version >/dev/null 2>&1 || { red "Docker Compose v2 không có"; exit 1; }

cyan "==> 3. Cài git nếu thiếu"
command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }

cyan "==> 4. Clone/update repo"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi
cd "$DIR"

if [ ! -f .env ]; then
  cyan "==> 5. Cấu hình"
  PUBLIC_IP=$(curl -fsS --max-time 3 ifconfig.me 2>/dev/null || echo "")
  DEFAULT_HOST="${PUBLIC_IP:-your-domain.com}"
  read -rp "    Domain/IP của VPS [$DEFAULT_HOST]: " WG_HOST
  WG_HOST="${WG_HOST:-$DEFAULT_HOST}"

  echo
  echo "    Tạo bot: chat @BotFather → /newbot → copy token"
  read -rp "    Telegram bot token: " TG_TOKEN
  while [ -z "$TG_TOKEN" ]; do
    red "    Token bắt buộc phải có."
    read -rp "    Telegram bot token: " TG_TOKEN
  done

  echo
  echo "    Nếu chưa biết user ID: cứ bỏ trống, deploy xong chat bot /whoami để lấy"
  read -rp "    Telegram user ID(s), cách nhau dấu phẩy: " TG_IDS

  cat > .env <<EOF
WG_HOST=$WG_HOST
TELEGRAM_BOT_TOKEN=$TG_TOKEN
TELEGRAM_ALLOWED_IDS=$TG_IDS
EOF
  chmod 600 .env
  echo "    .env đã tạo"
else
  cyan "==> 5. .env đã tồn tại, giữ nguyên"
fi

cyan "==> 6. Build và chạy container"
docker compose up -d --build

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  cyan "==> 7. Mở firewall (ufw)"
  ufw allow "${PORT_WG}/udp"  >/dev/null 2>&1 || true
fi

sleep 3
cyan "==> 8. Trạng thái"
docker compose ps

TG_IDS=$(grep '^TELEGRAM_ALLOWED_IDS=' .env | cut -d= -f2-)

echo
green "✅ Xong!"
echo
echo "  1. Mở Telegram, tìm bot bạn vừa tạo"
echo "  2. Gõ /start"
if [ -z "$TG_IDS" ]; then
  echo "  3. Bot sẽ trả về User ID của bạn → copy"
  echo "  4. Thêm ID vào $DIR/.env (dòng TELEGRAM_ALLOWED_IDS=...)"
  echo "  5. cd $DIR && docker compose up -d (reload env)"
  echo "  6. Chat bot /new phone → nhận QR"
else
  echo "  3. /new phone → nhận QR → scan bằng WireGuard app"
fi
echo
echo "  Log:     cd $DIR && docker compose logs -f"
echo "  Restart: cd $DIR && docker compose restart"
echo "  Stop:    cd $DIR && docker compose down"
echo "  Update:  bash $DIR/install.sh"
echo
