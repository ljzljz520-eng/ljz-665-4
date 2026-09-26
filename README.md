# 🧊 冷库设备档案管理系统

冷库设备电子台账：设备编号、名称、温区、安装位置、负责人、最近维保日期、运行状态；
列表按温区 / 状态 / 关键字筛选，设备详情可上传、下载、删除说明书。内置 RBAC 权限、审计日志与一键部署验证。

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Node.js 20 + Express |
| 数据库 | SQLite（better-sqlite3，零外部依赖、单文件） |
| 前端 | 原生 HTML/CSS/JS 单页应用（无需构建） |
| 鉴权 | JWT + bcrypt 密码哈希 + 角色级 RBAC |
| 上传 | multer（类型白名单、20MB 上限、随机存储名） |
| 部署 | Docker / docker-compose / 裸机 Node 均可 |

## 快速开始（裸机）

```bash
npm install
npm run init-db          # 建表 + 种子账号/8 台示例设备
npm start                # http://localhost:3000
```

演示账号（**部署后请改密码或重建账号**）：

| 账号 | 密码 | 角色 | 能力 |
|---|---|---|---|
| admin | admin123 | 系统管理员 | 全部权限，含删除设备、账号管理 |
| manager | manager123 | 设备主管 | 增改设备、上传/删除说明书，不能删除设备 |
| operator | operator123 | 运维员 | 查看/筛选/详情、上传说明书 |

## Docker 部署

```bash
# 建议先设置密钥
export JWT_SECRET=$(openssl rand -hex 32)

docker compose up -d --build      # 数据持久化在 volume coldstore-data
docker compose logs -f
# 容器启动时自动幂等执行建表；健康检查: GET /api/health
```

部署后验证：

```bash
npm run verify        # 对 http://localhost:3100 自动拉起服务跑 36 项端到端检查
# 也可以验证已经在跑的环境：
BASE_URL=http://你的部署地址:3000 npm run verify
```

验证覆盖：健康检查、登录（正确/错误/伪造 JWT）、三角色权限矩阵（403 断言）、
温区/状态/组合/关键字筛选、非法输入 400/409、详情 404、说明书上传（含中文文件名与落盘）、
鉴权下载与内容一致性、级联删除、前端静态资源发布。

## 功能与页面

- **登录页** `#/login`：JWT 登录，令牌存 localStorage（8 小时有效）。
- **设备档案列表** `#/equipment`：
  - 字段列：编号 / 名称 / 温区 / 安装位置 / 负责人 / 最近维保日期 / 运行状态；
  - 筛选：温区（深冷 ≤-30℃ / 冷冻 -18~-30℃ / 冷藏 0~10℃ / 恒温）、状态（运行/备用/故障/维保中/停用）、关键字（编号/名称/位置/负责人），支持分页；
  - 主管以上显示「新增」；行点击进详情。
- **设备详情** `#/equipment/:id`：完整档案信息 + 说明书列表；登录角色可上传 pdf/doc/xls/图片/zip（≤20MB），主管可删除，下载经鉴权并保留原始中文文件名。
- **权限说明页** `#/permissions`：菜单内可见角色能力矩阵。
- **菜单与按钮** 依据 `/api/auth/me` 返回的 permissions 渲染；后端每个写接口独立鉴权，绕过前端同样返回 403。

## 数据库结构（server/data/coldstore.db）

- `users`：账号、bcrypt 密码哈希、角色（admin/manager/operator）
- `equipment`：设备档案主表，`code` 唯一；温区/状态带 CHECK 约束；温区与状态列建索引
- `manuals`：说明书元数据，`equipment_id` 外键 `ON DELETE CASCADE`；文件实体存 `server/data/uploads/`，随机文件名，原始名入库
- `audit_log`：登录后的增删改审计（谁、何时、对哪台设备做了什么）

初始化脚本：`server/src/initDb.js`（结构见 `server/src/schema.sql`，可重复执行）。

## API 一览

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | /api/auth/login | 公开 |
| GET | /api/auth/me | 登录 |
| GET | /api/equipment?temp_zone=&status=&keyword=&page= | 登录 |
| GET | /api/equipment/:id | 登录 |
| POST | /api/equipment | manager+ |
| PUT | /api/equipment/:id | manager+ |
| DELETE | /api/equipment/:id | admin |
| POST | /api/equipment/:id/manuals (multipart) | operator+ |
| GET | /api/equipment/:id/manuals/:fid/download | 登录 |
| DELETE | /api/equipment/:id/manuals/:fid | manager+ |
| GET | /api/health | 公开 |

## 配置（环境变量 / .env）

`PORT`（默认 3000）、`JWT_SECRET`（生产必改）、`DATA_DIR`、`UPLOAD_DIR`（Docker 中为 `/data`）。

## 目录

```
server/        Express 后端（db / 鉴权 / 设备 / 说明书路由 + schema/初始化）
web/           单页前端（登录、列表筛选、详情与上传、权限说明）
scripts/       verify.js 部署验证脚本
Dockerfile / docker-compose.yml
```
