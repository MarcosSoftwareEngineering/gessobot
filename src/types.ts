export type EstadoSessao =
  | 'INICIO'
  | 'AGUARDANDO_NOME'
  | 'MENU_SERVICO'
  | 'AGUARDANDO_METRAGEM'
  | 'AGUARDANDO_METROS_LINEARES'
  | 'AGUARDANDO_AMBIENTE'
  | 'AGUARDANDO_ACABAMENTO'
  | 'AGUARDANDO_LOCALIZACAO'
  | 'CONFIRMANDO_DADOS'
  | 'FINALIZADO'
  | 'BLOQUEIO_ATIVO'; // 👈 Estado adicionado para a regra de 36h

export type TipoServico =
  | 'forro_liso'
  | 'gesso_parede'
  | 'sancas_molduras'
  | 'drywall'
  | 'gesso_3d';

export interface DadosSessao {
  nome?: string;
  servico?: TipoServico;
  metragem?: number;
  metrosLineares?: number;
  ambiente?: string;
  acabamento?: string;
  localizacao?: string;
  bloqueadoAte?: number; // 👈 Propriedade adicionada para controlar o tempo do lead
}

export interface Sessao {
  estado: EstadoSessao;
  dados: DadosSessao;
  isProcessing: boolean;
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

export interface TabelaPrecos {
  materialPorM2: number;
  maoObraPorM2: number;
  maoObraPorMl?: number;
  materialPorMl?: number;
  acabamento: number;
}