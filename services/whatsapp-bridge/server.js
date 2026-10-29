'use strict';

/**
 * Studio 85 — Ponte de WhatsApp (Baileys)
 *
 * Baseada no bot do projeto Agenda (mesmas rotas no estilo Evolution API), com correções:
 * - chaves só por variável de ambiente (nenhum segredo no código);
 * - webhook para a API assinado com segredo próprio (WEBHOOK_SECRET);
 * - fotos enviadas como imagem (com pré-visualização), não como documento;
 * - número conferido no WhatsApp (onWhatsApp), com e sem o nono dígito;
 * - nome de instância validado (evita gravar sessão fora da pasta);
 * - mensagens recebidas não são marcadas como lidas (o dono continua vendo no celular).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const PORT = Number(process.env.PORT || 3005);
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.API_KEY || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const AUTH_DIR_BASE = path.resolve(process.env.AUTH_DIR || path.join(__dirname, 'auth_info'));

if (API_KEY.length < 32) {
  console.error('Defina API_KEY com pelo menos 32 caracteres (mesmo valor de WHATSAPP_BRIDGE_TOKEN na API).');
  process.exit(1);
}
if (WEBHOOK_URL && WEBHOOK_SECRET.length < 32) {
  console.error('WEBHOOK_URL definido: defina também WEBHOOK_SECRET com pelo menos 32 caracteres.');
  process.exit(1);
}

fs.mkdirSync(AUTH_DIR_BASE, { recursive: true });

const INSTANCE_NAME = /^[a-z0-9][a-z0-9-]{2,39}$/;
const sessions = new Map(); // instanceName -> { sock, qrBase64, connected, phone }

const app = express();
app.use(express.json({ limit: '25mb' }));

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Autenticação das chamadas da API do Studio 85
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const key = req.headers['apikey'] || req.headers['x-api-key'];
  if (!safeEqual(key, API_KEY)) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.param('instanceName', (req, res, next, value) => {
  if (!INSTANCE_NAME.test(value)) return res.status(400).json({ error: 'Nome de instância inválido' });
  next();
});

async function notifyApi(event, instanceName, data) {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
      body: JSON.stringify({ event, instance: instanceName, data }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error(`[${instanceName}] Falha ao avisar a API (${event}):`, error.message);
  }
}

async function buildSession(instanceName) {
  if (sessions.has(instanceName)) return sessions.get(instanceName);

  const authDir = path.join(AUTH_DIR_BASE, instanceName);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  const session = { sock, qrBase64: null, connected: false, phone: null };
  sessions.set(instanceName, session);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      session.qrBase64 = await qrcode.toDataURL(qr).catch(() => null);
      notifyApi('connection.update', instanceName, { state: 'connecting' });
    }

    if (connection === 'open') {
      session.connected = true;
      session.qrBase64 = null;
      session.phone = (sock.user?.id || '').split(':')[0].split('@')[0] || null;
      console.log(`[${instanceName}] Conectado.`);
      notifyApi('connection.update', instanceName, { state: 'open', phone: session.phone });
    }

    if (connection === 'close') {
      session.connected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`[${instanceName}] Desconectado:`, DisconnectReason[statusCode] || statusCode);
      notifyApi('connection.update', instanceName, { state: 'close' });

      if (statusCode === DisconnectReason.loggedOut) {
        // Desconectado pelo celular: apaga a sessão para gerar um QR novo na próxima conexão
        fs.rmSync(authDir, { recursive: true, force: true });
        sessions.delete(instanceName);
      } else {
        setTimeout(() => {
          sessions.delete(instanceName);
          buildSession(instanceName).catch((err) => console.error(`[${instanceName}] Reconexão falhou:`, err.message));
        }, 3000);
      }
    }
  });

  return session;
}

/**
 * Descobre o JID real do número no WhatsApp, testando com e sem o nono dígito
 */
async function resolveJid(sock, number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 13) throw Object.assign(new Error('Número inválido'), { status: 400 });

  const candidates = [digits];
  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') candidates.push(digits.slice(0, 4) + digits.slice(5));
  if (digits.length === 12 && digits.startsWith('55')) candidates.push(digits.slice(0, 4) + '9' + digits.slice(4));

  for (const candidate of candidates) {
    const [result] = await sock.onWhatsApp(`${candidate}@s.whatsapp.net`);
    if (result?.exists) return result.jid;
  }
  throw Object.assign(new Error('Este número não tem WhatsApp'), { status: 422 });
}

function connectedSession(instanceName, res) {
  const session = sessions.get(instanceName);
  if (!session || !session.connected) {
    res.status(409).json({ error: 'WhatsApp não conectado' });
    return null;
  }
  return session;
}

async function restoreSessions() {
  for (const entry of fs.readdirSync(AUTH_DIR_BASE)) {
    if (!INSTANCE_NAME.test(entry) || !fs.lstatSync(path.join(AUTH_DIR_BASE, entry)).isDirectory()) continue;
    console.log(`[startup] Restaurando sessão: ${entry}`);
    await buildSession(entry).catch((err) => console.error(`[${entry}] Falha ao restaurar:`, err.message));
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---------------------------------------------------------------------------
// Rotas (compatíveis com o padrão Evolution API usado no projeto Agenda)
// ---------------------------------------------------------------------------

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/instance/create', async (req, res) => {
  const { instanceName } = req.body || {};
  if (!INSTANCE_NAME.test(instanceName || '')) return res.status(400).json({ error: 'Nome de instância inválido' });

  const existing = sessions.get(instanceName);
  const session = existing || (await buildSession(instanceName));

  // Espera até 10 s pelo QR para devolver na mesma resposta
  for (let waited = 0; !session.qrBase64 && !session.connected && waited < 10000; waited += 500) {
    await new Promise((r) => setTimeout(r, 500));
  }

  res.json({
    instance: { instanceName, status: existing ? 'already_exists' : 'created', state: session.connected ? 'open' : 'close' },
    qrcode: { base64: session.qrBase64 },
  });
});

app.get('/instance/connect/:instanceName', (req, res) => {
  const session = sessions.get(req.params.instanceName);
  if (!session) return res.status(404).json({ error: 'Instância não encontrada' });
  res.json({ base64: session.qrBase64, state: session.connected ? 'open' : session.qrBase64 ? 'connecting' : 'close' });
});

app.get('/instance/connectionState/:instanceName', (req, res) => {
  const session = sessions.get(req.params.instanceName);
  res.json({
    instance: {
      instanceName: req.params.instanceName,
      state: session?.connected ? 'open' : session?.qrBase64 ? 'connecting' : 'close',
      phone: session?.connected ? session.phone : null,
    },
  });
});

app.delete('/instance/delete/:instanceName', async (req, res) => {
  const { instanceName } = req.params;
  const session = sessions.get(instanceName);
  sessions.delete(instanceName);
  if (session) {
    try {
      await session.sock.logout();
    } catch {
      // já desconectado
    }
  }
  fs.rmSync(path.join(AUTH_DIR_BASE, instanceName), { recursive: true, force: true });
  res.json({ status: 'deleted' });
});

app.post('/message/sendText/:instanceName', async (req, res) => {
  const session = connectedSession(req.params.instanceName, res);
  if (!session) return;
  try {
    const { number, text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Texto obrigatório' });
    const jid = await resolveJid(session.sock, number);
    const result = await session.sock.sendMessage(jid, { text });
    res.json({ id: result?.key?.id ?? null, jid });
  } catch (error) {
    console.error(`[${req.params.instanceName}] Erro ao enviar texto:`, error.message);
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/message/sendMedia/:instanceName', async (req, res) => {
  const session = connectedSession(req.params.instanceName, res);
  if (!session) return;
  try {
    const { number, media, mediatype = 'image', mimetype, fileName, caption } = req.body || {};
    if (!media) return res.status(400).json({ error: 'Mídia obrigatória' });

    const buffer = Buffer.from(String(media).split(';base64,').pop(), 'base64');
    const jid = await resolveJid(session.sock, number);

    let content;
    if (mediatype === 'image') content = { image: buffer, mimetype: mimetype || 'image/jpeg', caption };
    else if (mediatype === 'video') content = { video: buffer, mimetype: mimetype || 'video/mp4', caption };
    else content = { document: buffer, mimetype: mimetype || 'application/pdf', fileName: fileName || 'arquivo', caption };

    const result = await session.sock.sendMessage(jid, content);
    res.json({ id: result?.key?.id ?? null, jid });
  } catch (error) {
    console.error(`[${req.params.instanceName}] Erro ao enviar mídia:`, error.message);
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.listen(PORT, HOST, async () => {
  console.log(`Studio 85 WhatsApp bridge em http://${HOST}:${PORT}`);
  await restoreSessions();
});
