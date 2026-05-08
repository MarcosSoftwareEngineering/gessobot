/**
 * filtros.ts - Adaptado para @whiskeysockets/baileys
 */

import { proto, WASocket } from '@whiskeysockets/baileys';

export interface ResultadoFiltro {
  bloqueado: boolean;
  motivo?: string;
}

export async function aplicarFiltros(
  msg: proto.IWebMessageInfo,
  sock: WASocket
): Promise<ResultadoFiltro> {
  
  const remoteJid = msg.key?.remoteJid || '';
  const fromMe = msg.key?.fromMe ?? false;

  // 1. Ignorar mensagens do próprio bot
  if (fromMe) {
    return { bloqueado: true, motivo: 'mensagem própria' };
  }

  // 2. Ignorar status/stories
  if (remoteJid === 'status@broadcast') {
    return { bloqueado: true, motivo: 'status/story' };
  }

  // 3. Ignorar grupos
  if (remoteJid.endsWith('@g.us')) {
    return { bloqueado: true, motivo: 'grupo' };
  }

  // 4. Ignorar canais/newsletters
  if (remoteJid.endsWith('@newsletter') || remoteJid.includes('@newsletter')) {
    return { bloqueado: true, motivo: 'canal' };
  }

  // 5. Ignorar broadcasts
  if (remoteJid.includes('@broadcast')) {
    return { bloqueado: true, motivo: 'broadcast' };
  }

  // 6. Ignorar mensagens vazias
  const body = msg.message?.conversation 
    || msg.message?.extendedTextMessage?.text 
    || '';
  const hasMedia = !!(
    msg.message?.imageMessage ||
    msg.message?.videoMessage ||
    msg.message?.audioMessage ||
    msg.message?.documentMessage ||
    msg.message?.stickerMessage
  );

  if (!body.trim() && !hasMedia) {
    return { bloqueado: true, motivo: 'mensagem vazia' };
  }

  // 7. Permitir apenas contatos padrão
  const isAuthorized = remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid');
  if (!isAuthorized) {
    return { bloqueado: true, motivo: 'mensagem suspeita' };
  }

  return { bloqueado: false };
}