# Agent 安全接入与固定图片链接

## 接口边界

- `POST /api/images/resolve` 是唯一找图入口，使用 `Authorization: Bearer <API Key>`；后台 Cookie、URL 查询参数中的 Key 都不能代替它。
- `GET /i/:id` 是公开的固定图片链接，只查询持久映射，绝不调用搜索或模型。未知 ID 返回 404，附加查询参数返回 400；上游故障返回错误，不换图。
- 旧 `/vimage_...` 动态入口返回 410，即使带 API Key 也不会重新开放。旧页面需要通过新接口选图并替换链接。浏览器 / CDN 仍可能短暂使用旧入口已缓存的跳转；上线时应清理旧 CDN 缓存。
- 搜索缓存有 TTL；`image_assets` 映射没有 TTL。清理搜索缓存、日志或重启容器不会清除固定映射。上游删除图片时固定链接仍可能失效，不保证第三方文件永远存在。
- 图片宽度与质量在找图时确定，不能通过修改固定链接查询参数生成任意变体。

## 创建与轮换 Key

在项目目录运行：

```bash
node scripts/generate-api-key.js
```

随机 Key 保存到 `.secrets/image-api-key`，默认权限 600。命令只打印 SHA-256 配置项，将打印的 `IMAGE_API_KEY_HASHES=...` 填到 `.env`。不要将哈希值当作客户端 Key；客户端使用文件里的原始 Key。

`.secrets/` 已排除出 Git 和 Docker 构建。仅将原始 Key 交给可信的产品后端 / Secret Manager；Vimage 只需哈希。未配置 Key 时找图接口返回 503，其他图片展示与后台接口不受影响。

轮换时用不同文件名生成新 Key，把新旧哈希用英文逗号连接，重建服务；迁移客户端后移除旧哈希并再次重建。不同接入方使用不同 Key。每个 Key 默认 60 次/分钟、1000 次/UTC 自然日，计数保存在 SQLite，重启不清零；有效找图请求的缓存命中与搜索失败也占额度。超限返回 429 和 Retry-After。轮换 Key 会产生新的额度身份，产品后端还应限制真实用户和租户的总用量。

## 本地与线上配置

```env
PUBLIC_BASE_URL=http://localhost:7749
IMAGE_DELIVERY_MODE=redirect
UNSPLASH_PROXY_APPROVED=false
```

上线改为 `PUBLIC_BASE_URL=https://你的域名`，开启 HTTPS 与 `ADMIN_COOKIE_SECURE=true`，重新创建容器。这里只接受 HTTP(S) origin，不支持子路径部署；服务不会使用请求的 Host 或 X-Forwarded-Host 拼接链接，避免域名污染。

本机 Compose override 仅监听 127.0.0.1，可让同机 Nginx/Caddy 转发。应用内浏览器的临时转发端口若与 7749 不同，应把 PUBLIC_BASE_URL 改为实际可访问地址。本地 URL 不能让远程 Agent 或其他人的浏览器访问你的 localhost。

改地址只影响后续返回的 URL；已有图片 ID 不变，但之前发出的绝对链接仍需保留旧域名路由或迁移。

## 调用示例

### 配套 Skill 与工具注册

产品只分发仓库中的 `skills/vimage-images/` 目录，不把整个服务仓库、`.env` 或 `.secrets/` 挂入 Agent 沙箱。该目录的 `SKILL.md` 是配图指令，`references/search-image-tool.json` 是无凭据的工具定义；Skill 不会自动注册工具，也不是隔离安全边界。

在可信后端注册名为 `search_image` 的工具，按 JSON 中的 `inputSchema` 校验模型参数并拒绝额外字段。该定义采用通用的 `name` / `inputSchema` / `outputSchema` 结构，接入具体工具框架时适配其封装，不改变参数边界。`width` 映射为下面示例里的 `w`，默认 900；质量由后端固定为 80，不交给模型控制。

后端使用既有产品登录上下文做用户权限与预算检查，不能从模型参数决定身份。只有后端可读取 Key、配置调用地址、发送认证头；完成请求后验证返回的固定 URL 属于配置的公开 origin，路径 ID 与 `id` 一致，并仅按 `outputSchema` 返回 `{id, url}`。不要将原始响应、请求配置、认证头或底层异常对象返回模型。错误可由工具框架提供脱敏后的状态码与 `Retry-After`，不要包含原始请求头或响应体。

下面示例展示 HTTP 参数映射，不是完整的工具注册、用户鉴权或隔离实现；调用前后的 schema 校验、URL 校验和用户额度控制由产品后端补齐。没有注册工具时，配套 Skill 会停止找图并保留占位，不改用 shell / HTTP 绕过后端。

以下 Node.js 代码只放在可信的产品后端。`VIMAGE_API_BASE` 是 Vimage 的调用地址，`VIMAGE_API_KEY` 是产品后端通过 Secret Manager 等机制注入的凭据。它们不需要与公开图片域名相同。

```js
async function searchImageTool({ query, width = 900 }) {
  const response = await fetch(new URL('/api/images/resolve', process.env.VIMAGE_API_BASE), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VIMAGE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, w: width, q: 80 }),
    redirect: 'error',
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`Image service returned ${response.status}`);
  const result = await response.json();
  return { id: result.id, url: result.url };
}
```

请求体只支持 `query`（1–200 字符）、`w`（80–2400 整数）、`q`（1–100 整数）。响应示例：

```json
{
  "id": "924c797399e005b16c8d36f69a435693",
  "url": "https://images.example.com/i/924c797399e005b16c8d36f69a435693",
  "upstream_url": "https://images.unsplash.com/photo-example?ixid=tracking&w=900&q=80",
  "delivery_mode": "redirect",
  "cached": false
}
```

找图失败返回 502/503，不创建随机 Picsum 映射。没有稳定结果时 Agent 应保留占位或提示失败，不应无限重试。

Skill 只需告诉模型调用 `search_image` 工具并使用返回的完整 URL，不要自行拼图链接、添加参数或提供 API Key 参数。用户身份由产品登录上下文决定，不能信任模型传入的任意 user_id。工具仅可调用固定 Vimage 地址，不得允许模型指定接收认证头的 URL。

如果 Agent 能读文件、环境变量或执行 shell，把 Key 放在同一个沙箱的 `.env` 里不构成隔离。密钥持有者必须是 Agent 不能读取的独立可信后端。若 Agent 跑在用户设备，平台总 Key 仍留在服务器，客户端通过用户登录访问你的后端。

## 图片交付与限制

- `redirect`：返回 302，图片流量由上游承担；返回的 `upstream_url` 也可以直接用于官方要求的直链展示。
- `proxy`：返回 200 图片内容，浏览器不跳转。只允许数据库中的 HTTPS Unsplash 图片地址，不接受任意目标、不转发客户端 Cookie/Authorization、不跟随上游重定向。
- 代理默认最多 8 个并发，每张最多 10 MiB，10 秒总超时，仅允许 JPEG/PNG/WebP/AVIF/GIF；错误响应不缓存。浏览器 / CDN 可缓存成功响应 12 小时；Node 进程不另做图片文件缓存，穿透到 Node 的每次读取都会回源并占用带宽。
- 可让 CDN 对同域名 `/i/*` 缓存成功响应，`/api/*` 不得缓存，认证失败与错误响应不得缓存。搜索 API 的授权与图片公开展示分开；若图片本身需要保密，需要另加图片访问控制。
- 当前并发限制是单进程，SQLite 额度适用于单机共享数据库的部署；多副本应迁移到共享额度存储，并增加网关限流和带宽预算。保密不代表防滥用，合法用户或被诱导的 Agent 仍可能耗尽自身额度。
- 管理后台记录的是找图请求，不把固定图片每次展示计入搜索统计。完整展示访问量应由 CDN / 访问日志统计。

启用 Unsplash 代理前请先阅读 [许可确认与申请邮件](UNSPLASH-APPROVAL.md)。
