# SQL Quest — Node.js server + game files. Needs a PostgreSQL database (see docker-compose.yml).
FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev && npm cache clean --force
COPY server/src server/src
COPY server/scripts server/scripts
COPY sql-quest sql-quest
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/src/index.js"]
