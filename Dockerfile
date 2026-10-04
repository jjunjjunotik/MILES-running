# NailSense 운영용 이미지. Fly.io 에서 그대로 쓴다(fly.toml).
#
# 1단계: 화면을 빌드한다(타입 검사 + Vite + 비밀키 검사).
FROM node:22-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 2단계: 실행에 필요한 것만 담는다. 개발 도구와 소스 화면 코드는 들어가지 않는다.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY tsconfig.json tsconfig.server.json ./
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "server/index.ts"]
