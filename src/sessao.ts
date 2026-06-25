import { query } from './db/database';
import { Sessao, EstadoSessao, DadosSessao } from './types';

const cache = new Map<string, Sessao>();

// Fila de "pendências" de salvamento no banco — sessões que falharam ao salvar
// e devem ser tentadas novamente quando o banco voltar.
const pendentesSalvar = new Set<string>();

/**
 * Limpa todo o cache de sessões em memória.
 * Útil ao resetar o bot (botão "Resetar" no painel) para garantir que
 * nenhuma sessão antiga de clientes fique "presa" em memória.
 */
export function limparCacheSessoes(): void {
  const total = cache.size;
  cache.clear();
  pendentesSalvar.clear();
  console.log(`🧹 Cache de sessões limpo (${total} sessão(ões) removida(s) da memória).`);
}

export async function getSessao(numero: string): Promise<Sessao> {
  // 1. Sempre prioriza o cache em memória (rápido e não depende do banco)
  if (cache.has(numero)) return cache.get(numero)!;

  try {
    const result = await query(
      'SELECT estado, dados FROM sessoes WHERE numero_cliente = $1',
      [numero]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const dados = JSON.parse(row.dados || '{}');

      /* // 🛡️ Lógica de bloqueio comentada para testes
      if (dados.bloqueadoAte && Date.now() < dados.bloqueadoAte) {
         return { estado: 'BLOQUEIO_ATIVO', dados, isProcessing: false };
      } else if (dados.bloqueadoAte && Date.now() >= dados.bloqueadoAte) {
         await resetarSessao(numero);
         return { estado: 'INICIO', dados: {}, isProcessing: false };
      }
      */

      const sessao: Sessao = {
        estado: (row.estado as EstadoSessao) || 'INICIO',
        dados: dados,
        isProcessing: false,
      };
      cache.set(numero, sessao);
      return sessao;
    }

    const novaSessao: Sessao = { estado: 'INICIO', dados: {}, isProcessing: false };
    cache.set(numero, novaSessao);
    return novaSessao;

  } catch (error) {
    // 🛟 FALLBACK: banco indisponível (cota excedida, hibernando, instável, etc.)
    // Em vez de travar o bot, seguimos com uma sessão nova em memória.
    // O cliente continua sendo atendido normalmente; só perdemos histórico
    // se o processo reiniciar antes do banco voltar.
    console.error(`⚠️ [DB OFFLINE] Falha ao buscar sessão de ${numero}, usando fallback em memória:`, (error as Error).message);

    const sessaoFallback: Sessao = { estado: 'INICIO', dados: {}, isProcessing: false };
    cache.set(numero, sessaoFallback);
    return sessaoFallback;
  }
}

export async function salvarSessao(numero: string, sessao: Sessao): Promise<void> {
  // 1. Cache sempre é atualizado primeiro — garante que o bot continue
  // funcionando mesmo se o banco estiver fora do ar.
  cache.set(numero, sessao);

  try {
    await query(
      `INSERT INTO sessoes (numero_cliente, estado, dados, ultimo_acesso)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (numero_cliente) DO UPDATE SET
         estado = EXCLUDED.estado,
         dados = EXCLUDED.dados,
         ultimo_acesso = NOW()`,
      [numero, sessao.estado, JSON.stringify(sessao.dados)]
    );

    // Se salvou com sucesso e estava marcado como pendente, remove da fila
    if (pendentesSalvar.has(numero)) {
      pendentesSalvar.delete(numero);
      console.log(`✅ [DB RECUPERADO] Sessão de ${numero} sincronizada com sucesso.`);
    }

  } catch (error) {
    // 🛟 FALLBACK: não derruba o fluxo do bot. A sessão já está no cache
    // (em memória) e o cliente continua sendo atendido normalmente.
    // Marcamos como pendente para possível nova tentativa futura.
    pendentesSalvar.add(numero);
    console.error(`⚠️ [DB OFFLINE] Falha ao salvar sessão de ${numero} (mantida em memória):`, (error as Error).message);
  }
}

export async function resetarSessao(numero: string): Promise<void> {
  const sessao: Sessao = { estado: 'INICIO', dados: {}, isProcessing: false };
  await salvarSessao(numero, sessao);
}

export async function ativarBloqueio36h(numero: string, sessao: Sessao): Promise<void> {
  const trintaESeisHoras = 129600000;

  sessao.estado = 'BLOQUEIO_ATIVO';
  sessao.dados.bloqueadoAte = Date.now() + trintaESeisHoras;

  await salvarSessao(numero, sessao);
}

export function formatarMensagemLead(dados: DadosSessao, telefoneCliente: string): string {
    return `🚨 *NOVO LEAD CAPTURADO* 🚨\n\n` +
            `👤 *Nome:* ${dados.nome}\n` +
            `📱 *WhatsApp:* ${telefoneCliente.replace('@c.us', '')}\n` +
            `🛠️ *Serviço:* ${dados.servico}\n` +
            `📏 *Metragem:* ${dados.metragem} m²\n` +
            `📍 *Localização:* ${dados.localizacao || 'Não informada'}\n\n` +
            `📄 _O orçamento em PDF gerado para este cliente está em anexo._`;
}

export async function salvarOrcamentoDB(
  numero: string,
  dados: DadosSessao,
  valorTotal: number,
  valorFinal: number,
  desconto: number,
  prazo: number
): Promise<void> {
  try {
    await query(
      `INSERT INTO orcamentos
       (numero_cliente, nome_cliente, servico, metragem, metros_lineares, ambiente, acabamento, localizacao, valor_total, desconto, valor_final, prazo_dias, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'enviado')`,
      [
        numero,
        dados.nome || null,
        dados.servico || null,
        dados.metragem || null,
        dados.metrosLineares || null,
        dados.ambiente || null,
        dados.acabamento || null,
        dados.localizacao || null,
        valorTotal,
        desconto,
        valorFinal,
        prazo,
      ]
    );

    await query(
      `INSERT INTO clientes (numero, nome, total_orcamentos, ultimo_contato)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (numero) DO UPDATE SET
         nome = EXCLUDED.nome,
         total_orcamentos = clientes.total_orcamentos + 1,
         ultimo_contato = NOW()`,
      [numero, dados.nome || null]
    );
  } catch (error) {
    // 🛟 FALLBACK: não impede o bot de responder ao cliente nem de gerar o PDF.
    // Apenas o registro histórico no banco (lead) não foi salvo.
    // O administrador ainda recebe o PDF e o texto do lead via WhatsApp (em bot.ts),
    // então a informação não se perde totalmente — só não fica no banco.
    console.error(`⚠️ [DB OFFLINE] Falha ao salvar orçamento/cliente de ${numero} no banco:`, (error as Error).message);
  }
}