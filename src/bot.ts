import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';

import { getSessao, salvarSessao, resetarSessao } from './sessao';
import { calcularOrcamento, NOMES_SERVICO } from './orcamento';

const execPromise = util.promisify(exec);

function formatarTelefoneBR(jid: string): string {
    const num = jid.replace(/\D/g, '');
    if (num.length === 13 && num.startsWith('55')) {
        return `+55 (${num.substring(2, 4)}) ${num.substring(4, 9)}-${num.substring(9)}`;
    }
    if (num.length === 12 && num.startsWith('55')) {
        return `+55 (${num.substring(2, 4)}) ${num.substring(4, 8)}-${num.substring(8)}`;
    }
    return num;
}

export async function processarMensagem(sock: any, msg: any) {
    const textoMensagem = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    if (!textoMensagem) return;

    const remetente = msg.key.remoteJid;
    if (!remetente) return;

    const reply = async (texto: string) => {
        await sock.sendMessage(remetente, { text: texto }, { quoted: msg });
    };

    const sessao = await getSessao(remetente);

    if (sessao.isProcessing) {
        console.log(`Mensagem ignorada de ${remetente} (Processamento ativo)`);
        return;
    }

    switch (sessao.estado) {
        case 'INICIO':
            // ✅ Mensagem de boas-vindas pedindo o nome
            await reply("Olá! 👋 Sou o GessoBot, o assistente virtual da nossa empresa.\n\nPara eu te passar um orçamento rapidinho, como eu posso te chamar?");
            sessao.estado = 'COLETANDO_DADOS';
            await salvarSessao(remetente, sessao);
            break;

        case 'COLETANDO_DADOS':
            // 1. Recebe o nome e pede o endereço de forma educada
            if (!sessao.dados.nome) {
                sessao.dados.nome = textoMensagem.trim();
                await reply(`Que nome lindo, ${sessao.dados.nome}! 😊\n\nPara que possamos atendê-lo da melhor forma, poderia nos informar o *endereço completo* da obra?\n\n👉 _(Rua, número, Bairro e Cidade)_`);
                await salvarSessao(remetente, sessao);
                return;
            }

            // 2. Recebe o endereço e apresenta os serviços
            if (!sessao.dados.endereco) {
                sessao.dados.endereco = textoMensagem.trim();
                await reply(`Prazer, ${sessao.dados.nome}! 🤝\n\nQual serviço precisa de cotar hoje?\n\n1️⃣ - Serviços de Drywall\n2️⃣ - Gesso de plaquinha\n\n👉 Digite apenas o número da opção:`);
                await salvarSessao(remetente, sessao);
                return;
            }

            // 3. Recebe o serviço e pede a metragem
            if (!sessao.dados.servico) {
                const opcao = textoMensagem.trim();
                if (opcao === '1') {
                    sessao.dados.servico = 'drywall';
                } else if (opcao === '2') {
                    sessao.dados.servico = 'gesso_parede';
                } else {
                    await reply("Opção inválida. Por favor, digite *1* ou *2*.");
                    return;
                }
                await reply("Excelente escolha! ✅\n\nAgora preciso saber o tamanho do local. Diga-me a *Largura* e o *Comprimento* do ambiente (ex: 3x4) ou a metragem total.");
                await salvarSessao(remetente, sessao);
                return;
            }

            // 4. Recebe a metragem, calcula e gera o PDF
            if (!sessao.dados.metragem) {
                const dimensao = textoMensagem.trim().toLowerCase();

                const regexMedida = /(\d+(?:[.,]\d+)?)\s*[x*]\s*(\d+(?:[.,]\d+)?)/;
                const regexMetragemTotal = /^(\d+(?:[.,]\d+)?)$/;

                const validacao3x4 = dimensao.match(regexMedida);
                const validacaoTotal = dimensao.match(regexMetragemTotal);

                let m2 = 0;

                if (validacao3x4) {
                    const l = parseFloat(validacao3x4[1].replace(',', '.'));
                    const c = parseFloat(validacao3x4[2].replace(',', '.'));
                    m2 = l * c;
                } else if (validacaoTotal) {
                    m2 = parseFloat(validacaoTotal[1].replace(',', '.'));
                } else {
                    // ✅ Mensagem de formato inválido
                    await reply("😊 *Ops! Formato inválido.*\n\nPara eu calcular certinho, por favor, digite as medidas no formato *Largura x Comprimento*.\n\n👉 *Exemplo:* 3x4, 10x50, 4.5x3...");
                    return;
                }

                sessao.dados.metragem = m2;
                sessao.dados.ambiente = dimensao;
                sessao.dados.localizacao = 'Não informada';
                sessao.dados.acabamento = 'Padrão';
                sessao.estado = 'FINALIZADO';
                sessao.isProcessing = true;
                await salvarSessao(remetente, sessao);

                await reply(`✅ Medidas anotadas! Total: *${m2.toFixed(2)} m²*.\n\n⏳ Só um instante! Estou a calcular os materiais, passar todas as informações para um especialista e a gerar a prévia do seu orçamento...`);

                const timestamp = Date.now();
                const jsonPath = path.resolve(__dirname, `../temp_dados_${timestamp}.json`);
                const pdfPath = path.resolve(__dirname, `../orcamento_${timestamp}.pdf`);

                try {
                    const orcamentoCalculado = calcularOrcamento(sessao.dados);
                    const telefoneFormatado = formatarTelefoneBR(remetente);

                    const dadosPython = {
                        nome: sessao.dados.nome,
                        telefone: telefoneFormatado,
                        localizacao: sessao.dados.localizacao,
                        endereco: sessao.dados.endereco,
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

                    const numeroAdmin = sock.user?.id.split(':')[0] + '@s.whatsapp.net';

                    const textoLead = `🔔 *NOVO LEAD (Tavares Gesso)*\n\n` +
                                      `👤 Nome: ${sessao.dados.nome}\n` +
                                      `📱 Contato: ${telefoneFormatado}\n` +
                                      `📍 Endereço: ${sessao.dados.endereco}\n` +
                                      `📏 Metragem: ${sessao.dados.metragem.toFixed(2)} m²\n` +
                                      `💰 Valor Calculado: R$ ${orcamentoCalculado.total.toFixed(2)}`;

                    await sock.sendMessage(numeroAdmin, { text: textoLead });
                    await sock.sendMessage(numeroAdmin, {
                        document: { url: pdfPath },
                        mimetype: 'application/pdf',
                        fileName: 'Orcamento_Tavares_Gesso.pdf',
                        caption: `Prévia gerada com sucesso.\nValor Total: R$ ${orcamentoCalculado.total.toFixed(2)}`
                    });

                    await reply("Muito bem, estamos a passar todas as informações para um especialista e num prazo de até 24h a nossa equipa entrará em contacto já com uma prévia do orçamento. Posso ajudar em algo mais?");

                } catch (error) {
                    console.error("Erro crítico ao processar orçamento:", error);
                    await reply("❌ Ocorreu um erro ao gerar o seu documento. A nossa equipa já foi notificada.");
                    await resetarSessao(remetente);
                } finally {
                    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
                    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
                }
            }
            break;
    }
}