const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid'); // npm install uuid

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const KEY_VALIDITY_MS = 24 * 60 * 60 * 1000;
const keysDB = {};
const ipLastGeneration = {};

const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1388339011554119733/QOb0ZjK1K4up3sagGToUwXaCREUx29GgZ3GsmaEBYsHF463u_qxoHQRklK_WrlaD4wl-';

function generateKey() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function cleanupKeys() {
  const now = Date.now();
  for (const key in keysDB) {
    if (keysDB[key].expiresAt < now) delete keysDB[key];
  }
  for (const ip in ipLastGeneration) {
    if (now - ipLastGeneration[ip] > KEY_VALIDITY_MS) delete ipLastGeneration[ip];
  }
}

function getClientIp(req) {
  // Se houver proxy, pegue o real IP
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  if (ip.includes(',')) ip = ip.split(',')[0].trim(); // pegar o primeiro IP
  if (ip.startsWith('::ffff:')) ip = ip.substring(7); // IPv4 mapeado em IPv6
  return ip;
}

async function sendWebhookLog(req, user, key, ip) {
  if (!DISCORD_WEBHOOK_URL) return;

  const nowISO = new Date().toISOString();
  const localTime = new Date().toLocaleString('pt-BR', { timeZoneName: 'short' });
  const uniqueId = uuidv4();

  const userAgent = req.headers['user-agent'] || 'Desconhecido';

  const content = {
    username: 'Sistema de Keys',
    avatar_url: 'https://i.imgur.com/FYwK6Xh.png',
    embeds: [
      {
        title: '🗝️ Nova Key Gerada',
        color: 0x1abc9c,
        fields: [
          { name: 'ID Único', value: uniqueId, inline: false },
          { name: 'Usuário', value: user, inline: true },
          { name: 'Key', value: key, inline: true },
          { name: 'IP', value: ip, inline: false },
          { name: 'User-Agent', value: `\`\`\`${userAgent}\`\`\``, inline: false },
          { name: 'Data (ISO)', value: nowISO, inline: true },
          { name: 'Data Local', value: localTime, inline: true },
        ],
        footer: { text: 'Sistema de Keys 24h' },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    });
  } catch (err) {
    console.error('Erro ao enviar webhook:', err);
  }
}

app.post('/generate-key', async (req, res) => {
  const { user } = req.body;
  if (!user || typeof user !== 'string' || user.trim().length < 3) {
    return res.status(400).json({ error: 'Nome de usuário inválido (mínimo 3 caracteres).' });
  }

  cleanupKeys();

  const ip = getClientIp(req);
  const now = Date.now();

  if (ipLastGeneration[ip] && (now - ipLastGeneration[ip] < KEY_VALIDITY_MS)) {
    const nextAvailable = new Date(ipLastGeneration[ip] + KEY_VALIDITY_MS);
    return res.status(429).json({
      error: `Você só pode gerar 1 key a cada 24 horas. Tente novamente em ${nextAvailable.toLocaleString()}`,
    });
  }

  const key = generateKey();
  const expiresAt = now + KEY_VALIDITY_MS;

  keysDB[key] = {
    user: user.trim(),
    expiresAt,
  };

  ipLastGeneration[ip] = now;

  await sendWebhookLog(req, user.trim(), key, ip);

  res.json({ key, expiresAt });
});

app.post('/validate-key', (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Key é obrigatória.' });
  }

  cleanupKeys();

  const record = keysDB[key.toUpperCase()];
  if (record) {
    return res.json({
      valid: true,
      user: record.user,
      expiresAt: record.expiresAt,
    });
  } else {
    return res.json({ valid: false });
  }
});

app.get('/keys', (req, res) => {
  cleanupKeys();
  res.json(keysDB);
});

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});