FROM node:20-slim

RUN npm install -g pnpm@10

WORKDIR /app

COPY . .

RUN rm -rf node_modules package-lock.json && pnpm install --frozen-lockfile --ignore-scripts

RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
