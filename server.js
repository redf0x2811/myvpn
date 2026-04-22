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

bootstrap();

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.post('/api/create', async (req, res) => {
  try {
    if (req.body.token !== PORTAL_TOKEN) {
      return res.status(401).json({ error: 'Sai access token' });
    }
    const rawName = String(req.body.name || 'device');
    const name = rawName.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 20) || 'device';

    const db = readDb();
    if (db.nextIp > 250) return res.status(400).json({ error: 'Het IP (>250 clients)' });

    const { priv, pub } = genKeypair();
    const ip = db.nextIp;
    db.nextIp = ip + 1;
    db.clients.push({ name: `${name}-${Date.now()}`, pub, ip, created: Date.now() });
    writeDb(db);

    const serverPub = fs.readFileSync(SERVER_PUB, 'utf8').trim();
    const clientConf = `[Interface]
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

    const qr = await QRCode.toDataURL(clientConf, { width: 400, margin: 1 });
    res.json({ qr, config: clientConf });
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
