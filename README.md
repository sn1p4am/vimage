# Vimage - Agent 内容配图服务

> 鉴权找图与公开图片展示分离，图片链接不会再次触发搜索。

Agent 通过可信后端调用找图 API，Vimage 使用 Unsplash 与 LLM 候选词重试，返回持久化的固定图片链接。模型和 Skill 不接触 API Key，图片展示不消耗找图与模型额度。

## 快速开始

需要 Docker Compose，或 Node.js 24 LTS。

```bash
cp .env.example .env
node scripts/generate-api-key.js
```

填写 `.env` 中的 Unsplash / DashScope 凭据、后台密码，以及命令打印的 `IMAGE_API_KEY_HASHES`。原始客户端 Key 保存在 `.secrets/image-api-key`，不要放入 Skill、代码仓库、生成页面或 Agent 沙箱。

```bash
docker compose up -d --build
```

本地直接运行可使用 `npm ci && npm start`；将 `DB_PATH` 改为 `./data/vimage.db`。本机 Docker Compose override 将端口绑定为 `127.0.0.1:7749`。

- 后台：`http://localhost:7749/dashboard`，使用后台账号密码。
- 找图：`POST /api/images/resolve`，使用独立的 Bearer API Key。
- 图片：`GET /i/:id`，只展示已有图片，不找图。
- 健康检查：`GET /healthz`，无需认证。

## Agent 与线上部署

完整示例、密钥隔离、轮换、接口响应和 CDN 缓存规则见 [Agent 安全接入](docs/AGENT-INTEGRATION.md)。

配套 Skill 位于 [skills/vimage-images/SKILL.md](skills/vimage-images/SKILL.md)，工具 schema 位于 [search-image-tool.json](skills/vimage-images/references/search-image-tool.json)。将整个 `skills/vimage-images/` 目录交给产品的 Skill 加载器即可加载指令；仍需产品可信后端注册 `search_image` 工具。Skill 本身不注册工具、不读取 Key，也不替代后端的权限和密钥隔离。

Skill 只描述如何调用 `search_image` 工具，模型仅传关键词、尺寸。产品可信后端添加认证头，收到图片 URL 后交给模型用于 Markdown 或 HTML。不要让模型直接拼接带关键词的图片 URL，也不要把 Key 放入模型可读取的文件或环境。

```env
PUBLIC_BASE_URL=http://localhost:7749
IMAGE_DELIVERY_MODE=redirect
UNSPLASH_PROXY_APPROVED=false
```

上线将 `PUBLIC_BASE_URL` 改为实际 HTTPS 域名，用 Nginx/Caddy 转发到本机端口，并设置 `ADMIN_COOKIE_SECURE=true`。修改配置后执行 `docker compose up -d --force-recreate`；更新代码后使用 `docker compose up -d --build`。本地和线上使用同一路径，不从不可信的请求 Host 推导返回域名。

默认固定链接 302 到上游。需要浏览器不跳转，可启用图片代理模式，但当前 Unsplash 来源必须先确认自有图片基础设施的接入要求。联系方式与可发送的英文模板见 [Unsplash 许可确认](docs/UNSPLASH-APPROVAL.md)。配置开关不是授权证明，也不自动实现对方要求的浏览量上报。

## 升级注意

旧 `/vimage_...` 动态图片入口已返回 **410 Gone**，避免被绕过鉴权滥用。旧页面需通过新 API 选图并替换链接。找图失败返回 502/503，不再跳转到随机 Picsum；历史日志和图片缩略图仍保留。

`image_assets` 固定映射独立于搜索缓存，不因缓存 TTL、日志清理或重启失效；上游删图时仍可能无法展示。修改图片 ID 返回 404，不进行搜索。数据库应定期备份。固定图片展示不计入后台的搜索统计。

## 工作流程

```text
产品可信后端 → API Key 鉴权 / 配额 → 搜索缓存 → Unsplash / LLM
                                                  ↓
                                           持久化图片映射
                                                  ↓
                                            返回 /i/固定ID

浏览器 → /i/固定ID → 已有映射 → 上游跳转，或经许可的代理取图
                  → 不存在 → 404（绝不重新找图）
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `UNSPLASH_ACCESS_KEY` | Unsplash API密钥 | 必填 |
| `DASHSCOPE_API_KEY` | 阿里百炼 DashScope API密钥 | 必填 |
| `DASHSCOPE_MODEL` | LLM模型ID | `deepseek-v4-flash` |
| `DASHSCOPE_API_BASE` | 阿里百炼 OpenAI 兼容接口地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_TIMEOUT_MS` | 单次 LLM 候选词请求超时（毫秒） | `2500` |
| `DASHSCOPE_ENABLE_THINKING` | 是否开启模型思考模式 | `false` |
| `LLM_MAX_TOKENS` | 候选词生成输出 Token 上限 | `256` |
| `LLM_CACHE_TTL` | 成功候选词缓存有效期（秒） | `3600` |
| `LLM_CACHE_MAX_ENTRIES` | 候选词缓存最大条数 | `1000` |
| `UNSPLASH_TIMEOUT_MS` | 单次 Unsplash 搜索超时（毫秒） | `2500` |
| `IMAGE_SEARCH_BUDGET_MS` | 原词搜索、LLM 与候选词搜索的总预算（毫秒） | `5000` |
| `UPSTREAM_COOLDOWN_MS` | Unsplash 鉴权失败、限流或服务端故障后的冷却时间（毫秒）；限流时还会遵守更长的 Retry-After | `60000` |
| `LOG_RETENTION_DAYS` | 请求日志保留天数；设为 `0` 禁用自动清理 | `30` |
| `IMAGE_API_KEY_HASHES` | 客户端 Key 的 SHA-256，多个哈希逗号分隔；为空时关闭找图 | 空 |
| `PUBLIC_BASE_URL` | 返回固定图片链接的 HTTP(S) origin | `http://localhost:7749` |
| `IMAGE_API_RATE_LIMIT` | 每 Key 每分钟请求上限 | `60` |
| `IMAGE_API_DAILY_LIMIT` | 每 Key 每 UTC 自然日请求上限 | `1000` |
| `IMAGE_SEARCH_MAX_CONCURRENT` | 找图请求最大并发 | `4` |
| `IMAGE_DELIVERY_MODE` | `redirect` 或 `proxy` | `redirect` |
| `UNSPLASH_PROXY_APPROVED` | 完成上游许可及附带要求后显式确认代理模式 | `false` |
| `IMAGE_PROXY_MAX_CONCURRENT` | 代理图片最大并发 | `8` |
| `IMAGE_PROXY_TIMEOUT_MS` | 代理图片总超时（毫秒） | `10000` |
| `IMAGE_PROXY_MAX_BYTES` | 单张代理图片最大体积 | `10485760` |
| `PORT` | 服务端口 | `7749` |
| `NODE_ENV` | 运行环境 | `development` |
| `ADMIN_AUTH_ENABLED` | 是否启用后台登录保护 | `true` |
| `ADMIN_USERNAME` | 后台登录用户名 | `admin` |
| `ADMIN_PASSWORD` | 后台登录密码 | 必填 |
| `ADMIN_SESSION_TTL` | 后台登录有效期（秒） | `43200` |
| `ADMIN_COOKIE_SECURE` | 是否给登录 Cookie 添加 Secure 标记 | `false` |
| `CACHE_TTL` | 缓存过期时间（秒） | `43200`（12小时） |
| `REDIRECT_CACHE_TTL` | 固定图片响应的浏览器/CDN缓存时间（秒） | `43200` |
| `UNSPLASH_RATE_LIMIT` | 速率限制（请求/小时） | `4800` |
| `DB_PATH` | SQLite数据库路径 | `./data/vimage.db` |

## API文档

后台登录按来源 IP 限制失败尝试：15 分钟最多 10 次，成功登录不占用失败额度。后台页面、统计及日志接口禁止浏览器缓存。默认只信任直连地址，不根据未经配置的 `X-Forwarded-For` 判定来源 IP。

Docker 镜像以 UID/GID `1000:1000` 的非 root 用户运行，根文件系统只读，SQLite 数据目录保持可写。升级已有部署时先备份数据库，并确保宿主机 `data/` 目录归该 UID/GID 所有。容器标准输出日志轮转为最多 3 个 10 MB 文件；数据库中过期请求日志每分钟最多清理 1000 条，图片缓存不受请求日志清理影响。

### POST /api/images/resolve

请求头：`Authorization: Bearer <原始客户端Key>`；请求体：`{"query":"cute cat","w":900,"q":80}`。

返回 `{id, url, upstream_url, delivery_mode, cached}`。成功与错误响应均禁止缓存。未配置 Key 返回 503，无效 Key 返回 401，参数错误返回 400，超出每 Key 配额返回 429，并发繁忙或上游限流返回 503。后台登录不能代替 API Key，API Key 也不能访问管理后台。

每 Key 分钟及 UTC 自然日配额持久保存；有效找图请求包括缓存命中和搜索失败都会计数。同关键词并发搜索仍会合并。

### GET /i/:id

公开固定图片链接，只读持久化映射。未知 ID 返回 404，不接受查询参数。默认返回上游 302；经许可配置代理模式后返回 200 图片字节。失败不换图、不调用搜索、不缓存错误。

成功响应默认允许浏览器 / CDN 缓存 12 小时。代理只读取允许的上游图片地址，不透传客户端认证头，不跟随上游重定向；有限时、体积、并发限制。固定链接不包含 API Key，也不提供搜索能力。

### GET /api/stats

获取服务统计信息，需要先登录后台。统计首次读取时从 SQLite 恢复，之后按请求日志增量更新；其他数据库连接写入或日志清理后会重新加载。统计范围为当前保留的请求日志。

**响应示例：**
```json
{
  "totalRequests": 9472,
  "totalLoggedRequests": 9472,
  "imageRequests": 8240,
  "errorRequests": 1232,
  "successCount": 8235,
  "successRate": 99.9,
  "cacheHitCount": 3850,
  "cacheMissCount": 4390,
  "cacheHitRate": 46.7,
  "directUnsplashCount": 4200,
  "rewrittenUnsplashCount": 185,
  "unsplashMatchCount": 4385,
  "directUnsplashRate": 95.8,
  "rewrittenUnsplashRate": 4.2,
  "directUnsplashAvgResponseTime": 707,
  "rewrittenUnsplashAvgResponseTime": 9733,
  "avgResponseTime": 715,
  "sourcesDistribution": {
    "unsplash": 4200,
    "cache": 3850,
    "unsplash-retry-1": 150,
    "unsplash-retry-2": 30,
    "unsplash-retry-3": 5,
    "picsum-all-failed": 5
  },
  "rateLimitStatus": {
    "current": 1523,
    "limit": 4800,
    "resetIn": 1800
  },
  "cacheStats": {
    "activeEntries": 17,
    "persistentEntries": 4385,
    "memoryHits": 2037,
    "persistentHits": 412,
    "processHits": 2449,
    "processMisses": 2322,
    "processHitRate": 51.3,
    "ttlSeconds": 43200
  }
}
```

`successRate` 表示由 Unsplash 或缓存完成匹配的有效图片请求占比，Picsum 兜底不算匹配成功。`cacheHitRate` 和 `avgResponseTime` 同样只统计格式正确的图片请求。

`avgResponseTime` 从鉴权与配额校验后的找图处理开始计时，到固定映射保存为止；不包含请求日志写入、响应网络传输和后续图片展示。历史动态入口日志保留原来的计时口径。

`directUnsplashCount` 表示原查询词直接匹配 Unsplash 的次数，`rewrittenUnsplashCount` 表示换词后匹配的次数。换词通常由单次 LLM 请求生成，LLM 不可用时会使用本地简化词兜底。两者之和是 `unsplashMatchCount`；`directUnsplashRate` 和 `rewrittenUnsplashRate` 仅以成功的 Unsplash 匹配为分母，不包含缓存命中、Picsum 兜底或失败请求。`directUnsplashAvgResponseTime` 与 `rewrittenUnsplashAvgResponseTime` 分别给出这两类成功请求的平均处理时间，没有样本时返回 `null`。

缓存使用两级结构：`activeEntries` 是当前内存 L1 中尚未过期的条目，`persistentEntries` 是 SQLite L2 中尚未过期且可跨服务重启复用的条目。`memoryHits` 和 `persistentHits` 分别统计本次运行中命中 L1、L2 的次数；`processHits` 是二者之和，`processMisses` 表示两层均未命中，`processHitRate` 按 `processHits / (processHits + processMisses)` 计算。运行期命中计数在服务重启后归零，数据库历史中的 `cacheHitCount` 不受影响。

### GET /healthz

无需登录的轻量健康检查，只检查应用和数据库连接，正常时返回 `200 {"status":"ok"}`。容器健康检查使用此接口，不扫描历史日志，也不调用外部 API。

### GET /api/logs?page=1&limit=20&type=image

获取请求日志（分页），需要先登录后台。

**参数：**
- `page`：页码（从1开始）
- `limit`：每页数量，最大100
- `type`：日志类型，可选 `all`、`image` 或 `error`；默认 `all`
- `q`：搜索路径、查询词、重试词或错误信息，最多 200 字符；按普通文本匹配，不将 `%`、`_` 作为通配符
- `range`：`all`（默认）、`1h`、`24h`、`7d` 或 `30d`，相对于服务器当前时间
- `status`：`all`（默认）、`success` 或 `fallback`；后者表示有效图片请求中的未匹配 / 兜底
- `source`：`all`（默认）、`cache`、`direct`、`rewritten` 或 `picsum`
- `sort`：`newest`（默认）、`oldest` 或 `slowest`

筛选条件可组合，`total` 和分页均反映全部匹配记录，而非仅筛选当前页。查询示例：`/api/logs?type=image&q=cat&range=24h&status=fallback&sort=slowest`。

**响应示例：**
```json
{
  "total": 1234,
  "page": 1,
  "limit": 20,
  "type": "image",
  "totalPages": 62,
  "data": [
    {
      "id": 1,
      "timestamp": "2025-12-25T10:30:45Z",
      "original_url": "vimage_001_cute-cat.jpg",
      "query_term": "cute-cat",
      "retry_count": 0,
      "success": true,
      "final_url": "https://images.unsplash.com/...",
      "source": "unsplash",
      "response_time": 245
    }
  ]
}
```

### GET /dashboard

后台分为「运行概览」与「请求日志」，未登录时会跳转到 `/login`。页面脚本和样式同样经过后台认证。

- 运行概览展示保留期内的匹配成功率、缓存命中率、耗时、来源分布及当前进程状态；指标和异常提示可直接跳转到对应日志。
- 日志支持全文搜索、时间 / 结果 / 来源组合筛选、时间或耗时排序、每页 20 / 50 / 100 条及页码跳转。筛选和页码保存在 URL，刷新或分享链接后可恢复，仍需登录才能访问。
- 详情面板提供完整路径、错误原因、原词与换词链路、图片预览、原始 JSON 和复制功能；按 Esc 可关闭。
- 图片请求默认显示缩略图，使用懒加载并可手动关闭。手机端使用卡片列表；自动刷新可关闭，输入、翻页或查看详情时暂停。
- 概览指标不随日志筛选变化，统计范围由 `/api/stats` 的 `retentionDays` 说明；所有日志时间显示为北京时间。

## 技术栈

- **运行时**：Node.js 24 LTS
- **Web框架**：Express.js 4.x
- **HTTP客户端**：axios
- **缓存**：node-cache（L1 内存缓存）+ SQLite（L2 持久化缓存）
- **数据库**：better-sqlite3（SQLite）
- **容器化**：Docker + Docker Compose

## 项目结构

```
vimage/
├── src/
│   ├── index.js              # 入口文件
│   ├── routes/
│   │   ├── image.js          # 固定图片展示路由
│   │   ├── resolve.js        # API Key 鉴权找图
│   │   └── api.js            # API路由
│   ├── middleware/
│   │   └── adminAuth.js      # 后台登录鉴权
│   ├── services/
│   │   ├── unsplash.js       # Unsplash API
│   │   ├── llm.js            # LLM服务
│   │   ├── imageSearch.js    # 搜索预算与候选词编排
│   │   ├── cache.js          # 缓存服务
│   │   └── rateLimit.js      # 速率限制
│   ├── db/
│   │   ├── init.js           # 数据库初始化
│   │   └── logger.js         # 日志记录
│   ├── utils/
│   │   └── urlParser.js      # URL解析
│   └── public/
│       ├── dashboard.html    # 监控面板
│       └── login.html        # 后台登录页
├── data/                     # 数据库文件（Docker挂载）
├── docs/                     # 文档
├── .env.example              # 环境变量模板
├── Dockerfile                # Docker镜像配置
├── docker-compose.yml        # Docker Compose配置
└── package.json              # 项目依赖
```

## 性能指标

- **L1 内存缓存命中**：通常 < 10ms
- **L2 SQLite 缓存命中**：通常 < 20ms
- **Unsplash 直接成功**：受上游网络影响，历史平均约 700ms
- **换词搜索**：受 `IMAGE_SEARCH_BUDGET_MS` 限制，默认不超过约 5 秒

## 许可证

Apache License 2.0，详见 [LICENSE](LICENSE)。

## 作者

Vimage Team
