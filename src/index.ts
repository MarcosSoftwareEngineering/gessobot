import { Client, LocalAuth } from 'whatsapp-web.js';
const qrcode = require('qrcode-terminal') as { generate: (qr: string, opts: { small: boolean }) => void };
import * as dotenv from 'dotenv';
import * as http from 'http';
import { initDatabase } from './db/database';
import { processarMensagem } from './bot';
import { enfileirar } from './queue';
import { resetarInicioBot } from './humanizer';

dotenv.config();

const PORT = process.env.PORT || 3000;
let botStatus = 'iniciando';
let qrGerado = false;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: botStatus,
    qr_gerado: qrGerado,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));
});

server.listen(PORT, () => {
  console.log(`🌐 Health check rodando na porta ${PORT}`);
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
        '--single-process',
        '--disable-extensions',
      ],
    },
  });
}

async function iniciarBot(tentativa = 1): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║         🏗️  GessoBot v2.0            ║');
  console.log('║    Anti-Ban + Automação de Gesso     ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  await initDatabase();
  resetarInicioBot();

  const client = await criarCliente();

  client.on('qr', (qr) => {
    botStatus = 'aguardando_qr';
    qrGerado = true;
    console.log('\n📱 Escaneie o QR Code com o WhatsApp:\n');
    qrcode.generate(qr, { small: true });
    console.log('\n⚠️  QR expira em 60 segundos.\n');
  });

  client.on('authenticated', () => {
    botStatus = 'autenticado';
    qrGerado = false;
    console.log('✅ Autenticado!');
  });

  client.on('auth_failure', (msg) => {
    botStatus = 'erro_auth';
    console.error('❌ Falha na autenticação:', msg);
    setTimeout(() => iniciarBot(tentativa + 1), 10000);
  });

  client.on('ready', () => {
    botStatus = 'online';
    console.log('');
    console.log('✅ GessoBot ONLINE!');
    console.log(`📞 Número: ${client.info?.wid?.user}`);
    console.log('🛡️  Anti-ban ativo');
    console.log('🚫 Grupos/canais/status: ignorados');
    console.log('');
  });

  client.on('message', async (msg) => {
    try {
      await enfileirar(client, msg, processarMensagem);
    } catch (err) {
      console.error('❌ Erro na fila:', err);
    }
  });

  client.on('disconnected', (reason) => {
    botStatus = 'desconectado';
    console.log(`⚠️  Desconectado: ${reason}`);
    console.log('🔄 Reconectando em 8s...');
    setTimeout(() => iniciarBot(tentativa + 1), 8000);
  });

  client.on('change_state', (state) => {
    console.log(`📶 Estado: ${state}`);
    if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
      setTimeout(() => {
        client.destroy().catch(() => {});
        iniciarBot(tentativa + 1);
      }, 5000);
    }
  });

  console.log('🔄 Conectando ao WhatsApp...');
  botStatus = 'conectando';

  try {
    await client.initialize();
  } catch (err) {
    console.error('❌ Erro ao inicializar:', err);
    setTimeout(() => iniciarBot(tentativa + 1), 15000);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Promise rejeitada:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️  Exceção:', err);
});

iniciarBot().catch((err) => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
