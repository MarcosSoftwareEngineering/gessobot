# 🏗️ GessoBot — Automação Inteligente para Orçamentos de Gesso

Bot WhatsApp que gera orçamentos de gesso automaticamente, com banco de dados Turso (SQLite na nuvem) e hospedagem gratuita 24h no Railway.

---

## 🚀 Funcionalidades

- ✅ Orçamentos automáticos em segundos
- ✅ 5 tipos de serviço (Forro, Parede, Sancas, Drywall, Gesso 3D)
- ✅ Banco de dados Turso — histórico de todos os orçamentos
- ✅ Sessões persistentes — cliente não perde o progresso
- ✅ Encaminhamento para atendente humano
- ✅ Descontos configuráveis
- ✅ Rodando 24h no Railway (gratuito)

---

## 📋 Pré-requisitos

- Node.js 18+
- Conta no [Turso](https://turso.tech) (gratuita)
- Conta no [Railway](https://railway.app) (gratuita)
- Número WhatsApp dedicado para o bot

---

## ⚙️ Configuração

### 1. Clonar e instalar

```bash
git clone <seu-repositorio>
cd gessobot
npm install
```

### 2. Configurar o Turso

```bash
# Instalar CLI do Turso
curl -sSfL https://get.tur.so/install.sh | bash

# Fazer login
turso auth login

# Criar banco de dados
turso db create gessobot

# Pegar a URL do banco
turso db show gessobot --url

# Criar token de autenticação
turso db tokens create gessobot
```

### 3. Configurar variáveis de ambiente

Copie o arquivo `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

```env
TURSO_DATABASE_URL=libsql://gessobot-seuusuario.turso.io
TURSO_AUTH_TOKEN=seu-token-aqui
NUMERO_ATENDENTE=5511999999999
NOME_EMPRESA=Sua Empresa de Gesso
DESCONTO_PADRAO=5
```

### 4. Rodar localmente

```bash
npm run dev
```

Escaneie o QR Code com o WhatsApp e o bot estará ativo!

---

## 🌐 Deploy no Railway (24h grátis)

### 1. Criar repositório no GitHub

```bash
git init
git add .
git commit -m "feat: GessoBot v1.0"
git remote add origin https://github.com/seuusuario/gessobot.git
git push -u origin main
```

### 2. Configurar Railway

1. Acesse [railway.app](https://railway.app) e faça login com GitHub
2. Clique em **New Project** → **Deploy from GitHub repo**
3. Selecione o repositório `gessobot`
4. Vá em **Variables** e adicione todas as variáveis do `.env`
5. O Railway detecta o `Dockerfile` automaticamente e faz o deploy

### 3. QR Code no servidor

Na primeira execução, o QR Code aparece nos **logs do Railway**:
- Vá em **Deployments** → clique no deploy ativo → **View Logs**
- Escaneie o QR Code com o WhatsApp

> ⚠️ Após escanear, a sessão fica salva em `.wwebjs_auth` — não precisa escanear de novo!

---

## 📊 Tabela de Preços (editável em `src/orcamento.ts`)

| Serviço | Material/m² | Mão de Obra/m² | Acabamento |
|---------|-------------|----------------|------------|
| Forro Liso | R$ 18,00 | R$ 47,00 | R$ 320,00 |
| Gesso Parede | R$ 12,00 | R$ 35,00 | R$ 280,00 |
| Sancas/Molduras | R$ 18,00/ml | R$ 35,00/ml | — |
| Drywall | R$ 42,00 | R$ 55,00 | R$ 350,00 |
| Gesso 3D | R$ 85,00 | R$ 65,00 | R$ 400,00 |

---

## 🗂️ Estrutura do Projeto

```
gessobot/
├── src/
│   ├── index.ts          # Entrada principal, inicialização do cliente
│   ├── bot.ts            # Lógica de roteamento e fluxo de conversa
│   ├── orcamento.ts      # Cálculos e formatação de orçamentos
│   ├── sessao.ts         # Gerenciamento de sessões com Turso
│   ├── types.ts          # Tipos e interfaces TypeScript
│   └── db/
│       ├── database.ts   # Cliente Turso e migrations
│       └── migrate.ts    # Script de migração
├── Dockerfile            # Container para Railway
├── railway.toml          # Configuração do Railway
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 💬 Fluxo de Conversa

```
Cliente envia mensagem
        ↓
GessoBot pergunta o nome
        ↓
Menu de serviços (1-5)
        ↓
Metragem (m²) ou Metros Lineares (sancas)
        ↓
Ambiente (sala, quarto, etc.)
        ↓
Acabamento (liso, texturizado, premium)
        ↓
Localização
        ↓
⚡ Orçamento gerado e enviado!
        ↓
Cliente confirma → Atendente é notificado
```

---

## 🛠️ Personalização

### Alterar preços
Edite o objeto `TABELA_PRECOS` em `src/orcamento.ts`

### Adicionar novo serviço
1. Adicione o tipo em `src/types.ts` → `TipoServico`
2. Adicione preços em `src/orcamento.ts` → `TABELA_PRECOS`
3. Adicione no menu em `src/bot.ts` → `menuPrincipal()`

### Alterar mensagens
Edite as funções de mensagem em `src/bot.ts`

---

## 📞 Suporte

GessoBot — Automação Inteligente
