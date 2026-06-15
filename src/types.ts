// ==========================================
// ARQUIVO: src/types.ts
// ==========================================

export type TipoServico = 'forro_liso' | 'gesso_parede' | 'sancas_molduras' | 'drywall' | 'gesso_3d';

export type EstadoSessao = 'INICIO' | 'COLETANDO_DADOS' | 'FINALIZADO' | 'BLOQUEIO_ATIVO';

export interface TabelaPrecos {
  materialPorM2: number;
  maoObraPorM2: number;
  maoObraPorMl?: number;
  materialPorMl?: number;
  acabamento: number;
}

export interface ItemOrcamento {
  descricao: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
}

export interface Orcamento {
  itens: ItemOrcamento[];
  subtotal: number;
  desconto: number;
  valorDesconto: number;
  total: number;
  prazo: string;
}

export interface DadosSessao {
  nome?: string;
  telefone?: string;
  endereco?: string;
  localizacao?: string;
  ambiente?: string;
  servico?: TipoServico;
  metragem?: number;
  metrosLineares?: number;
  acabamento?: string;
  bloqueadoAte?: number;
}

export interface Sessao {
  estado: EstadoSessao;
  dados: DadosSessao;
  isProcessing: boolean;
}