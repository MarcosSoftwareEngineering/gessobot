/**
 * humanizer.ts
 * Simula comportamento humano realista no WhatsApp (Motor Baileys)
 * - Delay proporcional ao tamanho da mensagem
 * - Pausa de "leitura" antes de responder
 * - Variação aleatória para parecer natural
 */

import { WASocket } from '@whiskeysockets/baileys';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jitter(base: number, variacao: number): number {
  return base + Math.floor(Math.random() * variacao);
}

/**
 * Simula o tempo de leitura da mensagem recebida
 */
export async function pausaLeitura(textoRecebido: string): Promise<void> {
  const chars = textoRecebido.length;
  // ~200 chars por segundo de leitura, mínimo 800ms, máximo 3s
  const tempoLeitura = Math.min(3000, Math.max(800, chars * 5));
  await delay(jitter(tempoLeitura, 500));
}

/**
 * Simula digitação proporcional ao tamanho da resposta direto via Socket
 */
export async function simulaDigitacao(sock: WASocket, chatId: string, textoResposta: string): Promise<void> {
  const chars = textoResposta.length;
  // ~150 chars por segundo de digitação, mínimo 1s, máximo 5s
  const tempoDigitacao = Math.min(5000, Math.max(1000, chars * 6.5));

  await sock.presenceSubscribe(chatId);
  await sock.sendPresenceUpdate('composing', chatId);
  
  await delay(jitter(tempoDigitacao, 800));
  
  await sock.sendPresenceUpdate('paused', chatId);
}

/**
 * Pausa entre envio de múltiplas mensagens seguidas
 */
export async function pausaEntresMensagens(): Promise<void> {
  await delay(jitter(800, 600));
}

/**
 * Warm-up: nas primeiras horas limita velocidade
 * (reduz risco de ban em números novos)
 */
export function getMultiplicadorWarmup(): number {
  const horasAtivo = getHorasAtivo();
  if (horasAtivo < 24) return 2.5;   // primeiras 24h: respostas mais lentas
  if (horasAtivo < 72) return 1.5;   // 24-72h: moderado
  return 1.0;                        // após 3 dias: normal
}

let inicioBot = Date.now();

export function resetarInicioBot(): void {
  inicioBot = Date.now();
}

function getHorasAtivo(): number {
  return (Date.now() - inicioBot) / (1000 * 60 * 60);
}