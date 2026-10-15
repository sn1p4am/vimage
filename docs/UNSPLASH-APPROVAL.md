# Unsplash 自有域名 / CDN 接入确认

## 如何确认

官方 Hotlinking 指南要求直接使用 `photo.urls` 返回的图片 URL。需要使用自己的图片基础设施时，官方给出的联系地址是 **partnerships@unsplash.com**，可以咨询 photo views beacon 替代方案。一般 API 接入问题也可联系 **api@unsplash.com**。

- [Hotlinking 指南](https://help.unsplash.com/en/articles/2511271-guideline-hotlinking-images)
- [API Guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines)

可用的 Access Key、应用进入 Production、搜索 API 调用成功，都不能单独证明已经允许通过自有 CDN 缓存分发。需要向对方完整说明实际 Agent 产品和流量路径，取得明确的书面回复，并落实回复要求的署名、浏览量上报、下载事件和缓存策略。不要把 API Key 或 Secret Key 发进申请邮件。

## 邮件模板

To: partnerships@unsplash.com

Subject: Approval request: custom-domain image delivery for an Agent product

Hello Unsplash API team,

We are integrating Unsplash into [product name and website], an Agent product that helps users create [describe the actual content and workflow]. Our Unsplash application ID is [application ID].

Our proposed architecture is:

- A trusted backend authenticates users and performs image searches using our server-held API credentials.
- The Agent receives a stable image URL under our own domain, for example https://images.example.com/i/asset-id.
- That URL maps to one existing Unsplash photo. Rendering it never initiates a new search or LLM request.
- A reverse proxy/CDN fetches the original photo.urls URL, retaining its tracking parameters, and serves the image without redirecting the browser to images.unsplash.com.
- We propose [cache TTL], [retention/purge policy], and expect [monthly image views / bandwidth / search volume].

Could you confirm whether this delivery architecture is permitted for our use case? If approval or a separate agreement is required, please advise on the process and any fees.

Your Hotlinking Images guideline mentions a photo views beacon alternative for companies using their own image infrastructure. Could you provide the approved implementation, including how views should be reported on CDN cache hits, how download_location events should be triggered when an Agent selects a photo for user content, and what attribution is required in the generated content?

Our workflow includes [describe user initiation, Agent automation, image selection, publication, and whether any unattended/batch activity exists]. Please also confirm whether this workflow meets your API usage guidelines.

We can provide a demo, screenshots and a data-flow diagram. We will not enable custom-domain proxy delivery for Unsplash until the applicable requirements are confirmed and implemented.

Thank you,
[name, company, contact]

## 本项目的开关

默认 `IMAGE_DELIVERY_MODE=redirect`，固定链接会跳转到原来的上游地址，且不会再次找图。这不是对产品整体已符合 Unsplash 全部规范的声明；正式接入仍需处理署名和选图 / 下载事件。

本项目已具备代理图片的技术能力，但未实现需要对方提供规范的 photo views beacon。取得明确许可、完成对方要求的上报和署名后，才设置：

```env
IMAGE_DELIVERY_MODE=proxy
UNSPLASH_PROXY_APPROVED=true
```

`UNSPLASH_PROXY_APPROVED` 只是部署者的显式确认，不会向 Unsplash 自动申请或验证许可，也不替代对方要求的其他实现。未确认时切换代理模式会拒绝启动。对方不同意时保留上游直链，或选择明确允许代理分发的图片来源。
