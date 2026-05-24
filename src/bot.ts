import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { getSessao, salvarSessao, ativarBloqueio36h, formatarMensagemLead, resetarSessao } from './sessao';
import { calcularOrcamento, NOMES_SERVICO } from './orcamento';

const execPromise = util.promisify(exec);

export async function processarMensagem(sock: any, msg: any) {
    const textoMensagem = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    if (!textoMensagem) return;

    const remetente = msg.key.remoteJid;
    if (!remetente) return;

    const reply = async (texto: string) => {
        await sock.sendMessage(remetente, { text: texto }, { quoted: msg });
    };

    const sessao = await getSessao(remetente);

    // 🛡️ REGRA DE NEGÓCIO: A "Geladeira" de 36 horas
    if (sessao.estado === 'BLOQUEIO_ATIVO') {
        console.log(`Mensagem ignorada de ${remetente} (Bloqueio 36h ativo)`);
        return; 
    }

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

            await reply("Excelente escolha!\n\nAgora preciso saber o tamanho do local. Diga-me a Largura e o Comprimento do ambiente (ex: 3x4) ou a metragem total.");
            sessao.estado = 'AGUARDANDO_METRAGEM';
            await salvarSessao(remetente, sessao);
            break;

        case 'AGUARDANDO_METRAGEM':
            const dimensao = textoMensagem.trim();
            
            // Lógica Sénior: Extrai a metragem (multiplica se for 3x4, ou pega o número direto se for 12)
            let m2 = 1; // fallback
            const numeros = dimensao.match(/[\d.,]+/g);
            if (numeros && numeros.length >= 2 && dimensao.toLowerCase().includes('x')) {
                const l = parseFloat(numeros[0].replace(',', '.'));
                const c = parseFloat(numeros[1].replace(',', '.'));
                if (!isNaN(l) && !isNaN(c)) m2 = l * c;
            } else if (numeros && numeros.length >= 1) {
                const val = parseFloat(numeros[0].replace(',', '.'));
                if (!isNaN(val)) m2 = val;
            }

            // Atualiza os dados da sessão com a matemática resolvida
            sessao.dados.metragem = m2;
            sessao.dados.ambiente = dimensao;
            sessao.dados.localizacao = 'Não informada'; 
            sessao.dados.acabamento = 'Padrão';

            await reply("⏳ Só um instante! Estou a calcular os materiais, passar todas as informações para um especialista e a gerar a prévia do seu orçamento...");

            try {
                // Integração com o orcamento.ts (Aplica a regra dos R$ 60,00)
                const orcamentoCalculado = calcularOrcamento(sessao.dados);

                const timestamp = Date.now();
                const jsonPath = path.resolve(__dirname, `../temp_dados_${timestamp}.json`);
                const pdfPath = path.resolve(__dirname, `../orcamento_${timestamp}.pdf`);

                const telefonePuro = remetente.replace('@s.whatsapp.net', '');

                // Transforma os dados reais no formato exato que o Python espera
                const dadosPython = {
                    nome: sessao.dados.nome,
                    telefone: telefonePuro,
                    localizacao: sessao.dados.localizacao,
                    ambiente: sessao.dados.ambiente,
                    servico: NOMES_SERVICO[sessao.dados.servico!],
                    metragem: sessao.dados.metragem,
                    subtotal: orcamentoCalculado.subtotal,
                    desconto: orcamentoCalculado.desconto,
                    valor_desconto: orcamentoCalculado.valorDesconto,
                    total: orcamentoCalculado.total,
                    prazo: orcamentoCalculado.prazo,
                    itens: orcamentoCalculado.itens.map(item => ({
                        descricao: item.descricao,
                        qtd: item.quantidade,
                        un: item.unidade,
                        unit: item.valorUnitario,
                        total: item.valorTotal
                    }))
                };

                fs.writeFileSync(jsonPath, JSON.stringify(dadosPython, null, 2));

                const pythonScript = path.resolve(__dirname, 'gerar_orcamento.py');
                await execPromise(`python "${pythonScript}" "${jsonPath}" "${pdfPath}"`);

                // Envia a Lead e o PDF com os valores reais para o ADMIN
                const textoLead = formatarMensagemLead(sessao.dados, remetente);
                const numeroAdmin = sock.user?.id.split(':')[0] + '@s.whatsapp.net';
                
                await sock.sendMessage(numeroAdmin, { text: textoLead });
                await sock.sendMessage(numeroAdmin, { 
                    document: { url: pdfPath }, 
                    mimetype: 'application/pdf', 
                    fileName: 'Orcamento_Tavares_Gesso.pdf',
                    caption: `Prévia gerada com sucesso.\nValor Total: R$ ${orcamentoCalculado.total.toFixed(2)}`
                });

                // Resposta final ao cliente
                await reply("Muito bem, estamos a passar todas as informações para um especialista e num prazo de até 24h a nossa equipa entrará em contacto já com uma prévia do orçamento. Posso ajudar em algo mais?");
                
                await ativarBloqueio36h(remetente, sessao);

                // Limpeza de cache
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