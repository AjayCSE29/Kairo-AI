FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
RUN npm ci && npm --prefix server ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/shared ./shared
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/server/tsconfig.json ./server/tsconfig.json

EXPOSE 8787
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "--prefix", "server", "start"]
