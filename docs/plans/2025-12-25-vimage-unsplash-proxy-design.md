# Vimage - Unsplash图片代理服务设计方案

**日期：** 2025-12-25
**版本：** 1.0
**状态：** 已确认

## 1. 项目概述

### 1.1 背景
AI生成HTML页面工具中，AI会输出类似 `https://xxx.com/vimage_001_cute-cat.jpg` 的图片URL。由于模型训练数据受限，输出的URL可能无效。需要构建一个Unsplash代理服务，通过解析URL中的描述词，返回真实可用的Unsplash图片。

### 1.2 核心功能
- 解析 `vimage_{序号}_{描述词}.jpg` 格式的URL
- 根据描述词查询Unsplash图片
- 当Unsplash无结果时，使用LLM进行同义词替换重试（最多3次）
- 全部失败时使用Picsum随机图片兜底
- 提供监控面板查看请求日志和统计信息

## 2. 技术架构

### 2.1 技术栈
- **运行时：** Node.js 20.x (LTS)
- **Web框架：** Express.js 4.x
- **HTTP客户端：** axios
- **缓存：** node-cache (内存缓存)
- **数据库：** better-sqlite3 (SQLite)
- **环境配置：** dotenv
- **容器化：** Docker + Docker Compose

### 2.2 服务架构
```
客户端 (AI生成的HTML)
    ↓
vimage服务 (Node.js + Express)
    ↓ (解析URL → 提取描述词)
    ↓
内存缓存 (node-cache, TTL=12小时)
    ↓ (未命中)
    ↓
Unsplash API (最多重试3次，使用LLM同义词)
    ↓ (仍无结果)
    ↓
Picsum (随机图片兜底)
```

## 3. API设计

### 3.1 主功能端点

**端点：** `GET /:filename`

**示例请求：**
```
GET /vimage_001_cute-cat.jpg
GET /vimage_042_blue-fashion-car.jpg
```

**响应方式：**
- 成功：`HTTP 302 Redirect` 到 Unsplash/Picsum URL
- 失败：`HTTP 400 Bad Request` (格式错误)

**使用场景：**
```html
<!-- HTML中直接使用 -->
<img src="https://your-domain.com/vimage_001_cute-cat.jpg">
<!-- 浏览器自动跟随302重定向，加载实际图片 -->
```

### 3.2 监控API

**统计信息：** `GET /api/stats`
```json
{
  "totalRequests": 5234,
  "successRate": 95.2,
  "cacheHitRate": 78.5,
  "avgResponseTime": 245,
  "sourcesDistribution": {
    "unsplash": 1234,
    "unsplash-retry": 456,
    "cache": 3200,
    "picsum-llm-failed": 234,
    "picsum-rate-limit": 110
  },
  "rateLimitStatus": {
    "current": 4523,
    "limit": 5000,
    "resetIn": 1380
  }
}
```

**请求日志：** `GET /api/logs?page=1&limit=20`
```json
{
  "page": 1,
  "limit": 20,
  "total": 5234,
  "data": [
    {
      "id": 1,
      "timestamp": "2025-12-25T10:30:45Z",
      "original_url": "vimage_001_cute-cat.jpg",
      "query_term": "cute-cat",
      "retry_count": 0,
      "retry_1_term": null,
      "retry_2_term": null,
      "retry_3_term": null,
      "success": true,
      "final_url": "https://images.unsplash.com/photo-xxx",
      "source": "unsplash",
      "response_time": 245,
      "error_message": null,
      "from_cache": false
    }
  ]
}
```

**监控面板：** `GET /dashboard`
- HTML单页面应用
- 展示统计信息和请求日志
- 支持无限滚动加载
- 每条日志包含图片预览

## 4. 核心处理流程

### 4.1 URL解析

**文件名格式：**
```
vimage_{三位数字}_{描述词}.{扩展名}
例如: vimage_001_cute-cat.jpg
     vimage_042_blue-fashion-car.jpg
```

**解析规则：**
```javascript
const match = filename.match(/^vimage_(\d{3})_(.+)\.(jpg|jpeg|png)$/i);
// 提取: 序号(001-999) 和 描述词(可含多个-, 如cute-cat)
```

**描述词转换：**
```javascript
// "cute-cat" → "cute cat" (Unsplash查询用空格)
const searchQuery = description.replace(/-/g, ' ');
```

### 4.2 Unsplash API调用

**请求格式：**
```
GET https://api.unsplash.com/search/photos
  ?query=cute cat
  &per_page=1
  &client_id={UNSPLASH_ACCESS_KEY}
```

**参数说明：**
- `query`: 空格分隔的搜索词
- `per_page=1`: 只返回1张图片，提升速度
- `client_id`: API访问密钥

### 4.3 LLM同义词替换

**触发条件：** Unsplash API 返回 `total=0`

**重试策略：**
1. **第1次重试：** 精确同义词替换（保持原意）
2. **第2次重试：** 精确同义词替换（换一组词）
3. **第3次重试：** 扩大范围（简化描述词）

**Prompt设计（第1、2次）：**
```
你是一个图片搜索优化助手。

原始查询词: "beautiful cute cat"
任务: 将查询词替换为更常见的同义词，以便在Unsplash图片库中找到匹配结果。

要求:
1. 保持原始含义和情感
2. 使用更常见、流行的英文词汇
3. 只返回替换后的词，用连字符连接

输出格式: JSON
{"synonym": "stunning-adorable-cat"}
```

**Prompt设计（第3次）：**
```
你是一个图片搜索优化助手。

原始查询词: "beautiful cute cat"
任务: 简化查询词，扩大搜索范围，以提高匹配成功率。

要求:
1. 保留核心主题词
2. 移除修饰词
3. 只返回简化后的词，用连字符连接

输出格式: JSON
{"synonym": "cat"}
```

**OpenRouter调用：**
```javascript
POST https://openrouter.ai/api/v1/chat/completions
Headers:
  Authorization: Bearer {OPENROUTER_API_KEY}
  Content-Type: application/json
Body:
{
  "model": "google/gemini-flash-3.0-preview",
  "messages": [{"role": "user", "content": "{prompt}"}]
}
```

### 4.4 完整处理流程

```javascript
async function getImage(filename) {
  // 1. 解析URL
  const { description } = parseImageUrl(filename);

  // 2. 检查缓存
  const cached = getCachedImage(description);
  if (cached) {
    logRequest({ ...cached, from_cache: true });
    return redirect(cached.url);
  }

  // 3. 检查速率限制
  if (isRateLimitReached()) {
    const url = getPicsumRandomUrl();
    logRequest({ source: 'picsum-rate-limit', url });
    return redirect(url);
  }

  // 4. 查询Unsplash
  let result = await searchUnsplash(description);
  let retryLog = { retry_1_term: null, retry_2_term: null, retry_3_term: null };

  if (result.total === 0) {
    // 5. LLM重试1
    const synonym1 = await getLLMSynonym(description, 1);
    retryLog.retry_1_term = synonym1;
    result = await searchUnsplash(synonym1);

    if (result.total === 0) {
      // 6. LLM重试2
      const synonym2 = await getLLMSynonym(description, 2);
      retryLog.retry_2_term = synonym2;
      result = await searchUnsplash(synonym2);

      if (result.total === 0) {
        // 7. LLM重试3
        const synonym3 = await getLLMSynonym(description, 3);
        retryLog.retry_3_term = synonym3;
        result = await searchUnsplash(synonym3);

        if (result.total === 0) {
          // 8. Picsum兜底
          const url = getPicsumRandomUrl();
          logRequest({ source: 'picsum-llm-failed', url, ...retryLog });
          return redirect(url);
        }
      }
    }
  }

  // 9. 成功，缓存并返回
  const url = result.urls.regular;
  setCachedImage(description, url);
  logRequest({ source: 'unsplash', url, ...retryLog });
  return redirect(url);
}
```

## 5. 缓存策略

### 5.1 缓存配置
```javascript
const imageCache = new NodeCache({
  stdTTL: 43200,        // 12小时过期
  checkperiod: 600,     // 每10分钟清理过期缓存
  useClones: false      // 直接返回引用，提升性能
});
```

### 5.2 缓存键设计
- **Key:** 描述词 (如 `"cute-cat"`)
- **Value:** `{ url: "https://...", timestamp: 1234567890 }`

**原因：** `vimage_001_cute-cat.jpg` 和 `vimage_099_cute-cat.jpg` 应该返回相同结果

### 5.3 缓存策略
1. 请求到达先查缓存
2. 缓存命中直接返回（响应时间 <10ms）
3. 缓存未命中则查询API
4. API成功后写入缓存（仅成功的Unsplash结果）
5. Picsum兜底结果不缓存（随机图片）

## 6. 速率控制

### 6.1 限制说明
- **Unsplash限制：** 5000 requests/hour
- **保守策略：** 4800/hour (留200缓冲)

### 6.2 速率控制逻辑
```javascript
let requestCount = 0;
let resetTime = Date.now() + 3600000; // 1小时后

function checkRateLimit() {
  if (Date.now() > resetTime) {
    requestCount = 0;
    resetTime = Date.now() + 3600000;
  }
  return requestCount >= 4800;
}

// 使用
if (checkRateLimit()) {
  // 直接返回Picsum，不调用Unsplash
  return { url: getPicsumRandomUrl(), source: 'picsum-rate-limit' };
}
requestCount++;
```

## 7. 数据库设计

### 7.1 SQLite选择理由
- 文件型数据库，单个 `.db` 文件
- 零配置，无需额外服务
- 轻量级，适合日志记录
- Docker化简单（挂载volume即可）

### 7.2 日志表结构
```sql
CREATE TABLE request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- 请求信息
  original_url TEXT NOT NULL,           -- 原始URL
  query_term TEXT NOT NULL,             -- 提取的描述词

  -- 重试信息
  retry_count INTEGER DEFAULT 0,        -- 实际重试次数(0-3)
  retry_1_term TEXT,                    -- 第1次重试的词
  retry_2_term TEXT,                    -- 第2次重试的词
  retry_3_term TEXT,                    -- 第3次重试的词

  -- 结果
  success BOOLEAN,                      -- 是否成功
  final_url TEXT,                       -- 最终的Unsplash/Picsum URL
  source TEXT,                          -- 来源类型
  response_time INTEGER,                -- 响应时间(ms)
  error_message TEXT,                   -- 错误信息

  -- 缓存标记
  from_cache BOOLEAN DEFAULT 0
);

CREATE INDEX idx_timestamp ON request_logs(timestamp DESC);
```

### 7.3 Source字段枚举
- `unsplash`: Unsplash直接成功
- `unsplash-retry-1`: 第1次重试成功
- `unsplash-retry-2`: 第2次重试成功
- `unsplash-retry-3`: 第3次重试成功
- `picsum-llm-failed`: LLM重试3次仍失败
- `picsum-rate-limit`: 速率限制触发
- `cache`: 缓存命中

## 8. 错误处理

### 8.1 错误分类

**1. URL格式错误 (400)**
```javascript
// vimage_1_test.jpg (数字不是三位)
// image_001_test.jpg (前缀错误)
return { error: "Invalid URL format" };
```

**2. Unsplash API错误**
```javascript
// 网络超时、API Down、认证失败
try {
  const response = await fetch(unsplashUrl, { timeout: 5000 });
} catch (error) {
  // 降级到Picsum
  return { url: getPicsumRandomUrl(), source: 'picsum-api-error' };
}
```

**3. LLM API错误**
```javascript
// OpenRouter超时、配额用尽、返回格式错误
async function getLLMSynonym(term, retryNum) {
  try {
    // 调用OpenRouter
  } catch (error) {
    // 降级策略：取第一个词/最后一个词/核心词
    if (retryNum === 1) return term.split('-')[0];
    if (retryNum === 2) return term.split('-').pop();
    if (retryNum === 3) return term.replace(/-/g, ' ').split(' ')[0];
  }
}
```

**4. SQLite写入错误**
```javascript
// 不影响主流程，只记录到console
try {
  await db.insert('request_logs', logData);
} catch (error) {
  console.error('Failed to write log:', error);
}
```

### 8.2 全局兜底
```javascript
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (req.path.startsWith('/vimage_')) {
    // 图片请求：返回Picsum随机图片
    res.redirect(302, 'https://picsum.photos/1200/800');
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**核心原则：** 无论发生什么错误，都要保证返回一个可用的图片URL

## 9. 环境配置

### 9.1 环境变量

**.env（不提交到Git）：**
```env
# Unsplash API
UNSPLASH_ACCESS_KEY=your_unsplash_key_here

# OpenRouter (LLM)
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=google/gemini-flash-3.0-preview

# 服务配置
PORT=3000
NODE_ENV=production

# 缓存配置
CACHE_TTL=43200  # 12小时

# 速率限制
UNSPLASH_RATE_LIMIT=4800

# 数据库
DB_PATH=/data/vimage.db
```

**.env.example（提交到Git）：**
```env
UNSPLASH_ACCESS_KEY=your_unsplash_key_here
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=google/gemini-flash-3.0-preview
PORT=3000
NODE_ENV=production
CACHE_TTL=43200
UNSPLASH_RATE_LIMIT=4800
DB_PATH=/data/vimage.db
```

### 9.2 .gitignore
```
# 环境变量（包含API密钥）
.env

# 数据库文件
data/
*.db
*.db-shm
*.db-wal

# Node.js
node_modules/
npm-debug.log*

# 系统文件
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# 日志
logs/
*.log
```

## 10. Docker部署

### 10.1 Dockerfile
```dockerfile
FROM node:20-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖（生产环境）
RUN npm ci --only=production

# 复制源代码
COPY . .

# 创建数据目录
RUN mkdir -p /data

# 暴露端口
EXPOSE 3000

# 启动服务
CMD ["node", "src/index.js"]
```

### 10.2 docker-compose.yml
```yaml
version: '3.8'

services:
  vimage:
    build: .
    container_name: vimage-service
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - ./data:/data  # 持久化SQLite数据库
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/api/stats"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 10.3 部署步骤
```bash
# 1. 克隆仓库
git clone <repo-url>
cd vimage

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入真实的API密钥

# 3. 启动服务
docker-compose up -d

# 4. 查看日志
docker-compose logs -f

# 5. 访问服务
# - 图片请求: http://localhost:3000/vimage_001_cute-cat.jpg
# - 监控面板: http://localhost:3000/dashboard
```

## 11. 项目结构

```
vimage/
├── src/
│   ├── index.js              # 入口文件
│   ├── routes/
│   │   ├── image.js          # 主功能路由 (302重定向)
│   │   ├── api.js            # API路由 (/api/stats, /api/logs)
│   │   └── dashboard.js      # Dashboard页面路由
│   ├── services/
│   │   ├── unsplash.js       # Unsplash API封装
│   │   ├── llm.js            # OpenRouter/LLM调用
│   │   ├── cache.js          # 缓存服务
│   │   └── rateLimit.js      # 速率限制
│   ├── db/
│   │   ├── init.js           # 数据库初始化
│   │   └── logger.js         # 日志记录
│   ├── utils/
│   │   ├── urlParser.js      # URL解析
│   │   └── validator.js      # 参数验证
│   └── public/
│       └── dashboard.html    # 监控面板前端页面
├── data/
│   └── vimage.db            # SQLite数据库（Docker挂载）
├── docs/
│   └── plans/
│       └── 2025-12-25-vimage-unsplash-proxy-design.md  # 本文档
├── ref/
│   └── prd.txt              # 需求文档
├── .env.example             # 环境变量模板
├── .gitignore               # Git忽略配置
├── Dockerfile               # Docker镜像配置
├── docker-compose.yml       # Docker Compose配置
├── package.json             # Node.js依赖
└── README.md                # 项目说明文档
```

## 12. 性能指标

### 12.1 预期响应时间
- **缓存命中：** <10ms
- **Unsplash直接成功：** 200-500ms
- **LLM重试1次：** 800-1200ms
- **LLM重试3次 + Picsum兜底：** 2000-3000ms

### 12.2 优化策略
- 并发处理：多个请求可同时处理
- 缓存预热：常见词汇可预先缓存（可选）
- 超时设置：Unsplash 5秒，LLM 10秒

### 12.3 容量规划
- **Unsplash限制：** 5000 requests/hour
- **预期缓存命中率：** 60-80%
- **实际API调用：** 1000-2000 requests/hour
- **单容器可承载：** ~10,000 requests/hour (总请求)

## 13. 监控与运维

### 13.1 Dashboard功能
- 实时统计信息（总请求、成功率、缓存命中率）
- 来源分布（Unsplash、Picsum、缓存等）
- 速率限制状态（当前用量、重置时间）
- 请求日志（无限滚动，包含图片预览）
- 每条日志展示：原始URL、重试词、结果、响应时间、错误信息

### 13.2 日志级别
- **INFO:** 正常请求
- **WARN:** LLM重试、接近速率限制
- **ERROR:** API错误、数据库错误

### 13.3 健康检查
```bash
# Docker healthcheck
wget --quiet --tries=1 --spider http://localhost:3000/api/stats
```

## 14. 未来扩展

### 14.1 可选增强功能
- [ ] Redis缓存（多实例部署）
- [ ] 图片尺寸参数支持（如 `?width=800&height=600`）
- [ ] 自定义Prompt模板配置
- [ ] 多个LLM fallback（OpenAI → Claude → Gemini）
- [ ] Prometheus metrics导出
- [ ] 缓存预热脚本（预载热门词汇）
- [ ] 图片CDN加速

### 14.2 性能优化
- [ ] 使用Redis Cluster扩展缓存
- [ ] 多实例负载均衡
- [ ] 图片下载代理（解决墙的问题）
- [ ] 异步日志写入（不阻塞主流程）

---

## 附录：依赖清单

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.0",
    "node-cache": "^5.1.2",
    "better-sqlite3": "^9.2.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

---

**设计完成，等待实施确认。**
