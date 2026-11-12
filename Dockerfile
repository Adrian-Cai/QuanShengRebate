FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node . .
USER node
ENV PORT=3000 AFFILIATE_MODE=demo
EXPOSE 3000
CMD ["node", "server/server.cjs"]
