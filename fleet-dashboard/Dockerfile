FROM node:20-alpine AS builder
WORKDIR /app

# Declaração dos argumentos de build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_NOTIFICATIONS_URL
ARG NEXT_PUBLIC_MQTT_BROKER

# Transformando os argumentos em variáveis de ambiente de build
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_NOTIFICATIONS_URL=$NEXT_PUBLIC_NOTIFICATIONS_URL
ENV NEXT_PUBLIC_MQTT_BROKER=$NEXT_PUBLIC_MQTT_BROKER

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copia os artefatos gerados
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./

# CORREÇÃO: Copiar o arquivo de configuração do Next.js se ele existir
COPY --from=builder /app/next.config.* ./

# Instala apenas as dependências de produção necessárias para o comando 'next start'
RUN npm ci --only=production

EXPOSE 3000
CMD ["npm", "start"]