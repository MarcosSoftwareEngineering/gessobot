/**
 * filtros.ts - Adaptado para @whiskeysockets/baileys
 */

import { proto, WASocket } from '@whiskeysockets/baileys';

export interface ResultadoFiltro {
  bloqueado: boolean;
  motivo?: string;
}

// ==========================================
// CONFIGURAÇÃO ANTI-BOT
// ==========================================

// JIDs de bots conhecidos que devem ser sempre ignorados.
// Pode popular via env: BOT_JIDS="5511999999999@s.whatsapp.net,5511888888888@s.whatsapp.net"
const BOT_JIDS = new Set(
  (process.env.BOT_JIDS || '')
    .split(',')
    .map(j => j.trim())
    .filter(Boolean)
);

// Palavras-chave que, combinadas com sinais de automação, indicam bot
const BOT_NAME_HINTS = ['bot', 'assistant', 'assistente', 'automation', 'automatico', 'automático'];

/**
 * Heurística para detectar se a mensagem vem de outro bot/sistema automatizado.
 * Não é 100% garantido (o WhatsApp não expõe um campo oficial "isBot"),
 * mas cobre os casos mais comuns.
 */
function isProvavelBot(msg: proto.IWebMessageInfo): boolean {
  const remoteJid = msg.key?.remoteJid || '';

  // 1. JID está na lista de bots conhecidos
  if (BOT_JIDS.has(remoteJid)) return true;

  // 2. Conta business verificada com nome sugerindo bot
  const verifiedBizName = (msg as any).verifiedBizName as string | undefined;
  if (verifiedBizName && BOT_NAME_HINTS.some(hint => verifiedBizName.toLowerCase().includes(hint))) {
    return true;
  }

  // 3. pushName sugerindo bot
  const pushName = msg.pushName || '';
  if (pushName && BOT_NAME_HINTS.some(hint => pushName.toLowerCase().includes(hint))) {
    return true;
  }

  // 4. Mensagens de sistema/protocolo (geralmente originadas por automações, não por humanos)
  if (msg.message?.protocolMessage) return true;

  return false;
}

// ==========================================
// FUNÇÃO EXTRATORA SUPREMA
// ==========================================
export function extrairTexto(msg: proto.IWebMessageInfo): string {
    const m = msg.message;
    if (!m) return "";

    return m.conversation || 
           m.extendedTextMessage?.text || 
           m.ephemeralMessage?.message?.extendedTextMessage?.text || 
           m.ephemeralMessage?.message?.conversation || 
           m.imageMessage?.caption || 
           "";
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

  // 6. Ignorar outros bots/sistemas automatizados
  if (isProvavelBot(msg)) {
    return { bloqueado: true, motivo: 'bot/sistema automatizado' };
  }

  // 7. Ignorar mensagens vazias (AGORA BLINDADO)
  const body = extrairTexto(msg);
  
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

  // 8. Permitir apenas contatos padrão
  const isAuthorized = remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid');
  if (!isAuthorized) {
    return { bloqueado: true, motivo: 'mensagem suspeita' };
  }

  return { bloqueado: false };
}
