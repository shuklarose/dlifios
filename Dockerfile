# Node 22 for the built-in process.loadEnvFile(). Debian slim rather than Alpine:
# @huggingface/transformers pulls in native binaries built against glibc, and the
# musl builds Alpine would need are not published for every platform.
FROM node:22-slim

WORKDIR /app

# Dependencies in their own layer so a source-only change does not reinstall
# them. tsx is a runtime dependency here, not a dev one: the server runs the
# TypeScript directly rather than building to JS first.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

# Pre-download the embedding model. Without this the first request after every
# deploy pays the download, and a Hugging Face outage would take the app down.
# transformers.js caches inside node_modules, so this lands in the image layer
# and costs a few hundred MB of image size, which is the trade being made.
RUN node -e "import('@huggingface/transformers').then(async ({ pipeline }) => { \
      await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2'); \
      console.log('embedding model cached'); \
    })"

# Run as the unprivileged user the base image ships with, so a process escape
# does not land on root. The cache directory must be writable by that user.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3000

# Coolify polls this to decide whether the container is live and when a new
# deploy is ready to take traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
