import express from 'express';
import { execSync } from 'child_process';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

const PORT = 3000;
const WG_PORT = 51820;
const WG_HOST = process.env.WG_HOST;
const WG_DNS = process.env.WG_DNS || '94.140.14.14, 94.140.15.15';
const PORTAL_TOKEN = process.env.PORTAL_TOKEN;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_ALLOWED = (process.env.TELEGRAM_ALLOWED_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const WG_DIR = '/etc/wireguard';
const WG_CONF = path.join(WG_DIR, 'wg0.conf');
const DB_FILE = path.join(WG_DIR, 'clients.json');
const SERVER_PRIV = path.join(WG_DIR, 'server_private.key');
const SERVER_PUB = path.join(WG_DIR, 'server_public.key');

if (!WG_HOST || !PORTAL_TOKEN) {
  console.error('ERROR: WG_HOST and PORTAL_TOKEN env vars are required');
  process.exit(1);
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], ...opts }).toString();
}

function genKeypair() {
  const priv = sh('wg genkey').trim();
  const pub = sh('wg pubkey', { input: priv }).trim();
  return { priv, pub };
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) return { clients: [], nextIp: 2 };
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function writeWgConfig() {
  const db = readDb();
  const priv = fs.readFileSync(SERVER_PRIV, 'utf8').trim();
  let conf = `[Interface]
Address = 10.8.0.1/24
ListenPort = ${WG_PORT}
PrivateKey = ${priv}
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
`;
  for (const c of db.clients) {
    conf += `
# ${c.name}
[Peer]
PublicKey = ${c.pub}
AllowedIPs = 10.8.0.${c.ip}/32
`;
  }
  fs.writeFileSync(WG_CONF, conf, { mode: 0o600 });
}

function bootstrap() {
  if (!fs.existsSync(SERVER_PRIV)) {
    console.log('First run: generating server keys');
    const { priv, pub } = genKeypair();
    fs.writeFileSync(SERVER_PRIV, priv, { mode: 0o600 });
    fs.writeFileSync(SERVER_PUB, pub);
  }
  if (!fs.existsSync(DB_FILE)) writeDb({ clients: [], nextIp: 2 });
  writeWgConfig();
  try { sh('wg-quick down wg0'); } catch {}
  sh('wg-quick up wg0');
  console.log('WireGuard is up on wg0');
}

function reloadWg() {
  writeWgConfig();
  const stripped = sh('wg-quick strip wg0');
  const tmp = '/tmp/wg0.stripped';
  fs.writeFileSync(tmp, stripped);
  sh(`wg syncconf wg0 ${tmp}`);
  fs.unlinkSync(tmp);
}

async function createClient(nameInput) {
  const raw = String(nameInput || 'device');
  const name = raw.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 20) || 'device';

  const db = readDb();
  if (db.nextIp > 250) throw new Error('Het IP (>250 clients)');

  const { priv, pub } = genKeypair();
  const ip = db.nextIp;
  db.nextIp = ip + 1;
  const fullName = `${name}-${Date.now()}`;
  db.clients.push({ name: fullName, pub, ip, created: Date.now() });
  writeDb(db);

  const serverPub = fs.readFileSync(SERVER_PUB, 'utf8').trim();
  const config = `[Interface]
PrivateKey = ${priv}
Address = 10.8.0.${ip}/32
DNS = ${WG_DNS}

[Peer]
PublicKey = ${serverPub}
Endpoint = ${WG_HOST}:${WG_PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;

  reloadWg();

  const qrDataUrl = await QRCode.toDataURL(config, { width: 512, margin: 2 });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  return { name: fullName, ip, config, qrDataUrl, qrBuffer };
}

bootstrap();

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.post('/api/create', async (req, res) => {
  try {
    if (req.body.token !== PORTAL_TOKEN) {
      return res.status(401).json({ error: 'Sai access token' });
    }
    const c = await createClient(req.body.name);
    res.json({ qr: c.qrDataUrl, config: c.config });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/health', (_, res) => {
  const db = readDb();
  res.json({ ok: true, clients: db.clients.length });
});

app.listen(PORT, () => {
  console.log(`Portal listening on :${PORT} | WG endpoint: ${WG_HOST}:${WG_PORT}`);
});

// ---------- Telegram bot ----------

async function tgCall(method, params) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return r.json();
}

async function tgSendFile(method, chatId, field, buffer, filename, extra = {}) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  for (const [k, v] of Object.entries(extra)) form.append(k, String(v));
  form.append(field, new Blob([buffer]), filename);
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    body: form,
  });
  return r.json();
}

async function tgMsg(chatId, text, extra = {}) {
  return tgCall('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', ...extra });
}

async function handleTgMessage(msg) {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = (msg.text || '').trim();

  if (!TG_ALLOWED.includes(userId)) {
    await tgMsg(chatId,
      `⛔ Không có quyền.\n\nUser ID của bạn: \`${userId}\`\nGửi ID này cho admin để được thêm vào whitelist.`);
    return;
  }

  if (text === '/start' || text === '/help' || text === '') {
    await tgMsg(chatId,
      `🛡️ *VPN Bot*\n\n` +
      `/new \`[tên]\` — tạo VPN mới (vd: /new phone)\n` +
      `/list — liệt kê các VPN đang có\n` +
      `/revoke \`[số]\` — xoá VPN theo số thứ tự trong /list\n` +
      `/whoami — xem user ID của bạn`);
    return;
  }

  if (text === '/whoami') {
    await tgMsg(chatId, `User ID: \`${userId}\``);
    return;
  }

  if (text.startsWith('/new')) {
    const name = text.split(/\s+/)[1] || 'device';
    try {
      const c = await createClient(name);
      await tgSendFile('sendPhoto', chatId, 'photo', c.qrBuffer, 'qr.png', {
        caption: `✅ *${c.name}*\nIP: \`10.8.0.${c.ip}\`\n\nMở app WireGuard → + → Scan QR`,
        parse_mode: 'Markdown',
      });
      await tgSendFile('sendDocument', chatId, 'document',
        Buffer.from(c.config, 'utf8'), `${c.name}.conf`);
    } catch (e) {
      await tgMsg(chatId, `❌ Lỗi: ${e.message}`);
    }
    return;
  }

  if (text === '/list') {
    const db = readDb();
    if (!db.clients.length) {
      await tgMsg(chatId, 'Chưa có client nào.');
      return;
    }
    const lines = db.clients.map((c, i) =>
      `${i + 1}. \`${c.name}\` — 10.8.0.${c.ip}`).join('\n');
    await tgMsg(chatId, `📋 *Clients (${db.clients.length}):*\n${lines}`);
    return;
  }

  if (text.startsWith('/revoke')) {
    const idx = parseInt(text.split(/\s+/)[1], 10) - 1;
    const db = readDb();
    if (isNaN(idx) || idx < 0 || idx >= db.clients.length) {
      await tgMsg(chatId, 'Cú pháp: `/revoke <số>` (lấy số từ /list)');
      return;
    }
    const removed = db.clients.splice(idx, 1)[0];
    writeDb(db);
    reloadWg();
    await tgMsg(chatId, `🗑 Đã xoá: \`${removed.name}\``);
    return;
  }

  await tgMsg(chatId, 'Không hiểu lệnh. Gõ /help để xem danh sách.');
}

async function startTelegramBot() {
  console.log(`Telegram bot started, whitelist: [${TG_ALLOWED.join(', ') || '(none)'}]`);
  let offset = 0;
  while (true) {
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=30`);
      const data = await r.json();
      if (data.ok && data.result.length) {
        for (const upd of data.result) {
          offset = upd.update_id + 1;
          if (upd.message) {
            handleTgMessage(upd.message).catch(e => console.error('TG handler:', e));
          }
        }
      }
    } catch (e) {
      console.error('TG poll error:', e.message);
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

if (TG_TOKEN) {
  startTelegramBot();
} else {
  console.log('TELEGRAM_BOT_TOKEN not set — bot disabled');
}
