# VPN QR Portal

Self-hosted WireGuard portal. Vào trang web hoặc chat Telegram bot → scan QR → có VPN.

## Cài đặt nhanh

SSH vào VPS (root), chạy 1 lệnh:

```bash
curl -fsSL https://raw.githubusercontent.com/redf0x2811/myvpn/main/install.sh | sudo bash
```

Hoặc upload `install.sh` qua WinSCP rồi chạy:

```bash
sudo bash install.sh
```

Script sẽ:
1. Kiểm tra VPS (reject nếu là LXC/OpenVZ)
2. Cài Docker nếu thiếu
3. Clone repo vào `/opt/myvpn`
4. Hỏi domain/IP + sinh token ngẫu nhiên
5. Build và chạy container
6. Mở firewall (ufw)
7. In ra link + token

## Yêu cầu VPS

- Linux (Ubuntu/Debian khuyên dùng)
- **KVM** (không phải OpenVZ/LXC)
- Kernel 5.6+ (có WireGuard built-in)
- Root / sudo access

## Tính năng

- ✅ Web portal với QR: nhập tên thiết bị → scan QR → kết nối
- ✅ Telegram bot: `/new phone` → bot gửi QR + file .conf
- ✅ Chặn ads qua AdGuard Public DNS (`94.140.14.14`)
- ✅ Config WireGuard tự sinh, lưu persistent qua restart
- ✅ Script quản lý: list / revoke clients

## Lệnh quản lý

```bash
cd /opt/myvpn

docker compose logs -f     # xem log realtime
docker compose restart     # restart
docker compose down        # stop
docker compose ps          # trạng thái

bash install.sh            # update code + rebuild
```

## Telegram bot

Trong `.env`:

```
TELEGRAM_BOT_TOKEN=1234:ABC...    # lấy từ @BotFather
TELEGRAM_ALLOWED_IDS=123456789    # gửi /whoami để lấy ID
```

Sau đó `docker compose up -d --build` để áp dụng.

Commands trong bot:
- `/new phone` — tạo VPN mới
- `/list` — xem danh sách
- `/revoke 2` — xoá client số 2
- `/whoami` — xem user ID

## Ports

| Port  | Protocol | Dùng để |
|-------|----------|---------|
| 2255  | TCP      | Web portal |
| 51820 | UDP      | WireGuard |

## Cấu trúc

```
vpn-portal/
├── install.sh           ← installer 1-click
├── docker-compose.yml
├── Dockerfile
├── server.js            ← backend (Node.js + Express + Telegram bot)
├── package.json
├── public/index.html    ← frontend
├── .dockerignore
├── .gitignore
└── .env.example
```
