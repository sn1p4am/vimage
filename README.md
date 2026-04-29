# Vimage - AI 生成内容配图神器 🎨

> **让 AI 生成的内容拥有精美配图，100% 可用，零失败！**

一个专为 AI 生成内容设计的智能图片代理服务。当 AI 生成文章、博客或报告时，通过简单的 URL 规则即可自动匹配高质量 Unsplash 图片。结合 LLM 智能重试和 Picsum 兜底机制，**确保每次请求都能返回精美且可用的图片**。

## ✨ 为什么选择 Vimage？

- 🎯 **AI 配图完美方案** - 专为 Claude、ChatGPT 等 AI 生成内容设计，一行提示词规则即可使用
- 🖼️ **100% 可用保证** - LLM 智能重试 + Picsum 兜底，绝不返回 404
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

### 一键配置，立即可用！

只需在 AI 对话的系统提示词或项目提示词中添加以下规则，AI 生成的内容就能自动配上精美图片。把 `yourdomain.com` 换成你的实际域名，例如 `vimage.devart.ai`。

```
图片使用规则：
- 使用 Vimage 图片URL，格式为：https://yourdomain.com/vimage_{三位序号}_{英文描述词}.jpg
- 英文描述词要符合上下文语义和主题；多个词用连字符 - 连接。
- 序号必须使用 3 位数字，例如 001、002、003。
- 如果输出 Markdown，使用普通图片语法即可：
  ![图片描述](https://yourdomain.com/vimage_001_cute-cat.jpg?w=900&q=78)
- 如果输出 HTML，必须按页面性能规则写 img 标签：
  1. 首屏关键图最多 1-3 张，不要使用 loading="lazy"，添加 decoding="async" fetchpriority="high"。
  2. 非首屏图片全部添加 loading="lazy" decoding="async"。
  3. 每张图片都设置 width 和 height，或确保父容器有固定尺寸，避免布局抖动。
  4. 按实际展示尺寸添加图片参数：?w={展示宽度}&q={质量}。
  5. 卡片/缩略图建议 q=70-75；首屏大图建议 q=76-82。
  6. 不要让页面一次性 eager 加载大量 Vimage 图片。
```

**就这么简单！** 本地测试用 `http://localhost:7749`，公网建议使用 `https://`，避免浏览器的混合内容限制。

### HTML生成提示词模板

如果你让 AI 生成网页或落地页，可以直接把下面这段放进项目提示词：

```
生成 HTML 时，所有配图都使用 Vimage：
- 域名：https://yourdomain.com
- URL格式：https://yourdomain.com/vimage_{三位序号}_{英文描述词}.jpg?w={宽度}&q={质量}
- 描述词必须是英文，多个词用连字符连接，例如 brutalist-concrete-museum。
- 首屏最多 1-3 张关键图，不加 loading="lazy"，需要加 decoding="async" fetchpriority="high"。
- 首屏以下图片全部加 loading="lazy" decoding="async"。
- 每个 img 必须有准确的 alt、width、height。
- 按展示宽度设置 w 参数：小卡片 320-480，普通内容图 640-900，首屏大图 960-1400。
- 按场景设置 q 参数：小卡片 q=70-75，普通内容图 q=72-78，首屏大图 q=76-82。
- 图片父容器必须有稳定尺寸或 aspect-ratio，避免图片加载前后布局跳动。
```

示例：

```html
<!-- 首屏关键图 -->
<img
  src="https://yourdomain.com/vimage_001_brutalist-concrete-museum.jpg?w=1200&q=80"
  alt="野兽派混凝土博物馆外立面"
  width="1200"
  height="760"
  decoding="async"
  fetchpriority="high"
>

<!-- 非首屏图片 -->
<img
  src="https://yourdomain.com/vimage_008_civic-plaza-concrete-canopy.jpg?w=640&q=74"
  alt="公共广场混凝土顶棚"
  width="640"
  height="420"
  loading="lazy"
  decoding="async"
>
```

### 实际效果示例

**输入提示词：**
```
请写一篇关于宠物的文章，文章要有配图。
```

**AI 输出：**
```markdown
# 可爱的宠物世界

![可爱的小猫](http://localhost:7749/vimage_001_cute-cat.jpg)

宠物为我们的生活带来无尽的欢乐...

![狗狗在玩耍](http://localhost:7749/vimage_002_playful-dog.jpg)

宠物的陪伴让我们感到温暖...
```

**结果：** 文章自动配上了精美的 Unsplash 专业摄影图片！✨

### 为什么这样设计？

- ✅ **零配置** - AI 无需学习复杂的图片搜索 API
- ✅ **语义理解** - AI 擅长从上下文提取关键词
- ✅ **失败容错** - 即使描述词不准确，LLM 重试机制也能找到相关图片
- ✅ **100% 成功** - Picsum 兜底确保永远不会出现图片加载失败

## 使用示例

### 在HTML中使用

```html
<img src="http://localhost:7749/vimage_001_cute-cat.jpg">
<img src="http://localhost:7749/vimage_002_blue-fashion-car.jpg">
<img src="http://localhost:7749/vimage_003_sunset-beach.jpg">
```

浏览器会自动跟随302重定向，加载实际的Unsplash图片。

### 在图片较多的页面中使用

首屏主图可以优先加载：

```html
<img
  src="http://localhost:7749/vimage_001_brutalist-concrete-museum.jpg?w=960&q=78"
  alt="野兽派混凝土博物馆外立面"
  width="960"
  height="620"
  decoding="async"
  fetchpriority="high"
>
```

列表、画廊、卡片等非首屏图片建议懒加载：

```html
<img
  src="http://localhost:7749/vimage_009_architect-portrait-studio.jpg?w=420&q=72"
  alt="建筑师在工作室中的肖像"
  width="420"
  height="315"
  loading="lazy"
  decoding="async"
>
```

如果同一个页面有很多图片，优先控制首屏只加载 1-3 张关键图，其余图片都使用 `loading="lazy"`。这能让页面文本、布局和交互先出现，图片在接近可视区域时再请求。

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

### GET /api/stats

获取服务统计信息。

**响应示例：**
```json
{
  "totalRequests": 1234,
  "successRate": 95.2,
  "cacheHitRate": 78.5,
  "avgResponseTime": 245,
  "sourcesDistribution": {
    "unsplash": 500,
    "cache": 600,
    "picsum-llm-failed": 34
  },
  "rateLimitStatus": {
    "current": 1523,
    "limit": 4800,
    "resetIn": 1800
  }
}
```

### GET /api/logs?page=1&limit=20

获取请求日志（分页），需要先登录后台。

**参数：**
- `page`：页码（从1开始）
- `limit`：每页数量

**响应示例：**
```json
{
  "total": 1234,
  "page": 1,
  "limit": 20,
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

Web监控面板，可视化展示统计信息和日志。未登录时会跳转到 `/login`。

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
