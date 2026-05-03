import { Client, Message } from 'whatsapp-web.js';
import { getSessao, salvarSessao, resetarSessao, salvarOrcamentoDB } from './sessao';
import { calcularOrcamento, formatarOrcamento } from './orcamento';
import { TipoServico, Sessao } from './types';
import { simulaDigitacao, pausaLeitura, pausaEntresMensagens, getMultiplicadorWarmup } from './humanizer';
import { verificarRateLimit } from './rateLimit';
import { aplicarFiltros } from './filtros';

const NOME_EMPRESA = process.env.NOME_EMPRESA || 'GessoBot Construções';
const NUMERO_ATENDENTE = process.env.NUMERO_ATENDENTE || '';
const DESCONTO_PADRAO = parseInt(process.env.DESCONTO_PADRAO || '5', 10);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function enviarMensagem(client: Client, chat: any, texto: string): Promise<void> {
  const multiplicador = getMultiplicadorWarmup();
  await simulaDigitacao(chat, texto);
  await delay(Math.floor(300 * multiplicador));
  await client.sendMessage(chat.id._serialized, texto);
  await pausaEntresMensagens();
}

function menuPrincipal(): string {
  return `🏗️ *Bem-vindo ao GessoBot!*
_Automação Inteligente para Orçamentos de Gesso_

Qual serviço você precisa orçar?

1️⃣ Forro de Gesso Liso
2️⃣ Gesso em Parede
3️⃣ Sancas e Molduras
4️⃣ Drywall / Divisória
5️⃣ Gesso 3D / Decorativo

Digite o *número* da opção desejada.`;
}

function menuAcabamento(): string {
  return `🎨 Qual tipo de acabamento você prefere?

1️⃣ Liso (padrão)
2️⃣ Texturizado
3️⃣ Premium / Rebaixado

Digite o número da opção.`;
}

export async function processarMensagem(client: Client, msg: Message): Promise<void> {
  // 1. Filtros: grupos, canais, status, broadcasts
  const filtro = await aplicarFiltros(msg);
  if (filtro.bloqueado) {
    console.log(`🚫 Mensagem bloqueada: ${filtro.motivo}`);
    return;
  }

  const numero = msg.from;
  const texto = msg.body?.trim().toLowerCase() || '';

  // 2. Rate limit
  const limite = verificarRateLimit(numero);
  if (!limite.permitido) {
    console.log(`⏳ Rate limit para ${numero}: ${limite.motivo}`);
    return;
  }

  // 3. Pausa de "leitura" antes de responder
  await pausaLeitura(msg.body || '');

  // 4. Buscar sessão
  const sessao = await getSessao(numero);

  // Evita processamento duplo
  if (sessao.isProcessing) return;
  sessao.isProcessing = true;
  await salvarSessao(numero, sessao);

  try {
    const chat = await msg.getChat();
    await rotearMensagem(client, chat, numero, texto, sessao);
  } finally {
    sessao.isProcessing = false;
    await salvarSessao(numero, sessao);
  }
}

async function rotearMensagem(
  client: Client,
  chat: any,
  numero: string,
  texto: string,
  sessao: Sessao
): Promise<void> {
  // Comando de reset global
  if (['cancelar', 'sair', 'reiniciar', 'menu', 'início', 'inicio'].includes(texto)) {
    await resetarSessao(numero);
    const s = await getSessao(numero);
    Object.assign(sessao, s);
    await enviarMensagem(client, chat, `🔄 Sessão reiniciada!\n\n${menuPrincipal()}`);
    sessao.estado = 'MENU_SERVICO';
    return;
  }

  // Encaminhar para atendente
  if (['falar com atendente', 'atendente', 'humano', 'pessoa'].some((k) => texto.includes(k))) {
    const link = `https://wa.me/${NUMERO_ATENDENTE}`;
    await enviarMensagem(
      client,
      chat,
      `👨‍💼 Vou te conectar com nosso atendente!\n\nClique aqui para falar diretamente: ${link}\n\nOu aguarde, ele retornará em breve. 😊`
    );
    await resetarSessao(numero);
    Object.assign(sessao, { estado: 'INICIO', dados: {} });
    return;
  }

  switch (sessao.estado) {
    case 'INICIO':
      await enviarMensagem(
        client,
        chat,
        `👋 Olá! Antes de começar, qual é o seu *nome*?`
      );
      sessao.estado = 'AGUARDANDO_NOME';
      break;

    case 'AGUARDANDO_NOME':
      sessao.dados.nome = capitalize(texto);
      await enviarMensagem(
        client,
        chat,
        `Prazer, *${sessao.dados.nome}*! 😄\n\n${menuPrincipal()}`
      );
      sessao.estado = 'MENU_SERVICO';
      break;

    case 'MENU_SERVICO': {
      const mapa: Record<string, TipoServico> = {
        '1': 'forro_liso',
        '2': 'gesso_parede',
        '3': 'sancas_molduras',
        '4': 'drywall',
        '5': 'gesso_3d',
      };
      const servico = mapa[texto];
      if (!servico) {
        await enviarMensagem(client, chat, `⚠️ Por favor, digite um número de *1 a 5* para escolher o serviço.`);
        break;
      }
      sessao.dados.servico = servico;

      if (servico === 'sancas_molduras') {
        await enviarMensagem(
          client,
          chat,
          `📏 Quantos *metros lineares* de sancas/molduras você precisa?\n\nEx: _18_ ou _25.5_`
        );
        sessao.estado = 'AGUARDANDO_METROS_LINEARES';
      } else {
        await enviarMensagem(
          client,
          chat,
          `📐 Qual é a *metragem* (m²) do ambiente?\n\nEx: _45_ ou _30.5_`
        );
        sessao.estado = 'AGUARDANDO_METRAGEM';
      }
      break;
    }

    case 'AGUARDANDO_METRAGEM': {
      const valor = parseFloat(texto.replace(',', '.'));
      if (isNaN(valor) || valor <= 0) {
        await enviarMensagem(client, chat, `⚠️ Por favor, informe a metragem em m². Ex: _45_ ou _30.5_`);
        break;
      }
      sessao.dados.metragem = valor;
      await enviarMensagem(client, chat, `🏠 Qual é o *ambiente*?\n\nEx: _Sala, Quarto, Cozinha, Banheiro, Escritório..._`);
      sessao.estado = 'AGUARDANDO_AMBIENTE';
      break;
    }

    case 'AGUARDANDO_METROS_LINEARES': {
      const valor = parseFloat(texto.replace(',', '.'));
      if (isNaN(valor) || valor <= 0) {
        await enviarMensagem(client, chat, `⚠️ Por favor, informe os metros lineares. Ex: _18_ ou _25.5_`);
        break;
      }
      sessao.dados.metrosLineares = valor;
      await enviarMensagem(client, chat, `🏠 Qual é o *ambiente*?\n\nEx: _Sala, Quarto, Varanda..._`);
      sessao.estado = 'AGUARDANDO_AMBIENTE';
      break;
    }

    case 'AGUARDANDO_AMBIENTE':
      sessao.dados.ambiente = capitalize(texto);
      await enviarMensagem(client, chat, menuAcabamento());
      sessao.estado = 'AGUARDANDO_ACABAMENTO';
      break;

    case 'AGUARDANDO_ACABAMENTO': {
      const acabamentos: Record<string, string> = {
        '1': 'Liso (padrão)',
        '2': 'Texturizado',
        '3': 'Premium / Rebaixado',
      };
      sessao.dados.acabamento = acabamentos[texto] || capitalize(texto);
      await enviarMensagem(
        client,
        chat,
        `📍 Por último, qual é a sua *localização* (cidade/bairro)?\n\nEx: _São Paulo - SP_, _Fortaleza - CE_`
      );
      sessao.estado = 'AGUARDANDO_LOCALIZACAO';
      break;
    }

    case 'AGUARDANDO_LOCALIZACAO': {
      sessao.dados.localizacao = capitalize(texto);

      // Calcular orçamento
      const orcamento = calcularOrcamento(sessao.dados, DESCONTO_PADRAO);
      const mensagemOrcamento = formatarOrcamento(sessao.dados, orcamento, NOME_EMPRESA);

      await enviarMensagem(client, chat, `⏳ Calculando seu orçamento...`);
      await delay(1500);
      await enviarMensagem(client, chat, mensagemOrcamento);

      // Salvar no banco
      const prazoNum = parseInt(orcamento.prazo.split(' ')[2] || '5');
      await salvarOrcamentoDB(
        numero,
        sessao.dados,
        orcamento.subtotal,
        orcamento.total,
        orcamento.desconto,
        prazoNum
      );

      sessao.estado = 'FINALIZADO';
      break;
    }

    case 'FINALIZADO':
      if (texto.includes('sim') || texto === 's') {
        await enviarMensagem(
          client,
          chat,
          `✅ *Ótimo! Orçamento confirmado!*\n\nNosso atendente entrará em contato em breve para agendar a visita técnica.\n\nObrigado por escolher a *${NOME_EMPRESA}*! 🏗️`
        );
        await resetarSessao(numero);
        Object.assign(sessao, { estado: 'INICIO', dados: {} });
      } else {
        await enviarMensagem(
          client,
          chat,
          `Quer fazer um *novo orçamento* ou falar com um *atendente*?\n\nDigite:\n• *novo* — para novo orçamento\n• *atendente* — para falar com humano`
        );
        if (texto === 'novo') {
          await resetarSessao(numero);
          Object.assign(sessao, { estado: 'INICIO', dados: {} });
          await enviarMensagem(client, chat, menuPrincipal());
          sessao.estado = 'MENU_SERVICO';
        }
      }
      break;

    default:
      await enviarMensagem(client, chat, `👋 ${menuPrincipal()}`);
      sessao.estado = 'MENU_SERVICO';
  }
}

function capitalize(str: string): string {
  return str
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
