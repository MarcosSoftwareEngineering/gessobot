import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import * as dotenv from 'dotenv';
import express from 'express';
import * as http from 'http';
const { Server } = require('socket.io');
import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';

// Suas importações internas
import { initDatabase } from './db/database';
import { processarMensagem } from './bot';
import { enfileirar } from './queue';
import { resetarInicioBot } from './humanizer';

dotenv.config();

process.on('uncaughtException', (err) => {
    console.error('🚨 ERRO FATAL CAPTURADO:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('🚨 PROMISE REJEITADA:', reason);
});

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

let botStatus = 'desligado';
let lastQr = '';
let isBotRunning = false;
let clienteAtual: any = null;

// ==========================================
// ✅ KEEP-ALIVE INTERNO
// ==========================================
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
    http.get(`${BASE_URL}/ping`, (res) => {
        console.log(`🏓 Keep-alive interno: ${res.statusCode}`);
    }).on('error', (err) => console.warn('⚠️ Keep-alive falhou:', err.message));
}, 10 * 60 * 1000);
app.get('/ping', (_req, res) => res.send('pong'));

// ==========================================
// 🚫 ANTI-BAN (Adaptado para Baileys)
// ==========================================
function mensagemPermitida(remoteJid: string | null | undefined): boolean {
    if (!remoteJid) return false;
    if (remoteJid.endsWith('@g.us')) return false;
    if (remoteJid.includes('@newsletter')) return false;
    if (remoteJid.includes('@broadcast')) return false;
    return true;
}

// --- PAINEL DE CONTROLE ---
app.get('/', (req, res) => {
    let ledClass = 'led-desligado';
    if (botStatus === 'online') ledClass = 'led-online';
    else if (['aguardando_qr', 'iniciando', 'reconectando'].includes(botStatus)) ledClass = 'led-iniciando';

    let qrContent = '';
    if (botStatus === 'desligado') qrContent = '<p>💤 O robô está dormindo.<br><small>Clique em Ligar Bot.</small></p>';
    else if (botStatus === 'iniciando') qrContent = '<p>⚙️ Iniciando o motor Baileys (ultra-leve)...</p>';
    else if (botStatus === 'aguardando_qr') qrContent = lastQr 
        ? `<div><img src="${lastQr}" /><p style="color:#856404;font-size:0.85em">⚠️ Escaneie o QR Code.</p></div>` 
        : '<p>⏳ Desenhando QR Code...</p>';
    else if (botStatus === 'online') qrContent = `<div style="color:#155724"><h1 style="font-size:3em;margin:0">📱</h1><h3>Conectado!</h3></div>`;
    else qrContent = '<p style="color:red">⚠️ Desconectado.</p>';

    res.send(`
        <!DOCTYPE html>
        <html><head><title>M.S.E - GessoBot Panel</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: sans-serif; text-align: center; padding: 20px; background: #f4f4f9; }
            .card { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); display: inline-block; max-width: 400px; width: 100%; }
            #qr-container { margin: 20px 0; min-height: 250px; display: flex; align-items: center; justify-content: center; border: 2px dashed #ddd; border-radius: 10px; background: #fafafa; flex-direction: column; }
            #qr-container img { max-width: 100%; }
            .status-container { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 20px; font-weight: bold; background: #eee; padding: 8px 15px; border-radius: 20px; text-transform: uppercase; font-size: 0.85em; }
            .led { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
            .led-online { background-color: #28a745; box-shadow: 0 0 12px #28a745; }
            .led-desligado { background-color: #dc3545; box-shadow: 0 0 12px #dc3545; }
            .led-iniciando { background-color: #ffc107; box-shadow: 0 0 12px #ffc107; }
            .btn-container { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
            button { border: none; padding: 12px 25px; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 1em; }
            .btn-start { background: #28a745; color: white; }
            .btn-reset { background: #ff4747; color: white; }
            .badge { display: inline-block; background: #007bff; color: white; font-size: 0.7em; padding: 2px 8px; border-radius: 20px; margin-left: 8px; vertical-align: middle; }
        </style></head><body>
            <div class="card">
                <h2>🛠️ Marcos Software Engineer <br> GessoBot v3.0 <span class="badge">🚀 Motor Baileys</span></h2>
                <div class="status-container"><div class="led ${ledClass}"></div><span>${botStatus}</span></div>
                <div id="qr-container">${qrContent}</div>
                <div class="btn-container">
                    ${botStatus === 'desligado' ? '<button class="btn-start" onclick="location.href=\'/start-bot\'">Ligar Bot 🚀</button>' : ''}
                    <button class="btn-reset" onclick="if(confirm('Resetar sessão?')) location.href='/reset-auth';">Resetar Conexão 🔄</button>
                </div>
            </div>
            <script>setTimeout(() => { location.reload(); }, 4000);</script>
        </body></html>
    `);
});

app.get('/start-bot', (req, res) => {
    if (!isBotRunning) iniciarBot();
    res.redirect('/');
});

app.get('/reset-auth', (req, res) => {
    const sessionPath = path.join(__dirname, '../baileys_auth_info');
    try {
        if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
        res.send(`<body style="text-align:center;padding:50px"><h1>🔄 Resetando Baileys...</h1><script>setTimeout(()=>{window.location.href='/start-bot'},3000)</script></body>`);
        setTimeout(() => process.exit(1), 1000);
    } catch (err) { res.status(500).send('Erro: ' + err); }
});

server.listen(PORT as number, '0.0.0.0', () => {
    console.log(`🌐 Painel GessoBot (Baileys) rodando na porta ${PORT}!`);
});

// ==========================================
// 🚀 INICIALIZAÇÃO BAILEYS (MOTOR ULTRA-LEVE)
// ==========================================
async function iniciarBot() {
    isBotRunning = true;
    botStatus = 'iniciando';

    try { await initDatabase(); } catch(e) { console.error('Erro no DB:', e); }
    resetarInicioBot();

    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), // Remove logs excessivos
        browser: ['GessoBot (Marcos SE)', 'Chrome', '1.0.0']
    });

    clienteAtual = sock;

    // Salva credenciais automaticamente
    sock.ev.on('creds.update', saveCreds);

    // Gerencia a conexão e o QR Code
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            botStatus = 'aguardando_qr';
            lastQr = await QRCode.toDataURL(qr);
            console.log('📱 Novo QR Code gerado pelo Baileys!');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexão fechada. Reconectar?', shouldReconnect);
            
            if (shouldReconnect) {
                botStatus = 'reconectando';
                setTimeout(iniciarBot, 5000); // Tenta reconectar em 5s
            } else {
                botStatus = 'desconectado';
                isBotRunning = false;
                console.log('🗑️ Deslogado. A sessão foi limpa.');
                const sessionPath = path.join(__dirname, '../baileys_auth_info');
                if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        } else if (connection === 'open') {
            botStatus = 'online';
            lastQr = '';
            console.log('🚀 ONLINE! Motor Baileys conectado com sucesso (Usando < 50MB de RAM).');
        }
    });

    // Escuta novas mensagens
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return; // Ignora mensagens de histórico antigo
        
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return; // Ignora as próprias mensagens

        const remoteJid = msg.key.remoteJid;
        if (!mensagemPermitida(remoteJid)) return;

        console.log(`📩 Nova mensagem recebida de: ${remoteJid}`);
        
        // ⚠️ ATENÇÃO: Deixei comentado de propósito para o VS Code não gritar erro agora.
        // try { await enfileirar(sock, msg, processarMensagem); }
        // catch (err) { console.error('❌ Erro na fila:', err); }
    });
}