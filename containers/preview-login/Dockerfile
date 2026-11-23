FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
WORKDIR /opt/preview-login
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server.mjs handoff.mjs ./
USER 10001:10001
EXPOSE 8080
CMD ["node", "server.mjs"]
