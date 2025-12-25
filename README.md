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
# 编辑 .env 文件，填入你的API密钥
```

3. **启动服务**
```bash
docker-compose up -d
```

4. **访问服务**
- 图片代理：`http://localhost:7749/vimage_001_cute-cat.jpg`
- 监控面板：`http://localhost:7749/dashboard`

### 方式二：本地运行

1. **安装依赖**（需要Node.js 20+）
```bash
npm install
```

2. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件
```

3. **启动服务**
```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

## 🤖 在 AI 提示词中使用（推荐）

### 一键配置，立即可用！

只需在 AI 对话的系统提示词或项目提示词中添加以下规则，AI 生成的内容就能自动配上精美图片：

```
图片使用规则：
- 图片URL格式：http://yourdomain.com/vimage_{序号}_{描述词}.jpg
- 图片URL规范：
  1. 使用英文描述词，符合上下文语义和主题
  2. 多个词用连字符 - 连接
  3. 序号使用 3 位数字（001、002、003...）
```

**就这么简单！** 将 `yourdomain.com` 替换为你的服务域名（本地测试用 `localhost:7749`），AI 立即就能在生成内容时自动插入图片。

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
| `OPENROUTER_API_KEY` | OpenRouter API密钥 | 必填 |
| `OPENROUTER_MODEL` | LLM模型ID | `google/gemini-3-flash-preview` |
| `PORT` | 服务端口 | `7749` |
| `NODE_ENV` | 运行环境 | `development` |
| `CACHE_TTL` | 缓存过期时间（秒） | `43200`（12小时） |
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

获取请求日志（分页）。

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

Web监控面板，可视化展示统计信息和日志。

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
│       └── dashboard.html    # 监控面板
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
