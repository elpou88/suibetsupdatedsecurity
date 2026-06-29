FROM node:20-slim

RUN npm install -g pnpm@10.26.1

# Install postgresql-client for the migration step
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN rm -rf node_modules package-lock.json && pnpm install --frozen-lockfile --ignore-scripts

RUN pnpm --filter @workspace/api-server run build

RUN BASE_PATH=/ PORT=3000 pnpm --filter @workspace/suibets run build

RUN cp -r artifacts/suibets/dist/public artifacts/api-server/dist/public

RUN chmod +x artifacts/api-server/scripts/start.sh

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "artifacts/api-server/scripts/start.sh"]
