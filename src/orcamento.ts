import { TipoServico, DadosSessao, Orcamento, ItemOrcamento, TabelaPrecos } from './types';

const TABELA_PRECOS: Record<TipoServico, TabelaPrecos> = {
  forro_liso: {
    materialPorM2: 18.0,
    maoObraPorM2: 47.0,
    acabamento: 320.0,
  },
  gesso_parede: {
    materialPorM2: 12.0,
    maoObraPorM2: 35.0,
    acabamento: 280.0,
  },
  sancas_molduras: {
    materialPorM2: 0,
    maoObraPorM2: 0,
    maoObraPorMl: 35.0,
    materialPorMl: 18.0,
    acabamento: 0,
  },
  drywall: {
    materialPorM2: 42.0,
    maoObraPorM2: 55.0,
    acabamento: 350.0,
  },
  gesso_3d: {
    materialPorM2: 85.0,
    maoObraPorM2: 65.0,
    acabamento: 400.0,
  },
};

const NOMES_SERVICO: Record<TipoServico, string> = {
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
    const maoObra = ml * (precos.maoObraPorMl || 35);
    const material = ml * (precos.materialPorMl || 18);
    itens.push({
      descricao: NOMES_SERVICO[servico],
      quantidade: ml,
      unidade: 'ml',
      valorUnitario: (precos.maoObraPorMl || 35) + (precos.materialPorMl || 18),
      valorTotal: maoObra + material,
    });
  } else {
    const m2 = dados.metragem || 20;
    const maoObra = m2 * precos.maoObraPorM2;
    const material = m2 * precos.materialPorM2;

    itens.push(
      {
        descricao: NOMES_SERVICO[servico],
        quantidade: m2,
        unidade: 'm²',
        valorUnitario: precos.maoObraPorM2,
        valorTotal: maoObra,
      },
      {
        descricao: 'Material (gesso, perfis, pregos)',
        quantidade: 1,
        unidade: 'kit',
        valorUnitario: material,
        valorTotal: material,
      }
    );
  }

  // Arremate e acabamento
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

  return `✅ *Olá, ${dados.nome}! Aqui está seu orçamento:*

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
