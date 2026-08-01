# Runs the Identity Forge MCP server over stdio.
# Glama builds this image to introspect the tool surface, so the server must
# start and answer tools/list with no API key present. It does: browsing free
# kits is unauthenticated, and only Pro or write calls need IDENTITYFORGE_API_KEY.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Optional. Required only for Pro kits, naming boards, and writes.
ENV IDENTITYFORGE_API_KEY=""

ENTRYPOINT ["node", "dist/index.js", "mcp"]
