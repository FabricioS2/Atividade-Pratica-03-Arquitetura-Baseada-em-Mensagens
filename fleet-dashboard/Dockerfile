FROM node:20-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_NOTIFICATIONS_URL
ARG NEXT_PUBLIC_MQTT_BROKER

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
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production
EXPOSE 3000
CMD ["npm", "start"]