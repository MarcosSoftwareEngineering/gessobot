import { Client, Message } from 'whatsapp-web.js';

// Memória do Bot: Guarda em qual passo do funil cada cliente está
const estadoCliente = new Map<string, any>();

export async function processarMensagem(client: Client, msg: Message) {
    const chatId = msg.from;
    const texto = msg.body.toLowerCase();

    // Se a mensagem for de um grupo, o bot ignora
    if (chatId.includes('@g.us')) return;

    // Recupera a ficha do cliente. Se for novo, começa no passo 'INICIO'
    let ficha = estadoCliente.get(chatId) || { passo: 'INICIO' };

    // PASSO 1: A Saudação e Captura de Nome
    if (ficha.passo === 'INICIO') {
        await client.sendMessage(chatId, `Olá! 👋 Sou o *GessoBot*, o assistente virtual da nossa empresa.\n\nPara eu te passar um orçamento rapidinho, como eu posso te chamar?`);
        ficha.passo = 'ESPERANDO_NOME';
        estadoCliente.set(chatId, ficha);
        return;
    }

    // PASSO 2: Captura do Serviço
    if (ficha.passo === 'ESPERANDO_NOME') {
        ficha.nome = msg.body;
        await client.sendMessage(chatId, `Prazer, ${ficha.nome}! 🤝\n\nQual serviço você precisa cotar hoje?\n\n*1️⃣* - Forro de Gesso\n*2️⃣* - Parede Drywall\n*3️⃣* - Sanca / Gesso 3D\n\n👉 *Digite apenas o número da opção:*`);
        ficha.passo = 'ESPERANDO_SERVICO';
        estadoCliente.set(chatId, ficha);
        return;
    }

    // PASSO 3: Captura das Medidas
    if (ficha.passo === 'ESPERANDO_SERVICO') {
        if (texto === '1' || texto === '2' || texto === '3') {
            ficha.servico = texto === '1' ? 'Forro de Gesso' : texto === '2' ? 'Parede Drywall' : 'Sanca / Gesso 3D';
            await client.sendMessage(chatId, `Excelente escolha: *${ficha.servico}*.\n\nAgora preciso saber o tamanho do local. Me diga a *Largura* e o *Comprimento* do ambiente (ex: 3x4, ou 3 por 4).`);
            ficha.passo = 'ESPERANDO_MEDIDAS';
            estadoCliente.set(chatId, ficha);
        } else {
            await client.sendMessage(chatId, `❌ Opção inválida. Por favor, digite apenas o número *1*, *2* ou *3*.`);
        }
        return;
    }

    // PASSO 4: Entrega do Orçamento e Tentativa de Fechamento (Gatilho de Venda)
    if (ficha.passo === 'ESPERANDO_MEDIDAS') {
        ficha.medidas = msg.body;
        await client.sendMessage(chatId, `📐 Entendido! Medidas: ${ficha.medidas}.\n\n⏳ Só um instante, estou calculando os materiais e a mão de obra...`);
        
        setTimeout(async () => {
            await client.sendMessage(chatId, `✅ *ORÇAMENTO PRONTO!*\n\nOlá ${ficha.nome},\nPara o serviço de *${ficha.servico}* com medidas de ${ficha.medidas}, o investimento estimado é a partir de *R$ 1.250,00*.\n\nPodemos agendar uma visita técnica sem compromisso para tirar as medidas exatas e fechar o pedido?\n\n*1* - Sim, quero agendar.\n*2* - Ainda estou pesquisando.`);
            ficha.passo = 'ESPERANDO_FECHAMENTO';
            estadoCliente.set(chatId, ficha);
        }, 3000);
        return;
    }

    // PASSO 5: Encaminhamento Final
    if (ficha.passo === 'ESPERANDO_FECHAMENTO') {
        if (texto === '1' || texto.includes('sim')) {
            await client.sendMessage(chatId, `🎉 Perfeito, ${ficha.nome}! \n\nVou repassar seus dados para um de nossos especialistas humanos. Ele vai te chamar aqui mesmo em poucos minutos para marcar a visita.\n\nObrigado pela preferência!`);
            estadoCliente.delete(chatId);
        } else if (texto === '2' || texto.includes('não') || texto.includes('nao')) {
            await client.sendMessage(chatId, `Sem problemas! Agradecemos o contato. Se mudar de ideia, basta mandar um "Oi" que estaremos à disposição. Tenha um excelente dia! 👋`);
            estadoCliente.delete(chatId);
        } else {
            await client.sendMessage(chatId, `Por favor, responda com *1* para Sim ou *2* para Não.`);
        }
        return;
    }
}