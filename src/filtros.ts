/**
 * filtros.ts
 * Filtra mensagens que o bot NÃO deve responder:
 * - Grupos do WhatsApp
 * - Canais do WhatsApp
 * - Status / Stories
 * - Broadcasts (listas de transmissão)
 * - Mensagens do próprio bot
 * - Mensagens de sistema
 */

import { Message, Chat } from 'whatsapp-web.js';

export interface ResultadoFiltro {
  bloqueado: boolean;
  motivo?: string;
}

export async function aplicarFiltros(msg: Message): Promise<ResultadoFiltro> {
  // 1. Ignorar mensagens do próprio bot
  if (msg.fromMe) {
    return { bloqueado: true, motivo: 'mensagem própria' };
  }

  // 2. Ignorar status/stories do WhatsApp
  if (msg.from === 'status@broadcast') {
    return { bloqueado: true, motivo: 'status/story' };
  }

  // 3. Ignorar broadcasts (listas de transmissão)
  if (msg.broadcast) {
    return { bloqueado: true, motivo: 'broadcast' };
  }

  // 4. Ignorar mensagens de sistema (sem corpo)
  if (!msg.body || msg.body.trim() === '') {
    // Permite apenas se for sticker ou imagem com legenda — mas para bot de orçamento, ignora
    if (!msg.hasMedia) {
      return { bloqueado: true, motivo: 'mensagem vazia' };
    }
  }

  // 5. Verificar o chat para grupos e canais
  let chat: Chat;
  try {
    chat = await msg.getChat();
  } catch {
    return { bloqueado: true, motivo: 'erro ao obter chat' };
  }

  // 6. Ignorar grupos
  if (chat.isGroup) {
    return { bloqueado: true, motivo: 'grupo' };
  }

  // 7. Ignorar canais do WhatsApp (newsletter)
  // @ts-ignore - isChannel pode não estar nos tipos mas existe na API
  if (chat.isChannel || chat.isNewsletter || msg.from.includes('@newsletter')) {
    return { bloqueado: true, motivo: 'canal' };
  }

  // 8. Ignorar chats arquivados ou silenciados de sistema
  if (msg.from.includes('@g.us')) {
    return { bloqueado: true, motivo: 'grupo (by ID)' };
  }

  // 9. Ignorar IDs de sistema do WhatsApp
  const idsistema = ['@broadcast', '@newsletter', 'status@broadcast', 'broadcast'];
  if (idsistema.some((s) => msg.from.includes(s))) {
    return { bloqueado: true, motivo: 'ID de sistema' };
  }

  return { bloqueado: false };
}
