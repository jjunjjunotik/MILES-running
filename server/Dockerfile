# The MILES API. Build from the repository root, because the server runs the
# app's own territory and crew code from src/js:
#
#   docker build -f server/Dockerfile -t miles-api .
#
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# The five browser files the server shares with the app (see src/shared.js).
COPY src/js/core.js src/js/clip.js src/js/land.js src/js/crew.js src/js/pro.js ./src/js/

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY server/data ./server/data

WORKDIR /app/server
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/index.js"]
