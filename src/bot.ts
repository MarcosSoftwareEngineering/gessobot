import { WASocket, proto } from '@whiskeysockets/baileys';
import { pausaLeitura, pausaEntresMensagens, getMultiplicadorWarmup } from './humanizer';
import { gerarEEnviarPdf } from './orcamento';

// Memória do Bot
const estadoCliente = new Map<string, any>();

function extrairTexto(msg: proto.IWebMessageInfo): string {
    return msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
}

function pareceBot(msg: proto.IWebMessageInfo): boolean {
    if (msg.key.fromMe) return true;
    if (msg.key.remoteJid === 'status@broadcast') return true;
    const body = extrairTexto(msg).trim();
    if (body === '') return true;
    const padroesBots = [/^\{.*\}$/s, /^\/[a-z]+/, /^\[BOT\]/i, /^(bot|robot|auto):/i];
    return padroesBots.some(p => p.test(body));
}

function deveIgnorar(from: string): boolean {
    return (from.endsWith('@g.us') || from.includes('@newsletter') || from.includes('@broadcast'));
}

async function enviar(sock: WASocket, chatId: string, texto: string, textoRecebido: string = ''): Promise<void> {
    getMultiplicadorWarmup();
    if (textoRecebido) await pausaLeitura(textoRecebido);
    await sock.presenceSubscribe(chatId);
    await sock.sendPresenceUpdate('composing', chatId);
    const tempoDigitacao = Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000;
    await new Promise(resolve => setTimeout(resolve, tempoDigitacao));
    await sock.sendMessage(chatId, { text: texto });
    await sock.sendPresenceUpdate('paused', chatId);
    await pausaEntresMensagens();
}

export async function processarMensagem(sock: WASocket, msg: proto.IWebMessageInfo) {
    const chatId = msg.key.remoteJid;
    if (!chatId || deveIgnorar(chatId)) return;

    const body = extrairTexto(msg);
    const texto = body.toLowerCase().trim();

    if (pareceBot(msg)) return;

    let ficha = estadoCliente.get(chatId) || { passo: 'INICIO' };

    // PASSO 1: Saudação
    if (ficha.passo === 'INICIO') {
        await enviar(sock, chatId, `Olá! 👋 Sou o *GessoBot*, o assistente virtual da nossa empresa.\n\nPara eu te passar um orçamento rapidinho, como eu posso te chamar?`, body);
        ficha.passo = 'ESPERANDO_NOME';
        estadoCliente.set(chatId, ficha);
        return;
    }

    // PASSO 2: Captura do Nome
    if (ficha.passo === 'ESPERANDO_NOME') {
        ficha.nome = body;
        await enviar(sock, chatId, `Prazer, ${ficha.nome}! 🤝\n\nQual serviço você precisa cotar hoje?\n\n*1️⃣* - Forro de Gesso\n*2️⃣* - Parede Drywall\n*3️⃣* - Sanca / Gesso 3D\n\n👉 *Digite apenas o número da opção:*`, body);
        ficha.passo = 'ESPERANDO_SERVICO';
        estadoCliente.set(chatId, ficha);
        return;
    }

    // PASSO 3: Captura do Serviço 
    if (ficha.passo === 'ESPERANDO_SERVICO') {
        const mapa: any = { '1': 'forro_liso', '2': 'drywall', '3': 'gesso_3d' };
        if (mapa[texto]) {
            ficha.servico = mapa[texto];
            await enviar(sock, chatId, `Excelente escolha!\n\nAgora preciso saber o tamanho do local. Me diga a *Largura* e o *Comprimento* do ambiente (ex: 3x4).`, body);
            ficha.passo = 'ESPERANDO_MEDIDAS';
            estadoCliente.set(chatId, ficha);
        } else {
            await enviar(sock, chatId, `❌ Opção inválida. Digite apenas *1*, *2* ou *3*.`, body);
        }
        return;
    }

    // PASSO 4: Orçamento com PDF
    if (ficha.passo === 'ESPERANDO_MEDIDAS') {
        const partes = texto.match(/\d+/g);
        if (partes && partes.length >= 2) {
            ficha.metragem = parseFloat(partes[0]) * parseFloat(partes[1]);
            ficha.ambiente = body;
        } else {
            ficha.metragem = 20; 
        }

        // CHAMA A FUNÇÃO QUE GERA O PDF E ENVIA
        await gerarEEnviarPdf(sock, chatId, ficha);
        
        ficha.passo = 'ESPERANDO_FECHAMENTO';
        estadoCliente.set(chatId, ficha);
        return;
    }

    // PASSO 5: Fechamento (Livre de bloqueios)
    if (ficha.passo === 'ESPERANDO_FECHAMENTO') {
        if (texto === '1' || texto.includes('sim')) {
            await enviar(sock, chatId, `🎉 Perfeito, ${ficha.nome}!\n\nVou repassar seus dados para um especialista. Ele te chamará em breve.\n\nObrigado!`, body);
            estadoCliente.delete(chatId); // Apenas reseta a ficha

        } else if (texto === '2' || texto.includes('não') || texto.includes('nao')) {
            await enviar(sock, chatId, `Sem problemas! Agradecemos o contato. Tenha um excelente dia! 👋`, body);
            estadoCliente.delete(chatId); // Apenas reseta a ficha
            
        } else {
            await enviar(sock, chatId, `Por favor, responda com *1* para Sim ou *2* para Não.`, body);
        }
        return;
    }
}