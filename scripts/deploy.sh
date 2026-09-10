#!/usr/bin/env bash
# 一键部署脚本（目标机器：Node.js >= 18, Linux）
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/coldstore-archive}"

echo "==> [1/5] 同步代码到 ${APP_DIR}"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER" "$APP_DIR"
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude data --exclude uploads \
  ./ "$APP_DIR/"

echo "==> [2/5] 安装生产依赖"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund

echo "==> [3/5] 准备配置"
[ -f .env ] || cp .env.example .env
if grep -q '^SESSION_SECRET=change-me' .env; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" .env
  echo "    已自动生成 SESSION_SECRET"
fi

echo "==> [4/5] 数据库迁移与初始数据"
mkdir -p data uploads
node scripts/migrate.js
USERS=$(node -e "const{db}=require('./server/db');console.log(db.prepare('SELECT COUNT(*) c FROM users').get().c)")
if [ "$USERS" = "0" ]; then node scripts/seed.js; fi

echo "==> [5/5] 注册 systemd 服务"
sudo cp deploy/coldstore.service /etc/systemd/system/coldstore.service
sudo systemctl daemon-reload
sudo systemctl enable --now coldstore
sleep 2
sudo systemctl --no-pager --full status coldstore | head -8

echo ""
echo "部署完成： http://$(hostname -I | awk '{print $1}'):3000"
echo "首次登录请尽快使用 admin/admin123 登录并修改密码"
