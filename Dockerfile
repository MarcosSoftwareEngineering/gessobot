FROM node:20-slim

# Instalar dependências do Puppeteer/Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Variável do Chromium para o Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copiar e instalar dependências
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código fonte e compilar
COPY . .
RUN npm run build

# Pasta de autenticação do WhatsApp
RUN mkdir -p .wwebjs_auth .wwebjs_cache

EXPOSE 3000

CMD ["node", "dist/index.js"]
