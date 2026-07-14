# Vimage - AI 生成内容配图神器 🎨

> **让 AI 生成的内容拥有稳定、清晰且可控的配图能力。**

一个专为 AI 生成内容设计的智能图片代理服务。当 AI 生成文章、博客或报告时，通过简单的 URL 规则即可自动匹配高质量 Unsplash 图片。合法格式的图片请求结合 LLM 智能重试和 Picsum 兜底机制，尽可能稳定地返回可用图片。

## ✨ 为什么选择 Vimage？

- 🎯 **AI 配图完美方案** - 专为 Claude、ChatGPT 等 AI 生成内容设计，一行提示词规则即可使用
- 🖼️ **图片请求高可用** - 合法格式请求使用 LLM 智能重试 + Picsum 兜底
- 🎨 **图片质量保证** - 优先使用 Unsplash 专业摄影作品，视觉效果出众
- ⚡ **即插即用** - 无需额外配置，AI 直接在输出中生成图片 URL
- 🔄 **智能重试** - 找不到图片？LLM 自动生成同义词再试 3 次
- 📊 **监控面板** - 实时查看命中率、响应时间、LLM 重试详情

## 快速开始

### 方式一：Docker Compose（推荐）

1. **克隆仓库**
```bash
git clone <your-repo-url>
cd vimage
```

2. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，填入 API 密钥和后台登录密码
```

3. **启动服务**
```bash
docker compose up -d --build
```

4. **访问服务**
- 图片代理：`http://localhost:7749/vimage_001_cute-cat.jpg`
- 监控面板：`http://localhost:7749/dashboard`（使用 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录）

5. **查看状态和日志**
```bash
docker compose ps
docker logs -f vimage-service
```

### 方式二：本地运行

1. **安装依赖**（需要Node.js 20+）
```bash
npm install
```

2. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，填入 API 密钥和后台登录密码
```

3. **启动服务**
```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

> 本地运行建议使用 Node.js 20.x。项目依赖 `better-sqlite3` 原生模块，Node.js 大版本不匹配时需要重新安装依赖。

## 部署说明

### 必填配置

部署前至少需要配置：

```env
UNSPLASH_ACCESS_KEY=your_unsplash_key_here
DASHSCOPE_API_KEY=your_dashscope_key_here
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_me_to_a_strong_password
```

### Docker Compose 部署

```bash
git clone <your-repo-url>
cd vimage
cp .env.example .env
# 编辑 .env
docker compose up -d --build
```

更新代码后重新部署：

```bash
git pull
docker compose up -d --build
```

停止服务：

```bash
docker compose down
```

### 公网部署

推荐用 Nginx、Caddy 或其他反向代理把域名转发到 `127.0.0.1:7749`，并开启 HTTPS。后台登录使用 cookie 保存登录态，公网环境建议在 HTTPS 下把 `.env` 设置为：

```env
ADMIN_COOKIE_SECURE=true
```

## 🤖 在 AI 提示词中使用（推荐）

只需在 AI 对话的系统提示词或项目提示词中添加以下通用规则，AI 生成的内容就能自动配上精美图片。把 `yourdomain.com` 换成你的实际域名，例如 `vimage.devart.ai`。

```
图片使用规则：
- 所有配图使用 Vimage 图片URL。
- 公网URL格式：https://yourdomain.com/vimage_{三位序号}_{英文描述词}.jpg
- 本地测试URL格式：http://localhost:7749/vimage_{三位序号}_{英文描述词}.jpg
- 序号必须使用 3 位数字，例如 001、002、003。
- 描述词必须是英文，符合图片上下文语义；多个词用连字符 - 连接，例如 brutalist-concrete-museum。
- 可以按需要添加图片参数：w 表示图片宽度，q 表示图片质量，例如 ?w=900&q=76。
- 输出 Markdown 时，使用普通图片语法：![图片描述](图片URL)。
- 输出 HTML 时，img 标签保留原本布局、类名、尺寸和父容器设计，不因为图片规则改变页面结构或视觉布局。
- 输出 HTML 时，所有 Vimage 的 img 标签都添加 loading="lazy" decoding="async"，让浏览器按需加载图片，避免大量图片阻塞页面打开。
- 输出 HTML 时，Vimage 图片加载前必须使用 Editorial Neutral 动态渐变占位，不要只用静态灰色背景。优先在不改变布局的前提下给 Vimage img 添加 class="vimage-img"，并在页面 CSS 中加入：
  .vimage-img {
    background: linear-gradient(135deg, #f0ede5 0%, #c9c1b6 34%, #9d9f99 68%, #626860 100%);
    background-size: 240% 100%;
    animation: vimage-placeholder-shimmer 1.8s ease-in-out infinite;
  }
  @keyframes vimage-placeholder-shimmer {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
- 如果图片已有不影响布局的容器，可以给容器添加动态 shimmer 和图片淡入过渡；不要为了占位效果额外包裹元素或改变布局。
- 输出 HTML 时，可以根据用户意图、页面布局和上下文主题为图片补充 width、height、aspect-ratio 等尺寸信息，帮助浏览器预留空间；这些尺寸必须符合原有视觉设计和图片所在容器，不要生硬套用固定比例。
- 不要限制页面图片数量，不要删除图片，不要改变图片所在位置，不要为了图片加载规则调整布局。
```

本地测试用 `http://localhost:7749`，公网建议使用 `https://`，避免浏览器的混合内容限制。

### 为什么这样设计？

- ✅ **零配置** - AI 无需学习复杂的图片搜索 API
- ✅ **语义理解** - AI 擅长从上下文提取关键词
- ✅ **失败容错** - 即使描述词不准确，LLM 重试机制也能找到相关图片
- ✅ **稳定兜底** - 合法格式的图片请求在搜索失败时切换到 Picsum

### URL格式

```
http://your-domain.com/vimage_{序号}_{描述词}.{扩展名}
```

- **序号**：三位数字（001-999）
- **描述词**：英文单词，多个词用连字符`-`连接
- **扩展名**：jpg、jpeg或png

示例：
- ✅ `vimage_001_cat.jpg`
- ✅ `vimage_042_cute-cat.png`
- ✅ `vimage_123_blue-fashion-car.jpg`
- ❌ `vimage_1_cat.jpg` （序号不是三位）
- ❌ `vimage_001_cat` （缺少扩展名）

## 工作流程

```
请求 → 解析URL → 检查缓存 → 查询Unsplash
                    ↓
              无结果？
                    ↓
         LLM重试1（精确同义词）
                    ↓
              仍无结果？
                    ↓
         LLM重试2（换一组同义词）
                    ↓
              仍无结果？
                    ↓
         LLM重试3（简化描述词）
                    ↓
              仍无结果？
                    ↓
         Picsum随机图片兜底
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `UNSPLASH_ACCESS_KEY` | Unsplash API密钥 | 必填 |
| `DASHSCOPE_API_KEY` | 阿里百炼 DashScope API密钥 | 必填 |
| `DASHSCOPE_MODEL` | LLM模型ID | `deepseek-v4-flash` |
| `DASHSCOPE_API_BASE` | 阿里百炼 OpenAI 兼容接口地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `PORT` | 服务端口 | `7749` |
| `NODE_ENV` | 运行环境 | `development` |
| `ADMIN_AUTH_ENABLED` | 是否启用后台登录保护 | `true` |
| `ADMIN_USERNAME` | 后台登录用户名 | `admin` |
| `ADMIN_PASSWORD` | 后台登录密码 | 必填 |
| `ADMIN_SESSION_TTL` | 后台登录有效期（秒） | `43200` |
| `ADMIN_COOKIE_SECURE` | 是否给登录 Cookie 添加 Secure 标记 | `false` |
| `CACHE_TTL` | 缓存过期时间（秒） | `43200`（12小时） |
| `REDIRECT_CACHE_TTL` | 图片302重定向的浏览器/CDN缓存时间（秒） | `43200` |
| `UNSPLASH_RATE_LIMIT` | 速率限制（请求/小时） | `4800` |
| `DB_PATH` | SQLite数据库路径 | `./data/vimage.db` |

## API文档

### GET /vimage_{number}_{description}.{ext}

主图片代理接口，返回302重定向。

**示例：**
```
GET /vimage_001_cute-cat.jpg
→ 302 Redirect to https://images.unsplash.com/photo-xxx
```

**可选参数：**
- `w`：图片宽度，范围 `80-2400`，例如 `?w=640`
- `h`：Picsum兜底图片高度，范围 `80-2400`
- `q`：Unsplash图片质量，范围 `1-100`，例如 `?q=75`

服务会为图片重定向响应添加 `Cache-Control`，让浏览器和CDN缓存同一个 vimage URL 的 302 结果，减少重复访问时的搜索和重定向开销。

不符合上述格式的单段路径会记录为错误请求并返回 `404`，不会调用 Unsplash、LLM 或 Picsum，也不会计入图片请求统计。

### GET /api/stats

获取服务统计信息。

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
    "processHits": 2037,
    "processMisses": 2322,
    "processHitRate": 46.7,
    "ttlSeconds": 43200
  }
}
```

`successRate` 表示由 Unsplash 或缓存完成匹配的有效图片请求占比，Picsum 兜底不算匹配成功。`cacheHitRate` 和 `avgResponseTime` 同样只统计格式正确的图片请求。`cacheStats.activeEntries` 表示当前进程中尚未过期的缓存条目；`processHits`、`processMisses` 和 `processHitRate` 从本次进程启动后开始计数，服务重启后归零。

### GET /api/logs?page=1&limit=20&type=image

获取请求日志（分页），需要先登录后台。

**参数：**
- `page`：页码（从1开始）
- `limit`：每页数量，最大100
- `type`：日志类型，可选 `all`、`image` 或 `error`；默认 `all`

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

Web监控面板，可视化展示有效图片请求指标、当前缓存状态和分类日志。图片请求与格式错误请求可以独立切换，未登录时会跳转到 `/login`。

## 技术栈

- **运行时**：Node.js 20.x LTS
- **Web框架**：Express.js 4.x
- **HTTP客户端**：axios
- **缓存**：node-cache（内存缓存）
- **数据库**：better-sqlite3（SQLite）
- **容器化**：Docker + Docker Compose

## 项目结构

```
vimage/
├── src/
│   ├── index.js              # 入口文件
│   ├── routes/
│   │   ├── image.js          # 主功能路由
│   │   └── api.js            # API路由
│   ├── middleware/
│   │   └── adminAuth.js      # 后台登录鉴权
│   ├── services/
│   │   ├── unsplash.js       # Unsplash API
│   │   ├── llm.js            # LLM服务
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

- **缓存命中**：< 10ms
- **Unsplash直接成功**：200-500ms
- **LLM重试1次**：800-1200ms
- **LLM重试3次+兜底**：2000-3000ms

## 许可证

MIT

## 作者

Vimage Team
