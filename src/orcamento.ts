import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { TipoServico, DadosSessao, Orcamento, ItemOrcamento, TabelaPrecos } from './types';

// ============================================================================
// TABELA DE PREÇOS ATUALIZADA (R$ 60,00 M² - Material Incluso)
// ============================================================================
const TABELA_PRECOS: Record<TipoServico, TabelaPrecos> = {
  forro_liso: {
    materialPorM2: 0, 
    maoObraPorM2: 60.0, 
    acabamento: 320.0,
  },
  gesso_parede: {
    materialPorM2: 0,
    maoObraPorM2: 60.0,
    acabamento: 280.0,
  },
  sancas_molduras: {
    materialPorM2: 0,
    maoObraPorM2: 0,
    maoObraPorMl: 60.0, 
    materialPorMl: 0,
    acabamento: 0,
  },
  drywall: {
    materialPorM2: 0,
    maoObraPorM2: 60.0,
    acabamento: 350.0,
  },
  gesso_3d: {
    materialPorM2: 0,
    maoObraPorM2: 60.0,
    acabamento: 400.0,
  },
};

export const NOMES_SERVICO: Record<TipoServico, string> = {
  forro_liso: 'Forro de Gesso Liso',
  gesso_parede: 'Gesso em Parede',
  sancas_molduras: 'Sancas e Molduras',
  drywall: 'Drywall / Divisória',
  gesso_3d: 'Gesso 3D / Decorativo',
};

const PRAZO_SERVICO: Record<TipoServico, string> = {
  forro_liso: '3 a 5 dias úteis',
  gesso_parede: '2 a 4 dias úteis',
  sancas_molduras: '1 a 3 dias úteis',
  drywall: '4 a 7 dias úteis',
  gesso_3d: '5 a 8 dias úteis',
};

export function calcularOrcamento(dados: DadosSessao, descontoPct: number = 5): Orcamento {
  const servico = dados.servico!;
  const precos = TABELA_PRECOS[servico];
  const itens: ItemOrcamento[] = [];

  if (servico === 'sancas_molduras') {
    const ml = dados.metrosLineares || 10;
    const maoObra = ml * (precos.maoObraPorMl || 60);
    const material = ml * (precos.materialPorMl || 0);
    
    itens.push({
      descricao: `${NOMES_SERVICO[servico]} (Material e Mão de Obra)`,
      quantidade: ml,
      unidade: 'ml',
      valorUnitario: (precos.maoObraPorMl || 60) + (precos.materialPorMl || 0),
      valorTotal: maoObra + material,
    });
  } else {
    const m2 = dados.metragem || 20;
    const maoObra = m2 * precos.maoObraPorM2;
    const material = m2 * precos.materialPorM2;

    itens.push({
      descricao: `${NOMES_SERVICO[servico]} (Material e Mão de Obra)`,
      quantidade: m2,
      unidade: 'm²',
      valorUnitario: precos.maoObraPorM2,
      valorTotal: maoObra,
    });

    // Só adiciona a linha de material extra no PDF se o valor for maior que zero
    if (precos.materialPorM2 > 0) {
      itens.push({
        descricao: 'Material Extra (gesso, perfis, pregos)',
        quantidade: 1,
        unidade: 'kit',
        valorUnitario: material,
        valorTotal: material,
      });
    }
  }

  // Acabamento continua sendo cobrado à parte conforme tabela original
  if (precos.acabamento > 0) {
    itens.push({
      descricao: 'Arremate e acabamento',
      quantidade: 1,
      unidade: 'svc',
      valorUnitario: precos.acabamento,
      valorTotal: precos.acabamento,
    });
  }

  const subtotal = itens.reduce((acc, item) => acc + item.valorTotal, 0);
  const valorDesconto = subtotal * (descontoPct / 100);
  const total = subtotal - valorDesconto;

  return {
    itens,
    subtotal,
    desconto: descontoPct,
    valorDesconto,
    total,
    prazo: PRAZO_SERVICO[servico],
  };
}

export function formatarOrcamento(dados: DadosSessao, orcamento: Orcamento, nomeEmpresa: string): string {
  const servico = NOMES_SERVICO[dados.servico!];
  const linhasItens = orcamento.itens.map((item, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `*${num}.* ${item.descricao}\n     ${item.quantidade} ${item.unidade} × R$ ${item.valorUnitario.toFixed(2)} = *R$ ${item.valorTotal.toFixed(2)}*`;
  });

  return `✅ *Olá, ${dados.nome}! Aqui está o seu orçamento:*

━━━━━━━━━━━━━━━━━━━━━━━
🏗️ *${servico}*
📍 Ambiente: ${dados.ambiente || 'Não informado'}
📐 Acabamento: ${dados.acabamento || 'Padrão'}
📌 Localização: ${dados.localizacao || 'Não informada'}
━━━━━━━━━━━━━━━━━━━━━━━

${linhasItens.join('\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━
💰 Subtotal: R$ ${orcamento.subtotal.toFixed(2)}
🎁 Desconto (${orcamento.desconto}%): -R$ ${orcamento.valorDesconto.toFixed(2)}
💚 *TOTAL FINAL: R$ ${orcamento.total.toFixed(2)}*
━━━━━━━━━━━━━━━━━━━━━━━

⏱️ Prazo estimado: *${orcamento.prazo}*
✔️ Visita técnica inclusa
🔒 Garantia de 1 ano

Para confirmar ou tirar dúvidas, responda *SIM* ou *FALAR COM ATENDENTE*.

_${nomeEmpresa}_`;
}

// ============================================================================
// GERAÇÃO E ENVIO DO PDF
// ============================================================================
export async function gerarEEnviarPdf(sock: any, numeroDoCliente: string, dadosSessaoDoCliente: DadosSessao) {
    const orcamentoCalculado = calcularOrcamento(dadosSessaoDoCliente);
    
    // Limpeza do número movida para o topo da função
    const numeroLimpo = numeroDoCliente.split('@')[0];

    const dadosParaPython = {
        nome: dadosSessaoDoCliente.nome || "Cliente",
        telefone: numeroLimpo,
        servico: NOMES_SERVICO[dadosSessaoDoCliente.servico!],
        metragem: dadosSessaoDoCliente.metragem,
        ambiente: dadosSessaoDoCliente.ambiente || "Não informado",
        acabamento: dadosSessaoDoCliente.acabamento || "Padrão",
        localizacao: dadosSessaoDoCliente.localizacao || "Não informada",
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

    const pdfPath = path.join(__dirname, `orcamento_${numeroLimpo}.pdf`);
    const dadosJsonPath = path.join(__dirname, `dados_${numeroLimpo}.json`);

    fs.writeFileSync(dadosJsonPath, JSON.stringify(dadosParaPython));

    await sock.sendMessage(numeroDoCliente, { text: "⏳ Só um instante, estou a calcular os materiais e a preparar o seu PDF..." });

    exec(`python3 src/gerar_orcamento.py ${dadosJsonPath} ${pdfPath}`, async (error, stdout, stderr) => {
        if (fs.existsSync(dadosJsonPath)) fs.unlinkSync(dadosJsonPath);

        if (error) {
            console.error(`Erro ao gerar PDF: ${error.message}`);
            await sock.sendMessage(numeroDoCliente, { text: "Poxa, ocorreu um erro ao gerar o seu PDF. A nossa equipa técnica já foi avisada!" });
            return;
        }

        if (fs.existsSync(pdfPath)) {
            await sock.sendMessage(numeroDoCliente, { 
                document: { url: pdfPath }, 
                mimetype: 'application/pdf', 
                fileName: `Orcamento_Tavares_Gesso.pdf`,
                caption: `✅ *ORÇAMENTO PRONTO!*\n\nOlá, ${dadosParaPython.nome}!\nAqui está o seu orçamento detalhado em PDF.\n\nPodemos agendar uma visita técnica sem compromisso para tirar as medidas exatas e fechar o pedido?\n\n1 - Sim, quero agendar.\n2 - Ainda estou a pesquisar.` 
            });

            fs.unlinkSync(pdfPath); 
        }
    });
}