# 冷库设备档案管理系统 (Cold Storage Equipment Archive)

面向冷库运维场景的设备档案管理：设备台账、按温区/运行状态筛选、设备说明书上传、RBAC 权限、菜单控制、运行看板。

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Node.js 20 + Express 5 |
| 数据库 | SQLite（better-sqlite3，零外部依赖，文件位于 `data/coldstore.db`） |
| 上传 | multer（文件落盘 `data/uploads/`，元数据入库，事务一致） |
| 鉴权 | scrypt 密码哈希 + HMAC-SHA256 签名令牌 + RBAC 权限点 |
| 前端 | 原生 HTML/CSS/JS 单页应用，免构建 |

## 快速开始

```bash
npm install
npm start                 # 默认 http://localhost:3000
PORT=8080 npm start       # 自定义端口
APP_SECRET=xxx npm start  # 生产环境务必修改令牌密钥
```

首次启动自动建表并写入字典与演示数据。

### 演示账号

| 账号 | 密码 | 角色 | 能力 |
|---|---|---|---|
| admin | Admin@123 | 管理员 | 全部功能 + 用户与权限管理 |
| manager | Manager@123 | 设备主管 | 看板、设备增改、说明书上传/删除 |
| viewer | Viewer@123 | 只读用户 | 看板、查看、下载说明书 |

> 生产部署请登录后立即在「用户与权限」中改密。

## 功能清单

- **设备档案字段**：编号、名称、温区（高温/中温/低温/超低温/常温穿堂 5 类字典）、安装位置、负责人、最近维保日期、运行状态（运行中/备用/故障/维保中/停用）、备注
- **列表筛选**：温区下拉 + 状态下拉 + 关键字（编号/名称/位置/负责人），条件可组合，筛选条件同步 URL hash 可分享/刷新保留
- **设备详情**：完整信息展示、维保超 90 天红色预警、说明书列表
- **说明书**：上传（PDF/Word/JPG/PNG，≤20MB）、下载（鉴权）、删除（主管/管理员）；删设备时附件一并清理
- **运行看板**：设备总数、维保超期数、温区分布、状态分布
- **菜单与权限**：菜单按角色权限动态渲染；接口逐权限点校验；提供角色权限矩阵
- **用户管理**：管理员可增改用户、分配角色、停用启用、重置密码

## API 概览

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/api/auth/login` | 公开 |
| GET | `/api/auth/me` | 登录 |
| GET | `/api/dict/zones` `/api/dict/statuses` | 登录 |
| GET | `/api/equipment?zone=&status=&q=` | equipment:read |
| GET | `/api/equipment/stats/summary` | equipment:read |
| GET/POST | `/api/equipment` | read / write |
| GET/PUT/DELETE | `/api/equipment/:id` | read / write / delete |
| POST | `/api/equipment/:id/documents` | document:upload |
| GET | `/api/equipment/:id/documents/:docId/download` | equipment:read |
| DELETE | `/api/equipment/:id/documents/:docId` | document:delete |
| GET/POST/PUT/DELETE | `/api/users...` | user:manage（禁止删除自己） |

## 数据库

- 表结构：`src/db/schema.sql`（roles / permissions / role_permissions / users / menus / temp_zones / status_dict / equipment / documents，含外键、索引、updated_at 触发器）
- 种子数据：`src/db/seed.js`
- 重置数据：停服后删除 `data/` 目录，重启自动初始化

## 部署验证

```bash
npm start                 # 终端 A
npm run verify            # 终端 B
```

`scripts/verify.sh` 为端到端 curl 验证（47 项断言）：首页/SPA 回退、三角色登录、菜单与权限矩阵、列表多维筛选、增改删校验（400/401/403/409）、说明书上传/格式拦截/下载一致性/权限删除、用户生命周期、测试数据清理。全绿即部署通过。

### 容器部署

```bash
docker build -t coldstore-archive .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --name coldstore coldstore-archive
docker exec coldstore npm run verify   # 容器内验证（需对宿主机映射端口，或在容器内执行）
```

### PM2 部署

```bash
npm i -g pm2 && pm2 start ecosystem.config.js && pm2 save
```

## 目录结构

```
src/
  server.js              入口
  db/schema.sql          表结构
  db/seed.js             字典/账号/示例数据
  db/index.js            连接与初始化
  middleware/auth.js     令牌 + RBAC
  routes/                auth/dict/equipment/users
public/                  免构建 SPA
scripts/verify.sh        端到端验证
data/                    SQLite 与上传文件（运行时生成）
```
