FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

USER node

ENTRYPOINT ["./node_modules/.bin/identityforge", "mcp"]
