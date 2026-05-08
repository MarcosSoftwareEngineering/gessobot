FROM node:20-slim

WORKDIR /app

# 1. Copiar apenas os arquivos de configuração primeiro
COPY package*.json ./

# 2. Instalar TODAS as dependências (isso inclui o TypeScript para o build não falhar)
RUN npm install

# 3. Copiar o restante do código do projeto
COPY . .

# 4. Compilar o código TypeScript (agora o comando tsc vai ser encontrado!)
RUN npm run build

# 5. Limpar as dependências de desenvolvimento para deixar a imagem final mais leve
RUN npm prune --production

EXPOSE 3000

# 6. Iniciar o servidor
CMD ["node", "dist/index.js"]