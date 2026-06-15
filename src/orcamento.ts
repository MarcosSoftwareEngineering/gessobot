// ==========================================
// ARQUIVO: src/orcamento.ts
// ==========================================
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { TipoServico, DadosSessao, Orcamento, ItemOrcamento, TabelaPrecos } from './types';

// Promisificando o exec para usar async/await de forma limpa
const execAsync = promisify(exec);

// ============================================================================
// TABELA DE PREÇOS — R$ 60,00/m² (mão de obra + material incluso)
// ============================================================================
const PRECO_M2    = 60.0;
const FRETE_FIXO  = 150.0;

const TABELA_PRECOS: Record<TipoServico, TabelaPrecos> = {
  forro_liso:      { materialPorM2: 0, maoObraPorM2: PRECO_M2, acabamento: 0 },
  gesso_parede:    { materialPorM2: 0, maoObraPorM2: PRECO_M2, acabamento: 0 },
  sancas_molduras: { materialPorM2: 0, maoObraPorM2: 0, maoObraPorMl: PRECO_M2, materialPorMl: 0, acabamento: 0 },
  drywall:         { materialPorM2: 0, maoObraPorM2: PRECO_M2, acabamento: 0 },
  gesso_3d:        { materialPorM2: 0, maoObraPorM2: PRECO_M2, acabamento: 0 },
};

export const NOMES_SERVICO: Record<TipoServico, string> = {
  forro_liso:      'Forro de Gesso Liso',
  gesso_parede:    'Gesso em Parede',
  sancas_molduras: 'Sancas e Molduras',
  drywall:         'Drywall / Divisória',
  gesso_3d:        'Gesso 3D / Decorativo',
};

const PRAZO_SERVICO: Record<TipoServico, string> = {
  forro_liso:      '3 a 5 dias úteis',
  gesso_parede:    '2 a 4 dias úteis',
  sancas_molduras: '1 a 3 dias úteis',
  drywall:         '4 a 7 dias úteis',
  gesso_3d:        '5 a 8 dias úteis',
};

// ============================================================================
// CÁLCULO DO ORÇAMENTO
// ============================================================================
export function calcularOrcamento(dados: DadosSessao): Orcamento {
  const servico = dados.servico!;
  const precos  = TABELA_PRECOS[servico];
  const itens: ItemOrcamento[] = [];

  const isSancas = servico === 'sancas_molduras';
  const quantidade = isSancas ? (dados.metrosLineares || 10) : (dados.metragem || 20);
  const unidade = isSancas ? 'ml' : 'm²';
  const valorUnitario = isSancas ? (precos.maoObraPorMl || PRECO_M2) : PRECO_M2;

  itens.push({
    descricao:    `${NOMES_SERVICO[servico]} (Material e Mão de Obra)`,
    quantidade,
    unidade,
    valorUnitario,
    valorTotal:   quantidade * valorUnitario,
  });

  itens.push({
    descricao:    'Frete / Deslocamento',
    quantidade:   1,
    unidade:      'svc',
    valorUnitario: FRETE_FIXO,
    valorTotal:   FRETE_FIXO,
  });

  const subtotal = itens.reduce((acc, i) => acc + i.valorTotal, 0);

  return {
    itens,
    subtotal,
    desconto: 0,
    valorDesconto: 0,
    total: subtotal,
    prazo: PRAZO_SERVICO[servico],
  };
}

// ============================================================================
// FORMATAÇÃO WHATSAPP
// ============================================================================
export function formatarOrcamento(dados: DadosSessao, orcamento: Orcamento, nomeEmpresa: string): string {
  const servico    = NOMES_SERVICO[dados.servico!];
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
🏠 Endereço: ${dados.endereco || 'Não informado'}
━━━━━━━━━━━━━━━━━━━━━━━

${linhasItens.join('\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━
💚 *TOTAL FINAL: R$ ${orcamento.total.toFixed(2)}*
*(Frete de R$ ${FRETE_FIXO.toFixed(2)} já incluso)*
━━━━━━━━━━━━━━━━━━━━━━━

⏱️ Prazo estimado: *${orcamento.prazo}*
✔️ Visita técnica inclusa
🔒 Garantia de 1 ano

Para confirmar ou tirar dúvidas, responda *SIM* ou *FALAR COM ATENDENTE*.

_${nomeEmpresa}_`;
}

// ============================================================================
// GERAÇÃO E ENVIO DO PDF (Blindado contra falhas)
// ============================================================================
export async function gerarEEnviarPdf(
  sock: any,
  numeroDoCliente: string,
  dadosSessaoDoCliente: DadosSessao
) {
  const orcamentoCalculado = calcularOrcamento(dadosSessaoDoCliente);
  const numeroLimpo        = numeroDoCliente.split('@')[0];

  const dadosParaPython = {
    nome:        dadosSessaoDoCliente.nome        || 'Cliente',
    telefone:    numeroLimpo,                          
    endereco:    dadosSessaoDoCliente.endereco    || 'Não informado',
    localizacao: dadosSessaoDoCliente.localizacao || 'Não informada',
    ambiente:    dadosSessaoDoCliente.ambiente    || 'Não informado',
    servico:     NOMES_SERVICO[dadosSessaoDoCliente.servico!],
    metragem:    dadosSessaoDoCliente.metragem    || 0,
    acabamento:  dadosSessaoDoCliente.acabamento  || 'Padrão',
    prazo:       orcamentoCalculado.prazo,
    subtotal:    orcamentoCalculado.subtotal,
    frete:       FRETE_FIXO,
    total:       orcamentoCalculado.total,
    itens:       orcamentoCalculado.itens.map(item => ({
      descricao: item.descricao,
      qtd:       item.quantidade,
      un:        item.unidade,
      unit:      item.valorUnitario,
      total:     item.valorTotal,
    })),
  };

  const pdfPath          = path.join(__dirname, `orcamento_${numeroLimpo}.pdf`);
  const dadosJsonPath    = path.join(__dirname, `temp_dados_${numeroLimpo}.json`);
  const pythonScriptPath = path.join(__dirname, 'gerar_orcamento.py');

  try {
    fs.writeFileSync(dadosJsonPath, JSON.stringify(dadosParaPython, null, 2), 'utf-8');

    await sock.sendMessage(numeroDoCliente, {
      text: '⏳ Só um instante! Estou a calcular os materiais, passar todas as informações para um especialista e a gerar a prévia do seu orçamento...',
    });

    await execAsync(`python3 "${pythonScriptPath}" "${dadosJsonPath}" "${pdfPath}"`);

    if (fs.existsSync(pdfPath)) {
      await sock.sendMessage(numeroDoCliente, {
        document:  { url: pdfPath },
        mimetype:  'application/pdf',
        fileName:  `Orcamento_Tavares_Gesso.pdf`,
        caption:
          `✅ *ORÇAMENTO PRONTO!*\n\n` +
          `Olá, ${dadosParaPython.nome}!\n` +
          `Aqui está o seu orçamento detalhado em PDF.\n\n` +
          `Podemos agendar uma visita técnica sem compromisso para tirar as medidas exatas e fechar o pedido?\n\n` +
          `1️⃣ - Sim, quero agendar.\n` +
          `2️⃣ - Ainda estou a pesquisar.`,
      });
    }

  } catch (error: any) {
    console.error(`[ERRO] Falha ao gerar PDF:`, error.message);
    await sock.sendMessage(numeroDoCliente, {
      text: '❌ Ocorreu um erro ao gerar o seu documento. A nossa equipa já foi notificada.',
    });
  } finally {
    if (fs.existsSync(dadosJsonPath)) fs.unlinkSync(dadosJsonPath);
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
  }
}