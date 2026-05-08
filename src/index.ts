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

// ==========================================
// 🛡️ AIRBAGS SÊNIOR
// ==========================================
process.on('uncaughtException', (err) => {
    console.error('🚨 ERRO FATAL CAPTURADO (servidor não vai cair):', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('🚨 PROMISE REJEITADA CAPTURADA:', reason);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

let botStatus = 'desligado';
let lastQr = '';
let isBotRunning = false;

// ==========================================
// 🔁 RECONEXÃO AUTOMÁTICA
// ==========================================
const MAX_TENTATIVAS = 5;
let tentativas = 0;
let clienteAtual: Client | null = null;

// ==========================================
// ✅ FIX 1: KEEP-ALIVE INTERNO
// Faz o servidor pingar ele mesmo a cada 10min
// evitando que o Render durma durante o handshake
// ==========================================
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
    http.get(`${BASE_URL}/ping`, (res) => {
        console.log(`🏓 Keep-alive interno: ${res.statusCode}`);
    }).on('error', (err) => {
        console.warn('⚠️ Keep-alive falhou:', err.message);
    });
}, 10 * 60 * 1000); // a cada 10 minutos

app.get('/ping', (_req, res) => res.send('pong'));

async function reconectar(): Promise<void> {
    if (tentativas >= MAX_TENTATIVAS) {
        console.error(`❌ Máximo de ${MAX_TENTATIVAS} tentativas atingido. Reinicie manualmente.`);
        botStatus = 'desconectado';
        isBotRunning = false;
        return;
    }

    tentativas++;
    const espera = tentativas * 5000;
    console.log(`🔁 Tentativa ${tentativas}/${MAX_TENTATIVAS} de reconexão em ${espera / 1000}s...`);
    botStatus = 'reconectando';

    await new Promise(res => setTimeout(res, espera));
    await iniciarBot();
}

// ==========================================
// 🚫 ANTI-BAN
// ==========================================
function mensagemPermitida(from: string): boolean {
    if (from.endsWith('@g.us')) { console.log(`🚫 [ANTI-BAN] Grupo ignorado: ${from}`); return false; }
    if (from.includes('@newsletter')) { console.log(`🚫 [ANTI-BAN] Newsletter ignorada: ${from}`); return false; }
    if (from.includes('@broadcast')) { console.log(`🚫 [ANTI-BAN] Broadcast ignorado: ${from}`); return false; }
    return true;
}

// --- PAINEL DE CONTROLE ---
app.get('/', (req, res) => {
    let ledClass = 'led-desligado';
    if (botStatus === 'online' || botStatus === 'autenticado') ledClass = 'led-online';
    else if (['aguardando_qr', 'iniciando', 'reconectando'].includes(botStatus)) ledClass = 'led-iniciando';

    let qrContent = '';
    if (botStatus === 'desligado') qrContent = '<p>💤 O robô está dormindo.<br><small>Clique em Ligar Bot.</small></p>';
    else if (botStatus === 'iniciando') qrContent = '<p>⚙️ Iniciando o navegador...<br><small>Pode levar até 60s no Render.</small></p>';
    else if (botStatus === 'reconectando') qrContent = `<p>🔁 Reconectando... tentativa ${tentativas}/${MAX_TENTATIVAS}</p>`;
    else if (botStatus === 'aguardando_qr') qrContent = lastQr
        ? `<div><img src="${lastQr}" /><p style="color:#856404;font-size:0.85em">⚠️ Escaneie agora! Novo QR em ~18s se expirar.</p></div>`
        : '<p>⏳ Desenhando QR Code...</p>';
    else if (botStatus === 'online' || botStatus === 'autenticado') qrContent = `<div style="color:#155724"><h1 style="font-size:3em;margin:0">📱</h1><h3>Conectado!</h3></div>`;
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
            .badge { display: inline-block; background: #dc3545; color: white; font-size: 0.7em; padding: 2px 8px; border-radius: 20px; margin-left: 8px; vertical-align: middle; }
        </style></head><body>
            <div class="card">
                <h2>🛠️ Marcos Software Engineer <br> GessoBot v2.0 <span class="badge">🛡️ Anti-Ban</span></h2>
                <div class="status-container"><div class="led ${ledClass}"></div><span>${botStatus}</span></div>
                <div id="qr-container">${qrContent}</div>
                <div class="btn-container">
                    ${botStatus === 'desligado' ? '<button class="btn-start" onclick="location.href=\'/start-bot\'">Ligar Bot 🚀</button>' : ''}
                    <button class="btn-reset" onclick="if(confirm(\'Resetar?\')) location.href=\'/reset-auth\';">Resetar Conexão 🔄</button>
                </div>
            </div>
            <script>setTimeout(() => { location.reload(); }, 4000);</script>
        </body></html>
    `);
});

app.get('/start-bot', (req, res) => {
    if (!isBotRunning) { tentativas = 0; iniciarBot(); }
    res.redirect('/');
});

app.get('/reset-auth', (req, res) => {
    const sessionPath = path.join(__dirname, '../.wwebjs_auth');
    try {
        if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
        res.send(`<body style="text-align:center;padding:50px"><h1>🔄 Resetando...</h1><script>setTimeout(()=>{window.location.href='/start-bot'},6000)</script></body>`);
        setTimeout(() => process.exit(1), 2000);
    } catch (err) { res.status(500).send('Erro: ' + err); }
});

server.listen(PORT as number, '0.0.0.0', () => {
    console.log(`🌐 Painel GessoBot rodando na porta ${PORT}!`);
});

// ==========================================
// 🚀 INICIALIZAÇÃO OTIMIZADA
// ==========================================
async function criarCliente(): Promise<Client> {
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    return new Client({
        // ✅ FIX 2: PERSISTÊNCIA DE SESSÃO
        // dataPath aponta para /tmp no Render (único dir gravável no plano free)
        // Após escanear UMA VEZ, o WhatsApp restaura a sessão automaticamente
        authStrategy: new LocalAuth({
            clientId: 'gessobot',
            dataPath: process.env.SESSION_PATH || path.join(__dirname, '../.wwebjs_auth')
        }),
        puppeteer: {
            headless: true,
            executablePath: executablePath || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                // ✅ FIX 3: Flags extras para estabilidade no Render
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-default-apps',
                '--mute-audio',
                '--no-default-browser-check',
            ],
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            // ✅ FIX 4: TIMEOUT MAIOR — Render precisa de mais tempo pra subir
            timeout: 120000 // era 60000, agora 120s
        },
    });
}

async function iniciarBot(): Promise<void> {
    isBotRunning = true;
    botStatus = 'iniciando';

    try { await initDatabase(); } catch(e) { console.error('Erro no DB:', e); }
    resetarInicioBot();

    const client = await criarCliente();
    clienteAtual = client;

    // ✅ FIX 5: LOOP DE QR CODE RENOVÁVEL
    // Cada vez que o WhatsApp gera um QR novo (a cada ~20s),
    // atualiza o painel automaticamente — sem precisar resetar
    client.on('qr', async (qr) => {
        botStatus = 'aguardando_qr';
        lastQr = await QRCode.toDataURL(qr);
        console.log('📱 Novo QR Code gerado — escaneie agora!');
    });

    client.on('authenticated', () => {
        // ✅ FIX 6: Log de confirmação que a sessão foi gravada
        botStatus = 'autenticado';
        lastQr = '';
        tentativas = 0;
        console.log('✅ Autenticado! Sessão gravada em disco — próximo boot não vai pedir QR.');
    });

    client.on('ready', () => {
        botStatus = 'online';
        tentativas = 0;
        console.log('🚀 ONLINE! Bot pronto para receber mensagens.');
    });

    client.on('auth_failure', (msg) => {
        // ✅ FIX 7: Captura falha de auth explicitamente
        console.error('❌ FALHA DE AUTENTICAÇÃO:', msg);
        botStatus = 'desconectado';
        isBotRunning = false;
        // Limpa sessão corrompida automaticamente
        const sessionPath = path.join(__dirname, '../.wwebjs_auth');
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('🗑️ Sessão corrompida removida automaticamente.');
        }
    });

    client.on('message', async (msg) => {
        if (!mensagemPermitida(msg.from)) return;
        try { await enfileirar(client, msg, processarMensagem); }
        catch (err) { console.error('❌ Erro na fila:', err); }
    });

    client.on('disconnected', async (reason) => {
        console.warn(`⚠️ Bot desconectado. Motivo: ${reason}`);
        botStatus = 'desconectado';
        lastQr = '';
        isBotRunning = false;
        try { await client.destroy(); } catch (_) {}
        if (reason !== 'LOGOUT') await reconectar();
    });

    try {
        await client.initialize();
    } catch (err) {
        console.error('❌ Falha na inicialização do Puppeteer:', err);
        isBotRunning = false;
        await reconectar();
    }
}
