import { Client, LocalAuth } from 'whatsapp-web.js';
import * as dotenv from 'dotenv';
import express from 'express';
import * as http from 'http';
const { Server } = require('socket.io');
import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';
import { initDatabase } from './db/database';
import { processarMensagem } from './bot';
import { enfileirar } from './queue';
import { resetarInicioBot } from './humanizer';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Estado inicial do Bot
let botStatus = 'desligado'; 
let lastQr = '';
let isBotRunning = false; 

// --- PAINEL DE CONTROLE (HTML) ---
app.get('/', (req, res) => {
    
    let ledClass = 'led-desligado';
    if (botStatus === 'online' || botStatus === 'autenticado') ledClass = 'led-online';
    else if (botStatus === 'aguardando_qr' || botStatus === 'iniciando') ledClass = 'led-iniciando';

    let qrContent = '';
    if (botStatus === 'desligado') {
        qrContent = '<p>💤 O robô está dormindo.<br><small>Clique em Ligar Bot para gerar o QR Code.</small></p>';
    } else if (botStatus === 'iniciando') {
        qrContent = '<p>⚙️ Iniciando o navegador invisível...<br><small>Aguarde um momento.</small></p>';
    } else if (botStatus === 'aguardando_qr') {
        qrContent = lastQr ? `<img src="${lastQr}" />` : '<p>⏳ Desenhando o QR Code...</p>';
    } else if (botStatus === 'online' || botStatus === 'autenticado') {
        qrContent = `
            <div style="color: #155724;">
                <h1 style="font-size: 3em; margin: 0;">📱</h1>
                <h3 style="margin-top: 10px;">WhatsApp Conectado!</h3>
                <p>O GessoBot está online e operando.</p>
            </div>
        `;
    } else {
        qrContent = '<p style="color: red;">⚠️ Sistema Desconectado.</p>';
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>M.S.E - GessoBot Panel</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: sans-serif; text-align: center; padding: 20px; background: #f4f4f9; color: #333; }
                .card { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); display: inline-block; max-width: 400px; width: 100%; }
                #qr-container { margin: 20px 0; min-height: 250px; display: flex; align-items: center; justify-content: center; border: 2px dashed #ddd; border-radius: 10px; background: #fafafa; }
                #qr-container img { max-width: 100%; height: auto; }
                .status-container { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 20px; font-weight: bold; background: #eee; padding: 8px 15px; border-radius: 20px; width: fit-content; margin: 0 auto; text-transform: uppercase; font-size: 0.85em;}
                .led { width: 14px; height: 14px; border-radius: 50%; display: inline-block; box-shadow: 0 0 5px rgba(0,0,0,0.2); }
                .led-online { background-color: #28a745; box-shadow: 0 0 12px #28a745; }
                .led-desligado { background-color: #dc3545; box-shadow: 0 0 12px #dc3545; }
                .led-iniciando { background-color: #ffc107; box-shadow: 0 0 12px #ffc107; }
                .btn-container { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
                button { border: none; padding: 12px 25px; border-radius: 5px; cursor: pointer; font-weight: bold; transition: 0.3s; font-size: 1em; }
                .btn-start { background: #28a745; color: white; }
                .btn-start:hover { background: #218838; }
                .btn-reset { background: #ff4747; color: white; }
                .btn-reset:hover { background: #d43f3f; }
                footer { margin-top: 20px; font-size: 0.8em; color: #888; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>🛠️ GessoBot v2.0</h2>
                <div class="status-container">
                    <div class="led ${ledClass}"></div>
                    <span id="status">${botStatus}</span>
                </div>
                <div id="qr-container">
                    ${qrContent}
                </div>
                <div class="btn-container">
                    ${botStatus === 'desligado' ? '<button class="btn-start" onclick="location.href=\'/start-bot\'">Ligar Bot (Ignição) 🚀</button>' : ''}
                    <button class="btn-reset" onclick="confirmReset()">Resetar Conexão (Gerar novo QR) 🔄</button>
                </div>
            </div>
            <footer>Marcos Software Engineer © 2026</footer>
            <script>
                function confirmReset() {
                    if(confirm("Isso vai desconectar o WhatsApp atual e gerar um novo QR Code. Deseja continuar?")) {
                        location.href = '/reset-auth';
                    }
                }
                setTimeout(() => { location.reload(); }, 3000);
            </script>
        </body>
        </html>
    `);
});

// --- ROTA DE IGNIÇÃO E RESET ---
app.get('/start-bot', (req, res) => {
    if (!isBotRunning) iniciarBot(); 
    res.redirect('/'); 
});

app.get('/reset-auth', (req, res) => {
    const sessionPath = path.join(__dirname, '../.wwebjs_auth');
    try {
        if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
        res.send(`
            <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #f4f4f9;">
                <h1 style="color: #ff9800;">🔄 Resetando o Sistema...</h1>
                <p>A sessão antiga foi limpa com sucesso.</p>
                <script>setTimeout(() => { window.location.href = '/start-bot'; }, 6000);</script>
            </body>
        `);
        setTimeout(() => process.exit(1), 2000); 
    } catch (err) { res.status(500).send('Erro ao resetar: ' + err); }
});

server.listen(PORT, () => { console.log(`🌐 Painel GessoBot rodando em http://localhost:${PORT}`); });

async function criarCliente(): Promise<Client> {
    return new Client({
        authStrategy: new LocalAuth({ clientId: 'gessobot' }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-gpu', '--no-first-run', '--no-zygote', '--single-process'],
        },
    });
}

async function iniciarBot(): Promise<void> {
    isBotRunning = true;
    botStatus = 'iniciando';
    await initDatabase();
    resetarInicioBot();

    const client = await criarCliente();

    client.on('qr', async (qr) => {
        botStatus = 'aguardando_qr';
        const qrImage = await QRCode.toDataURL(qr);
        lastQr = qrImage; 
    });

    client.on('authenticated', () => { botStatus = 'autenticado'; lastQr = ''; });
    client.on('ready', () => { botStatus = 'online'; });
    
    client.on('message', async (msg) => {
        try { await enfileirar(client, msg, processarMensagem); } 
        catch (err) { console.error('❌ Erro na fila:', err); }
    });

    client.on('disconnected', () => { botStatus = 'desconectado'; lastQr = ''; isBotRunning = false; setTimeout(() => process.exit(1), 5000); });
    
    try { await client.initialize(); } 
    catch (err) { isBotRunning = false; setTimeout(() => process.exit(1), 10000); }
}

