FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production

# Long polling по умолчанию; webhook: см. README / docker-compose
CMD ["node", "src/polling.mjs"]
