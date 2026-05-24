import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';
import readline from 'readline';
import { getSessao, salvarSessao, ativarBloqueio36h, formatarMensagemLead, resetarSessao } from './sessao';

const execPromise = util.promisify(exec);

// Configuração para ler entradas direto no terminal do VS Code
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (texto: string) => new Promise<string>((resolve) => rl.question(texto, resolve));

async function connectToWhatsApp() {
    // Gerencia a sessão de autenticação do Baileys
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        // O Baileys exige um browser específico para o código de emparelhamento funcionar sem bugs
        browser: ['Chrome (Windows)', '', ''] 
    });

    // 🌟 LÓGICA DE EMPARELHAMENTO POR NÚMERO (PAIRING CODE) 🌟
    if (!sock.authState.creds.registered) {
        // Aguarda 2 segundos para o QR Code renderizar caso o usuário prefira a câmera
        setTimeout(async () => {
            console.log(`\n[MSE System] Autenticação necessária.`);
            const resposta = await question('Deseja conectar gerando um código para o número de telefone? (s/n): ');
            
            if (resposta.toLowerCase() === 's') {
                const numeroCliente = await question('Digite o número do WhatsApp com DDI e DDD (ex: 5511999999999): ');
                
                try {
                    const code = await sock.requestPairingCode(numeroCliente.trim());
                    const codeFormatado = code?.match(/.{1,4}/g)?.join("-") || code;
                    
                    console.log(`\n======================================`);
                    console.log(`📱 CÓDIGO DE EMPARELHAMENTO: ${codeFormatado}`);
                    console.log(`Abra o WhatsApp no celular > Aparelhos Conectados > Conectar com Número`);
                    console.log(`======================================\n`);
                } catch (error) {
                    console.error('❌ Erro ao solicitar o código. Verifique se o número está correto.', error);
                }
            }
        }, 2000);
    }

    // Salva as credenciais sempre que houver atualização
    sock.ev.on('creds.update', saveCreds);

    // Monitora a conexão
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ GessoBot conectado com Baileys e pronto para operar!');
        }
    });

    // Escuta novas mensagens
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        
        // Ignora mensagens do próprio bot ou mensagens sem texto
        if (!msg.message || msg.key.fromMe) return;

        const remetente = msg.key.remoteJid!;
        
        // Ignora mensagens de status e de grupos
        if (remetente === 'status@broadcast' || remetente.includes('@g.us')) return;

        // O Baileys armazena o texto de formas diferentes dependendo do tipo da mensagem
        const textoMensagem = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!textoMensagem) return;

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
                await reply(`Prazer, ${sessao.dados.nome}! 🤝\n\nQual serviço você precisa cotar hoje?\n\n1️⃣ - Serviços de Drywall\n2️⃣ - Gesso de plaquinha\n\n👉 Digite apenas o número da opção:`);
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

                await reply("Excelente escolha!\n\nAgora preciso saber o tamanho do local. Me diga a Largura e o Comprimento do ambiente (ex: 3x4).");
                sessao.estado = 'AGUARDANDO_METRAGEM';
                await salvarSessao(remetente, sessao);
                break;

            case 'AGUARDANDO_METRAGEM':
                const dimensao = textoMensagem.trim();
                sessao.dados.localizacao = 'Não informada'; 

                await reply("⏳ Só um instante! Estou passando todas as informações para um especialista e gerando a prévia do seu orçamento...");

                try {
                    // 1. Prepara os arquivos temporários para o Python
                    const timestamp = Date.now();
                    const jsonPath = path.resolve(__dirname, `../temp_dados_${timestamp}.json`);
                    const pdfPath = path.resolve(__dirname, `../orcamento_${timestamp}.pdf`);

                    // O Baileys usa '@s.whatsapp.net', limpamos isso para salvar só os números
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

                    // Salva o arquivo de intercâmbio JSON
                    fs.writeFileSync(jsonPath, JSON.stringify(dadosPython, null, 2));

                    // 2. Executa o Script Python passando os caminhos como argumentos
                    const pythonScript = path.resolve(__dirname, 'gerar_orcamento.py');
                    await execPromise(`python "${pythonScript}" "${jsonPath}" "${pdfPath}"`);

                    // 3. Envia o Lead para o ADMIN (O próprio número onde o bot roda)
                    const textoLead = formatarMensagemLead(sessao.dados, remetente);
                    // No Baileys, o número conectado fica dentro de sock.user.id
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
                    await reply("Muito bem, estamos passando todas as informações para um especialista e em um prazo de até 24h nossa equipe entrará em contato já com uma prévia do orçamento, posso ajudá-lo em algo mais?");
                    
                    // 5. Ativa o bloqueio temporário de 36 horas
                    await ativarBloqueio36h(remetente, sessao);

                    // 6. Coleta de lixo (Deleta os arquivos temp criados)
                    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
                    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

                } catch (error) {
                    console.error("Erro crítico ao processar orçamento:", error);
                    await reply("❌ Ocorreu um erro ao gerar o seu documento. Nossa equipe já foi notificada.");
                    await resetarSessao(remetente);
                }
                break;
        }
    });
}

// Inicia a aplicação
connectToWhatsApp();