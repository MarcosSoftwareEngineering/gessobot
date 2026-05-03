/**
 * queue.ts
 * Fila de processamento de mensagens
 * - Processa uma mensagem por vez por usuário
 * - Evita respostas duplicadas ou fora de ordem
 * - Descarta mensagens muito antigas
 */

import { Client, Message } from 'whatsapp-web.js';

type Handler = (client: Client, msg: Message) => Promise<void>;

const filas = new Map<string, Message[]>();
const processando = new Set<string>();

const MAX_IDADE_MSG_MS = 5 * 60 * 1000; // ignora mensagens com mais de 5 min

export async function enfileirar(
  client: Client,
  msg: Message,
  handler: Handler
): Promise<void> {
  // Verificar idade da mensagem
  const idadeMsg = Date.now() - msg.timestamp * 1000;
  if (idadeMsg > MAX_IDADE_MSG_MS) {
    console.log(`⏭️  Mensagem antiga ignorada (${Math.floor(idadeMsg / 1000)}s atrás)`);
    return;
  }

  const numero = msg.from;

  if (!filas.has(numero)) {
    filas.set(numero, []);
  }

  filas.get(numero)!.push(msg);

  if (!processando.has(numero)) {
    await processarFila(client, numero, handler);
  }
}

async function processarFila(
  client: Client,
  numero: string,
  handler: Handler
): Promise<void> {
  processando.add(numero);

  const fila = filas.get(numero) || [];

  while (fila.length > 0) {
    const msg = fila.shift()!;

    // Verificar novamente a idade antes de processar
    const idadeMsg = Date.now() - msg.timestamp * 1000;
    if (idadeMsg > MAX_IDADE_MSG_MS) {
      console.log(`⏭️  Pulando mensagem expirada na fila`);
      continue;
    }

    try {
      await handler(client, msg);
    } catch (err) {
      console.error(`❌ Erro ao processar mensagem de ${numero}:`, err);
    }
  }

  processando.delete(numero);
  filas.delete(numero);
}
