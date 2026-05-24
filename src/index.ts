import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import * as dotenv from 'dotenv';
import express from 'express';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';

import { initDatabase } from './db/database';
import { processarMensagem } from './bot';
import { enfileirar } from './queue';
import { resetarInicioBot } from './humanizer';

dotenv.config();

const app = express();
app.use(express.json());
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

let botStatus = 'desligado';
let lastQr = '';
let isBotRunning = false;
let clienteAtual: any = null;
let pairingCodeCache = '';

// ==========================================
// ✅ KEEP-ALIVE E ANTI-BAN
// ==========================================
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
    const requestModule = BASE_URL.startsWith('https') ? https : http;
    requestModule.get(`${BASE_URL}/ping`, (res) => {}).on('error', () => {});
}, 10 * 60 * 1000);

app.get('/ping', (_req, res) => res.send('pong'));

// ==========================================
// --- PAINEL M.S.E INTEGRADO ---
// ==========================================
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>Painel M.S.E GessoBot</title>
            <style>
                body { background: #0f172a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; }
                .card { background: #1e293b; padding: 20px; border-radius: 12px; text-align: center; width: 350px; }
                .btn { padding: 15px; border-radius: 8px; border: none; font-weight: bold; cursor: pointer; width: 100%; margin-top: 10px; }
                .btn-ligar { background: #1d4ed8; color: white; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>GessoBot v3.0</h1>
                <p>Status: ${botStatus}</p>
                <div id="qr-area">${lastQr ? `<img src="${lastQr}" width="200">` : (pairingCodeCache ? `<h3>Código: ${pairingCodeCache}</h3>` : 'Aguardando...')}</div>
                ${!isBotRunning ? '<button class="btn btn-ligar" onclick="location.href=\'/start-bot\'">Ligar Bot</button>' : ''}
            </div>
        </body>
        </html>
    `);
});

app.get('/start-bot', (req, res) => {
    if (!isBotRunning) iniciarBot();
    res.redirect('/');
});

async function iniciarBot() {
    isBotRunning = true;
    botStatus = 'iniciando';

    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
    });

    clienteAtual = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            botStatus = 'aguardando_qr';
            lastQr = await QRCode.toDataURL(qr);
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(iniciarBot, 5000);
            else { botStatus = 'desconectado'; isBotRunning = false; }
        } else if (connection === 'open') {
            botStatus = 'online';
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (msg.key.fromMe) return;
        try { await enfileirar(sock, msg, processarMensagem); } catch (err) {}
    });
}

server.listen(PORT as number, '0.0.0.0', () => console.log(`Rodando na porta ${PORT}`));