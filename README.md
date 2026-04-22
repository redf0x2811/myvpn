# VPN Telegram Bot

Self-hosted WireGuard VPN qua Telegram bot. Chat bot → nhận QR → scan → có VPN.

## Cài 1 lệnh

SSH vào VPS (root), chạy:

```bash
curl -fsSL https://raw.githubusercontent.com/redf0x2811/myvpn/main/install.sh | sudo bash
```

Hoặc upload `install.sh` qua WinSCP rồi chạy:

```bash
sudo bash install.sh
```

Script tự: kiểm tra VPS → cài Docker → clone repo → hỏi config → deploy → mở firewall.

## Yêu cầu VPS

- Linux (Ubuntu/Debian)
- **KVM** (không phải OpenVZ/LXC) — script sẽ báo lỗi nếu sai
- Kernel 5.6+ (WireGuard built-in)

## Chuẩn bị

1. Chat [@BotFather](https://t.me/BotFather) → `/newbot` → copy token
2. Có domain hoặc IP VPS

## Commands trong bot

| Lệnh | Tác dụng |
|------|----------|
| `/new phone` | Tạo VPN, bot gửi QR + file .conf |
| `/list` | Danh sách VPN đang có |
| `/revoke 2` | Xoá VPN số 2 (từ /list) |
| `/whoami` | Xem user ID |
| `/help` | Hướng dẫn |

## Bảo mật

Chỉ user ID có trong `TELEGRAM_ALLOWED_IDS` mới dùng được. Người khác chat bot nhận message từ chối.

## Quản lý

```bash
cd /opt/myvpn

docker compose logs -f     # log realtime
docker compose restart     # restart
docker compose down        # stop
bash install.sh            # update code + rebuild
```

## Port

| Port  | Protocol | Dùng để |
|-------|----------|---------|
| 51820 | UDP      | WireGuard |

Bot gọi Telegram API outbound → không cần mở port nào khác.
