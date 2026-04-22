# VPN QR Portal

Self-hosted WireGuard portal. Truy cập trang → scan QR → có VPN.

## Deploy với Dokploy

### 1. Push code lên Git

```bash
cd vpn-portal
git init
git add .
git commit -m "init"
git remote add origin <git-repo-url>
git push -u origin main
```

### 2. Tạo service trên Dokploy

- Dokploy dashboard → **Create → Compose**
- Repository: trỏ về git repo vừa push
- Compose Path: `docker-compose.yml`

### 3. Set Environment Variables

Trong tab **Environment** của service:

```
WG_HOST=soulmu.site
PORTAL_TOKEN=<chuỗi-bí-mật-của-bạn>
```

Đổi `PORTAL_TOKEN` thành chuỗi ngẫu nhiên dài (ai có token mới tạo được VPN).

### 4. Deploy

Bấm **Deploy**. Dokploy tự build image và chạy.

### 5. Mở firewall VPS (chỉ làm 1 lần)

SSH vào VPS:

```bash
ufw allow 2255/tcp
ufw allow 51820/udp
```

### 6. Truy cập

- `http://soulmu.site:2255` → nhập token → scan QR → VPN ngay

## Cấu trúc

```
vpn-portal/
├── docker-compose.yml   ← Dokploy đọc file này
├── .env.example         ← mẫu env vars
└── app/
    ├── Dockerfile
    ├── package.json
    ├── server.js        ← backend (Node.js + Express)
    └── public/
        └── index.html   ← frontend
```

## Ports

| Port | Protocol | Dùng để |
|------|----------|---------|
| 2255 | TCP | Web portal |
| 51820 | UDP | WireGuard VPN |

## Ad blocking

Mặc định client dùng **AdGuard Public DNS** (`94.140.14.14`) — chặn quảng cáo ở tầng DNS.
Đổi DNS qua env `WG_DNS` nếu muốn.

## Update

Mỗi lần push code mới lên git → Dokploy rebuild → xong.
Dữ liệu client giữ nguyên trong Docker volume `wg_data`.
