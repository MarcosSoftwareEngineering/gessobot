/**
 * queue.ts
 * Fila de processamento de mensagens (Motor Baileys)
 * - Processa uma mensagem por vez por usuário
 * - Evita respostas duplicadas ou fora de ordem
 * - Descarta mensagens muito antigas
 */

import { WASocket, proto } from '@whiskeysockets/baileys';

type Handler = (sock: WASocket, msg: proto.IWebMessageInfo) => Promise<void>;

const filas = new Map<string, proto.IWebMessageInfo[]>();
const processando = new Set<string>();

const MAX_IDADE_MSG_MS = 5 * 60 * 1000; // ignora mensagens com mais de 5 min

export async function enfileirar(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  handler: Handler
): Promise<void> {
  // Extrai o timestamp (o Baileys pode retornar Number ou Long)
  const timestamp = Number(msg.messageTimestamp || Math.floor(Date.now() / 1000));
  const idadeMsg = Date.now() - (timestamp * 1000);
  
  if (idadeMsg > MAX_IDADE_MSG_MS) {
    console.log(`⏭️  Mensagem antiga ignorada (${Math.floor(idadeMsg / 1000)}s atrás)`);
    return;
  }

  const numero = msg.key.remoteJid;
  if (!numero) return;

  if (!filas.has(numero)) {
    filas.set(numero, []);
  }

  filas.get(numero)!.push(msg);

  if (!processando.has(numero)) {
    await processarFila(sock, numero, handler);
  }
}

async function processarFila(
  sock: WASocket,
  numero: string,
  handler: Handler
): Promise<void> {
  processando.add(numero);

  const fila = filas.get(numero) || [];

  while (fila.length > 0) {
    const msg = fila.shift()!;

    const timestamp = Number(msg.messageTimestamp || Math.floor(Date.now() / 1000));
    const idadeMsg = Date.now() - (timestamp * 1000);
    
    if (idadeMsg > MAX_IDADE_MSG_MS) {
      console.log(`⏭️  Pulando mensagem expirada na fila`);
      continue;
    }

    try {
      await handler(sock, msg);
    } catch (err) {
      console.error(`❌ Erro ao processar mensagem de ${numero}:`, err);
    }
  }

  processando.delete(numero);
  filas.delete(numero);
}