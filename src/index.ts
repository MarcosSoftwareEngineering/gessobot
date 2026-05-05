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
let isBotRunning = false; // Trava de segurança para não ligar 2 vezes

// --- PAINEL DE CONTROLE (HTML) ---
app.get('/', (req, res) => {
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
                .status-badge { padding: 5px 15px; border-radius: 20px; font-weight: bold; background: #eee; text-transform: uppercase; font-size: 0.9em; }
                
                /* Cores dos Status */
                .desligado { background: #e2e3e5; color: #383d41; }
                .online { background: #d4edda; color: #155724; }
                .aguardando_qr { background: #fff3cd; color: #856404; }
                
                /* Botões */
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
                <p>Status: <span id="status" class="status-badge ${botStatus}">${botStatus}</span></p>
                
                <div id="qr-container">
                    ${botStatus === 'desligado' 
                        ? '<p>💤 O robô está dormindo.<br><small>Clique em Ligar Bot para gerar o QR Code.</small></p>' 
                        : lastQr 
                            ? `<img src="${lastQr}" />` 
                            : '<p>⏳ Aguardando QR Code...<br><small>Isso pode levar 30s</small></p>'
                    }
                </div>

                <div class="btn-container">
                    ${botStatus === 'desligado' 
                        ? '<button class="btn-start" onclick="location.href=\'/start-bot\'">Ligar Bot (Ignição) 🚀</button>' 
                        : ''
                    }
                    <button class="btn-reset" onclick="confirmReset()">Apagar Sessão e Desligar 🛑</button>
                </div>
            </div>
            <footer>Marcos Software Engineer © 2026</footer>

            <script>
                function confirmReset() {
                    if(confirm("Deseja realmente apagar a sessão atual e desligar o bot?")) {
                        location.href = '/reset-auth';
                    }
                }
                // Atualiza a página automaticamente a cada 5 segundos para buscar novos status ou QR
                setTimeout(() => { location.reload(); }, 5000);
            </script>
        </body>
        </html>
    `);
});

// --- ROTA DE IGNIÇÃO (LIGAR BOT) ---
app.get('/start-bot', (req, res) => {
    if (!isBotRunning) {
        iniciarBot(); // Acorda o robô!
    }
    res.redirect('/'); // Volta para o painel instantaneamente
});

// --- ROTA DE RESET (APAGAR LOCALAUTH E DESLIGAR) ---
app.get('/reset-auth', (req, res) => {
    const sessionPath = path.join(__dirname, '../.wwebjs_auth');
    try {
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
        res.send(`
            <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #f4f4f9;">
                <h1 style="color: #28a745;">✅ Sessão Apagada!</h1>
                <p>O servidor está reiniciando e o bot foi desligado.</p>
                <p>Retornando ao painel em 5 segundos...</p>
                <script>
                    setTimeout(() => { window.location.href = '/'; }, 5000);
                </script>
            </body>
        `);
        
        // Finaliza o processo para o PM2 reiniciar limpo e com status "desligado"
        setTimeout(() => process.exit(1), 2000); 
    } catch (err) {
        res.status(500).send('Erro ao resetar: ' + err);
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Painel GessoBot rodando em http://localhost:${PORT}`);
});

async function criarCliente(): Promise<Client> {
    return new Client({
        authStrategy: new LocalAuth({ clientId: 'gessobot' }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ],
        },
    });
}

async function iniciarBot(): Promise<void> {
    isBotRunning = true;
    botStatus = 'iniciando';
    console.log('🔄 Iniciando GessoBot Engine via Ignição...');
    await initDatabase();
    resetarInicioBot();

    const client = await criarCliente();

    client.on('qr', async (qr) => {
        botStatus = 'aguardando_qr';
        const qrcodeTerminal = require('qrcode-terminal');
        qrcodeTerminal.generate(qr, { small: true });

        const qrImage = await QRCode.toDataURL(qr);
        lastQr = qrImage; 
        io.emit('qr', qrImage);
        io.emit('status', botStatus);
        console.log('📱 QR Code gerado e enviado para o painel.');
    });

    client.on('authenticated', () => {
        botStatus = 'autenticado';
        lastQr = ''; 
        io.emit('status', botStatus);
        console.log('✅ Autenticado!');
    });

    client.on('ready', () => {
        botStatus = 'online';
        io.emit('status', botStatus);
        console.log('🚀 GessoBot está ONLINE e pronto!');
    });

    client.on('message', async (msg) => {
        try {
            console.log(`📩 Mensagem de ${msg.from}: ${msg.body}`);
            await enfileirar(client, msg, processarMensagem);
        } catch (err) {
            console.error('❌ Erro na fila:', err);
        }
    });

    client.on('disconnected', (reason) => {
        botStatus = 'desconectado';
        lastQr = '';
        isBotRunning = false;
        io.emit('status', botStatus);
        console.log(`⚠️ Desconectado: ${reason}`);
        setTimeout(() => process.exit(1), 5000);
    });

    try {
        await client.initialize();
    } catch (err) {
        console.error('❌ Erro ao inicializar:', err);
        isBotRunning = false;
        setTimeout(() => process.exit(1), 10000);
    }
}