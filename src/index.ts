import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { getSessao, salvarSessao, ativarBloqueio36h, formatarMensagemLead, resetarSessao } from './sessao';

const execPromise = util.promisify(exec);

// Exportamos a função que o index.ts está a tentar importar
export async function processarMensagem(sock: any, msg: any) {
    // O Baileys armazena o texto de formas diferentes dependendo do tipo da mensagem
    const textoMensagem = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    if (!textoMensagem) return;

    const remetente = msg.key.remoteJid;
    if (!remetente) return;

    // Helper function para facilitar o envio de respostas
    const reply = async (texto: string) => {
        await sock.sendMessage(remetente, { text: texto }, { quoted: msg });
    };

    // Recupera a sessão atual do cliente
    const sessao = await getSessao(remetente);

    // 🛡️ REGRA DE NEGÓCIO: A "Geladeira" de 36 horas
    if (sessao.estado === 'BLOQUEIO_ATIVO') {
        console.log(`Mensagem ignorada de ${remetente} (Bloqueio 36h ativo)`);
        return; 
    }

    // Máquina de Estados do Fluxo de Conversa
    switch (sessao.estado) {
        case 'INICIO':
            await reply("Olá! 👋 Sou o GessoBot, o assistente virtual da nossa empresa.\n\nPara eu te passar um orçamento rapidinho, como eu posso te chamar?");
            sessao.estado = 'AGUARDANDO_NOME';
            await salvarSessao(remetente, sessao);
            break;

        case 'AGUARDANDO_NOME':
            sessao.dados.nome = textoMensagem.trim();
            await reply(`Prazer, ${sessao.dados.nome}! 🤝\n\nQual serviço precisa de cotar hoje?\n\n1️⃣ - Serviços de Drywall\n2️⃣ - Gesso de plaquinha\n\n👉 Digite apenas o número da opção:`);
            sessao.estado = 'MENU_SERVICO';
            await salvarSessao(remetente, sessao);
            break;

        case 'MENU_SERVICO':
            const opcao = textoMensagem.trim();
            if (opcao === '1') {
                sessao.dados.servico = 'drywall';
            } else if (opcao === '2') {
                sessao.dados.servico = 'gesso_parede';
            } else {
                await reply("Opção inválida. Por favor, digite 1 ou 2.");
                return; 
            }

            await reply("Excelente escolha!\n\nAgora preciso saber o tamanho do local. Diga-me a Largura e o Comprimento do ambiente (ex: 3x4).");
            sessao.estado = 'AGUARDANDO_METRAGEM';
            await salvarSessao(remetente, sessao);
            break;

        case 'AGUARDANDO_METRAGEM':
            const dimensao = textoMensagem.trim();
            sessao.dados.localizacao = 'Não informada'; 

            await reply("⏳ Só um instante! Estou a passar todas as informações para um especialista e a gerar a prévia do seu orçamento...");

            try {
                // 1. Prepara os ficheiros temporários para o Python
                const timestamp = Date.now();
                const jsonPath = path.resolve(__dirname, `../temp_dados_${timestamp}.json`);
                const pdfPath = path.resolve(__dirname, `../orcamento_${timestamp}.pdf`);

                // O Baileys usa '@s.whatsapp.net', limpamos isso para guardar só os números
                const telefonePuro = remetente.replace('@s.whatsapp.net', '');

                // Transforma os dados no formato esperado pelo script Python
                const dadosPython = {
                    nome: sessao.dados.nome,
                    telefone: telefonePuro,
                    localizacao: sessao.dados.localizacao,
                    ambiente: dimensao,
                    servico: sessao.dados.servico === 'drywall' ? 'Serviço de Drywall' : 'Gesso de Plaquinha',
                    metragem: dimensao,
                    itens: [
                       { descricao: `Mão de obra e Material para ${sessao.dados.servico === 'drywall' ? 'Drywall' : 'Gesso'}`, qtd: 1, un: "un", unit: 0, total: 0 }
                    ],
                    total: 0
                };

                // Guarda o ficheiro de intercâmbio JSON
                fs.writeFileSync(jsonPath, JSON.stringify(dadosPython, null, 2));

                // 2. Executa o Script Python passando os caminhos como argumentos
                const pythonScript = path.resolve(__dirname, 'gerar_orcamento.py');
                await execPromise(`python "${pythonScript}" "${jsonPath}" "${pdfPath}"`);

                // 3. Envia a Lead para o ADMIN (O próprio número onde o bot corre)
                const textoLead = formatarMensagemLead(sessao.dados, remetente);
                const numeroAdmin = sock.user?.id.split(':')[0] + '@s.whatsapp.net';
                
                // Envia texto e PDF usando o padrão do Baileys
                await sock.sendMessage(numeroAdmin, { text: textoLead });
                await sock.sendMessage(numeroAdmin, { 
                    document: { url: pdfPath }, 
                    mimetype: 'application/pdf', 
                    fileName: 'Orcamento_Tavares_Gesso.pdf',
                    caption: 'Prévia gerada com sucesso.'
                });

                // 4. Resposta de finalização para o Cliente
                await reply("Muito bem, estamos a passar todas as informações para um especialista e num prazo de até 24h a nossa equipa entrará em contacto já com uma prévia do orçamento. Posso ajudar em algo mais?");
                
                // 5. Ativa o bloqueio temporário de 36 horas
                await ativarBloqueio36h(remetente, sessao);

                // 6. Limpeza (Apaga os ficheiros temporários criados)
                if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
                if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

            } catch (error) {
                console.error("Erro crítico ao processar orçamento:", error);
                await reply("❌ Ocorreu um erro ao gerar o seu documento. A nossa equipa já foi notificada.");
                await resetarSessao(remetente);
            }
            break;
    }
}