FROM node:20-slim

WORKDIR /app

# ==========================================
# PREPARAÇÃO DO AMBIENTE PYTHON
# ==========================================
# Instalar Python, Pip e dependências do sistema
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Instalar as bibliotecas do Python (ReportLab e Pillow)
# O parâmetro --break-system-packages é necessário nas versões mais novas do Linux no Docker
RUN pip3 install --break-system-packages reportlab Pillow

# ==========================================
# PREPARAÇÃO DO AMBIENTE NODE.JS / TYPESCRIPT
# ==========================================
# 1. Copiar apenas os arquivos de configuração primeiro
COPY package*.json ./

# 2. Instalar TODAS as dependências do Node
RUN npm install

# 3. Copiar o restante do código do projeto
COPY . .

# 4. Compilar o código TypeScript
RUN npm run build

# 5. Limpar as dependências de desenvolvimento do Node
RUN npm prune --production

EXPOSE 3000

# 6. Iniciar o servidor
CMD ["node", "dist/index.js"]