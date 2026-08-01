# Runs the Identity Forge MCP server over stdio.
# Glama builds this image to introspect the tool surface, so the server must
# start and answer tools/list with no API key present. No kit payloads are
# bundled here; published Free kits are fetched from identityforge.io.

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
