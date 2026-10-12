# ---- Base ----
# Use Debian-based image instead of Alpine for ARM64 compatibility with onnxruntime-node
# Alpine uses musl libc which is incompatible with ONNX runtime binaries on ARM64
FROM node:22-slim AS base
WORKDIR /app
COPY package*.json ./

# ---- Dependencies ----
FROM base AS dependencies
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN npm install

# ---- Build ----
# `npm run build` runs `prisma generate` first; the generated client lands in src/generated/prisma
# and is compiled into dist/.
FROM dependencies AS build
COPY . .
RUN npm run build

# ---- Production ----
# No generate step here. The server runs from dist/. src/ and scripts/ are shipped (from the build
# stage, so src/generated/prisma comes along) for the ts-node maintenance scripts
# (migrate:re-embed). prisma/ and prisma.config.ts are shipped for `prisma migrate deploy`.
FROM base AS production
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts

# Create non-root user (Debian commands differ from Alpine)
RUN groupadd -g 1001 nodejs && \
  useradd -r -u 1001 -g nodejs nodejs && \
  chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

ENV DATABASE_URL=$DATABASE_URL
ENV OLLAMA_URL=$OLLAMA_URL

# Embedding model (Ollama-based); override at runtime via Helm values. Defaults to the
# platform standard (nomic-embed-text, 768 dimensions), matching the Helm values and .env.example.
ARG EMBEDDING_MODEL=nomic-embed-text
ENV EMBEDDING_MODEL=$EMBEDDING_MODEL
ENV SUMMARIZATION_MODEL=$SUMMARIZATION_MODEL
ENV ADMIN_API_URL=$ADMIN_API_URL

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["sh", "-c", "npm run db:deploy && npm start"]
