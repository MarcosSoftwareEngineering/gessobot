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
            <style>
                body { font-family: sans-serif; text-align: center; padding: 20px; background: #f4f4f9; color: #333; }
                .card { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); display: inline-block; max-width: 400px; width: 100%; }
                #qr-container { margin: 20px 0; min-height: 250px; display: flex; align-items: center; justify-content: center; border: 2px dashed #ddd; border-radius: 10px; }
                #qr-container img { max-width: 100%; height: auto; }
                .status-badge { padding: 5px 15px; border-radius: 20px; font-weight: bold; background: #eee; }
                .online { background: #d4edda; color: #155724; }
                .aguardando { background: #fff3cd; color: #856404; }
                button { background: #ff4747; color: white; border: none; padding: 12px 25px; border-radius: 5px; cursor: pointer; font-weight: bold; transition: 0.3s; }
                button:hover { background: #d43f3f; }
                footer { margin-top: 20px; font-size: 0.8em; color: #888; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>🛠️ GessoBot v2.0</h2>
                <p>Status: <span id="status" class="status-badge">${botStatus}</span></p>
                <div id="qr-container">
                    ${lastQr ? `<img src="${lastQr}" />` : '<p>Aguardando QR Code...<br><small>Isso pode levar 30s</small></p>'}
                </div>
                <button onclick="confirmReset()">Reiniciar Sessão (Reset)</button>
            </div>
            <footer>Marcos Software Engineer © 2026</footer>

            <script>
                function confirmReset() {
                    if(confirm("Deseja realmente apagar a sessão atual e reiniciar o bot?")) {
                        location.href = '/reset-auth';
                    }
                }
                // Atualiza a página automaticamente para buscar novos status ou QR
                setTimeout(() => { location.reload(); }, 5000);
            </script>
        </body>
        </html>
    `);
});

// --- ROTA DE RESET (APAGAR LOCALAUTH) ---
app.get('/reset-auth', (req, res) => {
    // Caminho para a pasta de autenticação
    const sessionPath = path.join(__dirname, '../.wwebjs_auth');
    try {
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
        res.send('<h1>Sessão Apagada!</h1><p>O servidor está reiniciando... Volte para a <a href="/">Página Inicial</a> em 10 segundos.</p>');
        
        // Finaliza o processo. O PM2 no Google Cloud vai subir o bot de novo automaticamente
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
    console.log('🔄 Iniciando GessoBot Engine...');
    await initDatabase();
    resetarInicioBot();

    const client = await criarCliente();

    client.on('qr', async (qr) => {
        botStatus = 'aguardando_qr';
        
        // Gera no terminal para backup
        const qrcodeTerminal = require('qrcode-terminal');
        qrcodeTerminal.generate(qr, { small: true });

        // Salva e envia para o Painel Web
        const qrImage = await QRCode.toDataURL(qr);
        lastQr = qrImage; // Fundamental para o Front-end ler
        io.emit('qr', qrImage);
        io.emit('status', botStatus);
        console.log('📱 QR Code gerado e enviado para o painel.');
    });

    client.on('authenticated', () => {
        botStatus = 'autenticado';
        lastQr = ''; // Limpa o QR pois já logou
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