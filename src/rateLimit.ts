/**
 * rateLimit.ts
 * Proteção contra flood e comportamento suspeito
 * - Limite de mensagens por usuário por hora
 * - Cooldown entre mensagens do mesmo usuário
 * - Detecção de spam
 */

interface UserLimit {
  mensagensHora: number;
  ultimaMensagem: number;
  resetHora: number;
  bloqueadoAte: number;
}

const limites = new Map<string, UserLimit>();

const CONFIG = {
  MAX_MSGS_POR_HORA: 30,       // máximo de mensagens por usuário por hora
  COOLDOWN_MS: 1500,            // mínimo entre mensagens do mesmo usuário (ms)
  BLOQUEIO_MS: 10 * 60 * 1000, // bloqueia por 10min se exceder limite
};

export function verificarRateLimit(numero: string): {
  permitido: boolean;
  motivo?: string;
} {
  const agora = Date.now();
  const limite = limites.get(numero) || {
    mensagensHora: 0,
    ultimaMensagem: 0,
    resetHora: agora + 3600000,
    bloqueadoAte: 0,
  };

  // Verificar se está bloqueado
  if (limite.bloqueadoAte > agora) {
    const restante = Math.ceil((limite.bloqueadoAte - agora) / 60000);
    return { permitido: false, motivo: `bloqueado por ${restante} min` };
  }

  // Reset do contador a cada hora
  if (agora > limite.resetHora) {
    limite.mensagensHora = 0;
    limite.resetHora = agora + 3600000;
  }

  // Verificar cooldown entre mensagens
  const tempoDesdeUltima = agora - limite.ultimaMensagem;
  if (tempoDesdeUltima < CONFIG.COOLDOWN_MS) {
    return { permitido: false, motivo: 'cooldown' };
  }

  // Verificar limite por hora
  if (limite.mensagensHora >= CONFIG.MAX_MSGS_POR_HORA) {
    limite.bloqueadoAte = agora + CONFIG.BLOQUEIO_MS;
    limites.set(numero, limite);
    return { permitido: false, motivo: 'limite por hora excedido' };
  }

  // Atualizar contadores
  limite.mensagensHora++;
  limite.ultimaMensagem = agora;
  limites.set(numero, limite);

  return { permitido: true };
}

export function limparLimitesAntigos(): void {
  const agora = Date.now();
  for (const [numero, limite] of limites.entries()) {
    // Remove entradas inativas há mais de 2 horas
    if (agora - limite.ultimaMensagem > 7200000) {
      limites.delete(numero);
    }
  }
}

// Limpa entradas antigas a cada 30 minutos
setInterval(limparLimitesAntigos, 30 * 60 * 1000);
