# ❄ 冷库设备档案系统（Cold Storage Equipment Archive）

冷库制冷设备的电子档案管理：设备台账、按温区/运行状态筛选、设备详情说明书上传、角色权限、一键部署与自动化验证。

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Node.js ≥ 18（原生 fetch，无构建步骤） |
| 后端 | Express 4 + express-session（Cookie 会话，HttpOnly） |
| 数据库 | SQLite（better-sqlite3，预编译二进制，WAL 模式） |
| 文件上传 | multer 2（类型白名单 + 20MB 限制 + 磁盘重命名） |
| 前端 | 原生 HTML/CSS/JS 单页应用（hash 路由，无需打包） |
| 密码 | Node 内置 `crypto.scrypt` 加盐哈希 |

## 功能与权限

| 功能 | 只读用户 viewer | 设备管理员 manager | 系统管理员 admin |
|---|---|---|---|
| 登录、查看设备列表/详情、筛选、下载说明书 | ✅ | ✅ | ✅ |
| 新建 / 编辑 / 删除设备 | ❌ | ✅ | ✅ |
| 上传 / 删除说明书 | ❌ | ✅ | ✅ |
| 用户与权限管理（建号、改角色、重置密码、停用） | ❌ | ❌ | ✅ |

- **温区**：速冻 / 冷冻 / 冷藏 / 恒温
- **运行状态**：运行 / 停机 / 维保中 / 故障
- 列表支持温区、状态下拉筛选（可组合），并支持编号/名称/位置/负责人关键字搜索。
- 菜单按角色渲染：「用户与权限」仅 admin 可见；前端隐藏 + 后端接口鉴权双重控制。

## 设备字段

编号（唯一）、名称、温区、安装位置、负责人、最近维保日期、运行状态、备注；详情页关联多份说明书（文件名、大小、上传人、上传时间，可下载/删除）。

## 快速开始

```bash
npm install
npm run migrate          # 初始化 SQLite（data/coldstore.db）
npm run seed             # 写入 3 个角色账号 + 6 条示例设备
npm start                # http://localhost:3000
```

默认账号（**生产环境登录后请立即改密**）：

| 用户名 | 密码 | 角色 |
|---|---|---|
| admin | admin123 | 系统管理员 |
| manager | manager123 | 设备管理员 |
| viewer | viewer123 | 只读用户 |

## 验证

```bash
npm run verify
```

使用独立临时数据目录启动应用并跑端到端用例（覆盖：未认证拦截、三级角色越权拦截、设备 CRUD 与校验、
温区/状态组合筛选、说明书上传白名单/大小、中文文件名下载、用户管理、SPA 回退），共 38 项断言。

## API 摘要

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/auth/login` `/logout` | 公开/登录 | 会话登录、退出 |
| GET | `/api/auth/me` | 登录 | 当前用户 |
| GET | `/api/equipment?temp_zone=&status=&keyword=` | 登录 | 列表+筛选 |
| GET | `/api/equipment/meta` | 登录 | 温区/状态字典 |
| GET | `/api/equipment/:id` | 登录 | 详情（含说明书） |
| POST | `/api/equipment` | manager+ | 新建 |
| PUT | `/api/equipment/:id` | manager+ | 更新 |
| DELETE | `/api/equipment/:id` | manager+ | 删除（级联删说明书） |
| POST | `/api/equipment/:id/manuals` | manager+ | 上传说明书（multipart，字段名 `file`） |
| GET | `/api/manuals/:id/download` | 登录 | 下载（RFC5987 中文文件名） |
| DELETE | `/api/manuals/:id` | manager+ | 删除说明书 |
| GET/POST/PUT | `/api/users` | admin | 用户与权限管理 |

## 部署

### 方式一：一键脚本（systemd）

```bash
APP_DIR=/opt/coldstore-archive bash scripts/deploy.sh
```

脚本完成：同步代码 → 装生产依赖 → 从模板生成 `.env` 并随机生成 `SESSION_SECRET`
→ 迁移/种子 → 注册并启动 `coldstore` 服务。配置模板见 `deploy/coldstore.service`。

### 方式二：PM2

```bash
npm ci --omit=dev
pm2 start deploy/ecosystem.config.js && pm2 save
```

### 方式三：Nginx 反向代理（可选）

见 `deploy/nginx-coldstore.conf.example`；启用 HTTPS 后在 `.env` 设置 `COOKIE_SECURE=true`。

### 环境变量（`.env`，模板见 `.env.example`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` / `HOST` | 3000 / 0.0.0.0 | 监听地址 |
| `SESSION_SECRET` | 随机（重启失效） | **生产必须固定为随机长字符串** |
| `COOKIE_SECURE` | false | HTTPS 后置 true |
| `DATA_DIR` | ./data | SQLite 目录，建议挂独立数据盘并定期备份 |
| `UPLOAD_DIR` | ./uploads | 说明书存储目录，需备份 |

## 目录结构

```
server/            Express 应用
  index.js         入口（会话/静态/SPA回退/错误处理/启动即迁移）
  db.js auth.js    SQLite 连接、scrypt 密码与角色中间件
  routes/          auth / equipment / manuals / users
db/schema.sql      表结构（users / equipment / manuals）
public/            原生 SPA（登录、设备列表筛选、详情+上传、用户管理）
scripts/           migrate / seed / verify(端到端) / deploy.sh
deploy/            systemd unit、PM2、Nginx 模板
data/ uploads/     运行期数据（已 gitignore，需纳入备份）
```

## 运维与备份

- 备份：`sqlite3 data/coldstore.db ".backup 'coldstore.bak'"` + 同步 `uploads/` 目录。
- 升级：拉代码 → `npm ci --omit=dev` → `npm run migrate`（迁移幂等）→ 重启服务。
- 说明书文件改名后落盘，原始名仅存数据库，避免路径穿越；下载走鉴权接口而非公开静态目录。
