import { Client, Message } from 'whatsapp-web.js';
import { pausaLeitura, simulaDigitacao, pausaEntresMensagens, getMultiplicadorWarmup } from './humanizer';

// Memória do Bot
const estadoCliente = new Map<string, any>();

// ==========================================
// 🤖 DETECÇÃO DE BOT
// ==========================================
function pareceBot(msg: Message): boolean {
    if (msg.fromMe) return true;
    if ((msg as any).isStatus) return true;
    if (!msg.body || msg.body.trim() === '') return true;

    const padroesBots = [
        /^\{.*\}$/s,           // JSON puro
        /^\/[a-z]+/,           // Comandos /start /help
        /^\[BOT\]/i,           // Prefixo [BOT]
        /^(bot|robot|auto):/i, // Prefixo bot:/auto:
    ];

    return padroesBots.some(p => p.test(msg.body.trim()));
}

// ==========================================
// 🚫 GUARD: Filtro Anti-Grupo e Anti-Canal
// ==========================================
function deveIgnorar(from: string): boolean {
    return (
        from.endsWith('@g.us') ||
        from.includes('@newsletter') ||
        from.includes('@broadcast')
    );
}

// ==========================================
// 📤 ENVIO HUMANIZADO
// Integrado com humanizer.ts existente
// ==========================================
async function enviar(client: Client, chatId: string, texto: string, textoRecebido: string = ''): Promise<void> {
    getMultiplicadorWarmup(); // aplica warmup internamente no humanizer

    if (textoRecebido) await pausaLeitura(textoRecebido);

    const chat = await client.getChatById(chatId);
    await simulaDigitacao(chat, texto);

    await client.sendMessage(chatId, texto);
    await pausaEntresMensagens();
}

// ==========================================
// 🔑 PROCESSAMENTO COM GATILHO HUMANO
// ==========================================
export async function processarMensagem(client: Client, msg: Message) {
    const chatId = msg.from;
    const texto = msg.body?.toLowerCase().trim() ?? '';

    // 🚫 Blindagem de escopo
    if (deveIgnorar(chatId)) return;

    // 🤖 Ignora outros bots
    if (pareceBot(msg)) {
        console.log(`🤖 [ANTI-BOT] Mensagem suspeita ignorada de: ${chatId}`);
        return;
    }

    let ficha = estadoCliente.get(chatId) || { passo: 'INICIO' };

    // PASSO 1: Saudação — disparada pelo gatilho do cliente
    if (ficha.passo === 'INICIO') {
        await enviar(
            client, chatId,
            `Olá! 👋 Sou o *GessoBot*, o assistente virtual da nossa empresa.\n\nPara eu te passar um orçamento rapidinho, como eu posso te chamar?`,
            msg.body
        );
        ficha.passo = 'ESPERANDO_NOME';
        estadoCliente.set(chatId, ficha);
        return;
    }

    // PASSO 2: Captura do Nome
    if (ficha.passo === 'ESPERANDO_NOME') {
        ficha.nome = msg.body.trim();
        await enviar(
            client, chatId,
            `Prazer, ${ficha.nome}! 🤝\n\nQual serviço você precisa cotar hoje?\n\n*1️⃣* - Forro de Gesso\n*2️⃣* - Parede Drywall\n*3️⃣* - Sanca / Gesso 3D\n\n👉 *Digite apenas o número da opção:*`,
            msg.body
        );
        ficha.passo = 'ESPERANDO_SERVICO';
        estadoCliente.set(chatId, ficha);
        return;
    }

    // PASSO 3: Captura do Serviço
    if (ficha.passo === 'ESPERANDO_SERVICO') {
        if (texto === '1' || texto === '2' || texto === '3') {
            ficha.servico = texto === '1' ? 'Forro de Gesso' : texto === '2' ? 'Parede Drywall' : 'Sanca / Gesso 3D';
            await enviar(
                client, chatId,
                `Excelente escolha: *${ficha.servico}*.\n\nAgora preciso saber o tamanho do local. Me diga a *Largura* e o *Comprimento* do ambiente (ex: 3x4, ou 3 por 4).`,
                msg.body
            );
            ficha.passo = 'ESPERANDO_MEDIDAS';
            estadoCliente.set(chatId, ficha);
        } else {
            await enviar(client, chatId, `❌ Opção inválida. Por favor, digite apenas o número *1*, *2* ou *3*.`, msg.body);
        }
        return;
    }

    // PASSO 4: Orçamento
    if (ficha.passo === 'ESPERANDO_MEDIDAS') {
        ficha.medidas = msg.body.trim();
        await enviar(
            client, chatId,
            `📐 Entendido! Medidas: ${ficha.medidas}.\n\n⏳ Só um instante, estou calculando os materiais e a mão de obra...`,
            msg.body
        );

        const delayCalculo = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
        setTimeout(async () => {
            await enviar(
                client, chatId,
                `✅ *ORÇAMENTO PRONTO!*\n\nOlá ${ficha.nome},\nPara o serviço de *${ficha.servico}* com medidas de ${ficha.medidas}, o investimento estimado é a partir de *R$ 1.250,00*.\n\nPodemos agendar uma visita técnica sem compromisso para tirar as medidas exatas e fechar o pedido?\n\n*1* - Sim, quero agendar.\n*2* - Ainda estou pesquisando.`
            );
            ficha.passo = 'ESPERANDO_FECHAMENTO';
            estadoCliente.set(chatId, ficha);
        }, delayCalculo);
        return;
    }

    // PASSO 5: Fechamento
    if (ficha.passo === 'ESPERANDO_FECHAMENTO') {
        if (texto === '1' || texto.includes('sim')) {
            await enviar(
                client, chatId,
                `🎉 Perfeito, ${ficha.nome}!\n\nVou repassar seus dados para um de nossos especialistas. Ele vai te chamar aqui em poucos minutos para marcar a visita.\n\nObrigado pela preferência!`,
                msg.body
            );
            estadoCliente.delete(chatId);
        } else if (texto === '2' || texto.includes('não') || texto.includes('nao')) {
            await enviar(
                client, chatId,
                `Sem problemas! Agradecemos o contato. Se mudar de ideia, basta mandar um "Oi" que estaremos à disposição. Tenha um excelente dia! 👋`,
                msg.body
            );
            estadoCliente.delete(chatId);
        } else {
            await enviar(client, chatId, `Por favor, responda com *1* para Sim ou *2* para Não.`, msg.body);
        }
        return;
    }
}
