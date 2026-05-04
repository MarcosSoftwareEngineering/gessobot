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

let botStatus = 'iniciando';
let lastQr = '';

// --- PAINEL DE CONTROLE (HTML) ---
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>M.S.E - GessoBot Panel</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            <style>
                body { background: #f4f7f6; font-family: sans-serif; }
                .card { border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
                #qrcode img { width: 256px; height: 256px; margin: 20px auto; display: block; border: 10px solid white; border-radius: 10px; }
                .status-online { color: #28a745; font-weight: bold; }
                .status-offline { color: #dc3545; font-weight: bold; }
            </style>
        </head>
        <body class="container py-5">
            <div class="row justify-content-center">
                <div class="col-md-6 text-center">
                    <div class="card p-4">
                        <h2 class="mb-4">🏗️ GessoBot v2.0</h2>
                        <div id="status-box" class="mb-3">Status: <span id="status" class="status-offline">Carregando...</span></div>
                        <div id="qrcode">
                            <p class="text-muted">Aguardando QR Code...</p>
                        </div>
                        <div class="mt-4">
                            <button onclick="resetAuth()" class="btn btn-danger w-100 mb-2">🗑️ Resetar LocalAuth (Apagar Sessão)</button>
                            <small class="text-muted">Use o reset se o QR Code não carregar ou se quiser trocar de número.</small>
                        </div>
                    </div>
                </div>
            </div>

            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                const statusEl = document.getElementById('status');
                const qrEl = document.getElementById('qrcode');

                socket.on('status', (s) => {
                    statusEl.innerText = s.toUpperCase();
                    statusEl.className = s === 'online' ? 'status-online' : 'status-offline';
                });

                socket.on('qr', (url) => {
                    qrEl.innerHTML = '<img src="' + url + '" />';
                });

                function resetAuth() {
                    if(confirm("Deseja realmente apagar a sessão? O bot será reiniciado.")) {
                        window.location.href = '/reset-auth';
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// --- ROTA DE RESET (APAGAR LOCALAUTH) ---
app.get('/reset-auth', (req, res) => {
    const sessionPath = path.join(__dirname, '../.wwebjs_auth');
    try {
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
        res.send('<h1>Sessão Apagada!</h1><p>O servidor está reiniciando... Volte para a <a href="/">Página Inicial</a> em 10 segundos.</p>');
        setTimeout(() => process.exit(1), 2000); // PM2 vai reiniciar o bot automaticamente
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
    console.log('🔄 Iniciando GessoBot Engine...');
    await initDatabase();
    resetarInicioBot();

    const client = await criarCliente();

    client.on('qr', async (qr) => {
        botStatus = 'aguardando_qr';
        io.emit('status', botStatus);
        
        // Gera o QR Code para o terminal
        const qrcodeTerminal = require('qrcode-terminal');
        qrcodeTerminal.generate(qr, { small: true });

        // Converte o QR para imagem Base64 para o Painel Web
        const qrImage = await QRCode.toDataURL(qr);
        io.emit('qr', qrImage);
        console.log('📱 QR Code gerado e enviado para o painel.');
    });

    client.on('authenticated', () => {
        botStatus = 'autenticado';
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
        io.emit('status', botStatus);
        console.log(`⚠️ Desconectado: ${reason}`);
        setTimeout(() => process.exit(1), 5000);
    });

    try {
        await client.initialize();
    } catch (err) {
        console.error('❌ Erro ao inicializar:', err);
        setTimeout(() => process.exit(1), 10000);
    }
}

// Iniciar o sistema
iniciarBot().catch(console.error);