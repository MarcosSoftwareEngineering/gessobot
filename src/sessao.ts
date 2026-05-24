import { query } from './db/database';
import { Sessao, EstadoSessao, DadosSessao } from './types';

const cache = new Map<string, Sessao>();

export async function getSessao(numero: string): Promise<Sessao> {
  if (cache.has(numero)) return cache.get(numero)!;

  const result = await query(
    'SELECT estado, dados FROM sessoes WHERE numero_cliente = $1',
    [numero]
  );

  if (result.rows.length > 0) {
    const row = result.rows[0];
    const dados = JSON.parse(row.dados || '{}');
    
    // Verificação de segurança: Checa se o usuário está no período de silêncio (36h)
    if (dados.bloqueadoAte && Date.now() < dados.bloqueadoAte) {
       // Continua bloqueado
       return { estado: 'BLOQUEIO_ATIVO', dados, isProcessing: false };
    } else if (dados.bloqueadoAte && Date.now() >= dados.bloqueadoAte) {
       // O tempo passou! Limpa o bloqueio e reseta a sessão
       await resetarSessao(numero);
       return { estado: 'INICIO', dados: {}, isProcessing: false };
    }

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
}

export async function salvarSessao(numero: string, sessao: Sessao): Promise<void> {
  cache.set(numero, sessao);

  await query(
    `INSERT INTO sessoes (numero_cliente, estado, dados, ultimo_acesso)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (numero_cliente) DO UPDATE SET
       estado = EXCLUDED.estado,
       dados = EXCLUDED.dados,
       ultimo_acesso = NOW()`,
    [numero, sessao.estado, JSON.stringify(sessao.dados)]
  );
}

export async function resetarSessao(numero: string): Promise<void> {
  const sessao: Sessao = { estado: 'INICIO', dados: {}, isProcessing: false };
  await salvarSessao(numero, sessao);
}

export async function ativarBloqueio36h(numero: string, sessao: Sessao): Promise<void> {
  // 36 horas em milissegundos: 36 * 60 * 60 * 1000 = 129600000
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
}