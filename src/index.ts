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

// ==========================================
// --- PAINEL DE CONTROLE M.S.E ---
// ==========================================
app.get('/', (req, res) => {
    // Configura os textos dinâmicos do status
    let statusTextLabel = 'DESLIGADO';
    let ledColor = '#dc2626'; // Vermelho
    let qrContent = '<p>💤 O robô está dormindo.<br><small>Clique em Ligar Bot.</small></p>';
    let actionButtons = '';

    if (botStatus === 'online') {
        statusTextLabel = 'CONECTADO';
        ledColor = '#16a34a'; // Verde
        qrContent = `<div style="color:#155724"><h1 style="font-size:3em;margin:0">📱</h1><h3>Conectado!</h3></div>`;
    } else if (botStatus === 'aguardando_qr') {
        statusTextLabel = 'AGUARDANDO QR';
        ledColor = '#eab308'; // Amarelo
        qrContent = lastQr 
            ? `<div><img src="${lastQr}" style="border-radius:10px; max-width:200px;"/><p style="color:#856404;font-size:0.85rem">⚠️ Escaneie o QR Code.</p></div>` 
            : '<p>⏳ Desenhando QR Code...</p>';
    } else if (botStatus === 'iniciando') {
        statusTextLabel = 'INICIANDO MOTOR';
        ledColor = '#eab308'; // Amarelo
        qrContent = '<p>⚙️ Iniciando o motor Baileys (ultra-leve)...</p>';
    } else if (botStatus === 'reconectando') {
        statusTextLabel = 'RECONECTANDO';
        ledColor = '#eab308'; // Amarelo
        qrContent = '<p>🔄 Tentando reconectar ao WhatsApp...</p>';
    }

    if (botStatus === 'desligado' || !isBotRunning) {
        actionButtons += `<button class="btn btn-ligar" onclick="location.href='/start-bot'">Ligar Bot 🚀</button>`;
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>M.S.E - Painel GessoBot</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
                /* Fundo usando paleta azul corporativo M.S.E */
                body { background: radial-gradient(circle at center, #1e3a8a 0%, #0f172a 100%); min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #333; }
                .painel-card { background-color: #ffffff; width: 90%; max-width: 480px; border-radius: 16px; padding: 24px; box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4); z-index: 10; margin-top: 20px;}
                .header { margin-bottom: 20px; }
                .header-title { font-size: 1.1rem; color: #1e293b; font-weight: 600; margin-bottom: 4px; }
                .header-subtitle { font-size: 1.4rem; color: #0f172a; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
                .badges { display: flex; gap: 10px; margin-top: 8px; font-size: 0.8rem; font-weight: 600; }
                .badge-green { background-color: #dcfce7; color: #166534; padding: 4px 10px; border-radius: 20px; border: 1px solid #bbf7d0; font-size: 0.8rem;}
                .badge-blue { background-color: #e0f2fe; color: #075985; padding: 4px 10px; border-radius: 20px; border: 1px solid #bae6fd; }
                .version-text { font-size: 0.85rem; color: #64748b; margin-top: 8px; }
                .status-bar { background-color: #1e293b; border-radius: 10px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
                .status-label { color: #f8fafc; font-weight: bold; font-size: 0.95rem; letter-spacing: 0.5px; }
                .status-indicator { background-color: #334155; padding: 6px 14px; border-radius: 20px; color: #f8fafc; font-size: 0.85rem; font-weight: bold; display: flex; align-items: center; gap: 8px; }
                .dot { width: 10px; height: 10px; background-color: ${ledColor}; border-radius: 50%; box-shadow: 0 0 8px ${ledColor}; }
                ${ledColor === '#eab308' ? `.dot { animation: pulse 1.5s infinite; } @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0.7); } 70% { box-shadow: 0 0 0 6px rgba(234, 179, 8, 0); } 100% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0); } }` : ''}
                .qr-area { background-color: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 30px 20px; text-align: center; margin-bottom: 20px; min-height: 160px; display: flex; flex-direction: column; justify-content: center; align-items: center; }
                .qr-area p { color: #475569; font-size: 0.95rem; font-weight: 500; margin-bottom: 5px; }
                .qr-area small { color: #64748b; font-size: 0.8rem; }
                .button-group { display: flex; gap: 12px; flex-direction: column;}
                .btn { padding: 14px; border: none; border-radius: 8px; font-size: 1rem; font-weight: bold; cursor: pointer; transition: transform 0.1s, opacity 0.2s; display: flex; justify-content: center; align-items: center; gap: 8px; width: 100%;}
                .btn:active { transform: scale(0.97); }
                .btn-ligar { background-color: #1d4ed8; color: white; box-shadow: 0 4px 12px rgba(29, 78, 216, 0.3); }
                .btn-ligar:hover { background-color: #1e40af; }
                .btn-reset { background-color: #dc2626; color: white; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3); }
                .btn-reset:hover { background-color: #b91c1c; }
                .footer-text { margin-top: 20px; color: #cbd5e1; font-size: 0.8rem; opacity: 0.8; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <div class="painel-card">
                <div class="header">
                    <div class="header-title">M.S.E (Marcos Software Engineer)</div>
                    <div class="header-subtitle">
                        PAINEL GESSOBOT
                        <span class="badge-green">🛡️ Anti-Ban</span>
                    </div>
                    <div class="version-text">Bot Pro v3.0 | Status: ${botStatus}</div>
                    <div class="badges">
                        <span class="badge-blue">🚀 Motor Baileys</span>
                    </div>
                </div>

                <div class="status-bar">
                    <span class="status-label">STATUS:</span>
                    <div class="status-indicator">
                        <div class="dot"></div>
                        <span>${statusTextLabel}</span>
                    </div>
                </div>

                <div class="qr-area">
                    ${qrContent}
                </div>

                <div class="button-group">
                    ${actionButtons}
                    <button class="btn btn-reset" onclick="if(confirm('Resetar sessão?')) location.href='/reset-auth';">Resetar Conexão 🔄</button>
                </div>
            </div>

            <div class="footer-text">
                © M.S.E - Marcos Software Engineer 2026
            </div>
            
            <script>
                if('${botStatus}' !== 'online'){
                    setTimeout(() => { location.reload(); }, 4000);
                }
            </script>
        </body>
        </html>
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
        res.send(`<body style="text-align:center;padding:50px;font-family:sans-serif;background:#f4f4f9;"><h1>🔄 Resetando Baileys...</h1><script>setTimeout(()=>{window.location.href='/start-bot'},3000)</script></body>`);
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
        logger: pino({ level: 'silent' }),
        browser: ['GessoBot (Marcos SE)', 'Chrome', '1.0.0']
    });

    clienteAtual = sock;

    sock.ev.on('creds.update', saveCreds);

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
                setTimeout(iniciarBot, 5000);
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

    // ✅ Escuta e processa novas mensagens
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        if (!mensagemPermitida(remoteJid)) return;

        console.log(`📩 Nova mensagem recebida de: ${remoteJid}`);
        
        try { await enfileirar(sock, msg, processarMensagem); }
        catch (err) { console.error('❌ Erro na fila:', err); }
    });
}