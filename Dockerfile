FROM node:20-alpine
WORKDIR /app

# better-sqlite3 需要少量构建工具（alpine 上预编译包通常可用，缺失时再构建）
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && mkdir -p server/data/uploads

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
RUN apk del .build-deps || true

COPY server ./server
COPY web ./web

ENV NODE_ENV=production DATA_DIR=/data UPLOAD_DIR=/data/uploads PORT=3000
VOLUME ["/data"]
EXPOSE 3000

# 启动前确保表结构存在（幂等），再启动服务
CMD ["sh", "-c", "node server/src/initDb.js && node server/src/index.js"]
