import makeWASocket, { useMultiFileAuthState, DisconnectReason, proto, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
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
import { aplicarFiltros } from './filtros';

dotenv.config();

const app = express();
app.use(express.json());
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

let botStatus: 'desligado' | 'iniciando' | 'aguardando_qr' | 'online' | 'desconectado' = 'desligado';
let lastQr: string = '';
let isBotRunning: boolean = false;
let clienteAtual: any = null;

const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
    const requestModule = BASE_URL.startsWith('https') ? https : http;
    requestModule.get(`${BASE_URL}/ping`, () => {}).on('error', () => {});
}, 10 * 60 * 1000);

app.get('/ping', (_req, res) => res.send('pong'));

app.get('/', (req, res) => {
    let autoRefresh = '';
    if (botStatus === 'iniciando') autoRefresh = '<meta http-equiv="refresh" content="3">';
    else if (botStatus === 'aguardando_qr') autoRefresh = '<meta http-equiv="refresh" content="10">';

    let corStatus = botStatus === 'online' ? '#22c55e' : botStatus === 'aguardando_qr' ? '#eab308' : '#ef4444';
    let htmlContainer = botStatus === 'iniciando' ? `<p class="qr-text">⚙️ Inicializando motor...</p>` : 
                        (botStatus === 'aguardando_qr' && lastQr) ? `<img src="${lastQr}" width="220"><p class="qr-text">Escaneie o QR Code!</p>` :
                        botStatus === 'online' ? `<p class="qr-text" style="color: #16a34a; font-weight: bold;">✅ Robô conectado!</p>` :
                        `<p class="qr-text">💤 O robô está dormindo.</p>`;

    res.send(`<!DOCTYPE html><html><head><style>body{background:#1e3a8a;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;}.card{background:white;padding:24px;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,0.5);text-align:center;}</style></head><body><div class="card"><h2>PAINEL GESSOBOT</h2><div style="background:${corStatus};color:white;padding:10px;border-radius:20px;display:inline-block;margin-bottom:20px;">${botStatus.toUpperCase()}</div><div class="qr-container">${htmlContainer}</div><button onclick="location.href='/start-bot'">Ligar Bot 🚀</button> <button onclick="location.href='/reset'">Resetar 🔄</button></div></body></html>`);
});

app.get('/start-bot', (req, res) => { if (!isBotRunning) iniciarBot(); res.redirect('/'); });

app.get('/reset', (req, res) => {
    if (clienteAtual) { clienteAtual.ev.removeAllListeners(); clienteAtual.end(); clienteAtual = null; }
    isBotRunning = false; botStatus = 'desligado'; lastQr = '';
    const authFolder = path.resolve(__dirname, '../baileys_auth_info');
    if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true });
    res.redirect('/');
});

async function iniciarBot() {
    isBotRunning = true;
    botStatus = 'iniciando';

    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    
    // ✅ BUSCA DINÂMICA DE VERSÃO (Essencial contra erro 515)
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version, // Sincroniza o bot com a versão atual da Meta
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }), 
        browser: ['GessoBot M.S.E', 'Chrome', '3.0.0'], 
        syncFullHistory: false,
        markOnlineOnConnect: true,
        keepAliveIntervalMs: 20000,
        connectTimeoutMs: 60000,
        getMessage: async () => ({ conversation: 'Olá' })
    });

    clienteAtual = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) { botStatus = 'aguardando_qr'; lastQr = await QRCode.toDataURL(qr); }
        
        if (connection === 'close') {
            const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            
            if (shouldReconnect) {
                console.log(`[SISTEMA] Conexão caiu (Código: ${reason}). Reconectando...`);
                isBotRunning = false;
                setTimeout(iniciarBot, 5000);
            } else {
                botStatus = 'desconectado';
                isBotRunning = false;
            }
        } else if (connection === 'open') {
            console.log('[SISTEMA] GessoBot Conectado com Sucesso!');
            botStatus = 'online';
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (msg.key.fromMe) return;

        const filtro = await aplicarFiltros(msg, sock);
        if (filtro.bloqueado) return;

        try {
            await enfileirar(sock, msg, processarMensagem);
        } catch (err) {
            console.error('[ERRO] Falha ao processar:', err);
        }
    });
}

initDatabase()
    .then(() => {
        server.listen(PORT as number, '0.0.0.0', () => {
            console.log(`[SISTEMA] Rodando na porta ${PORT}`);
            iniciarBot();
        });
    })
    .catch((err) => console.error(err));