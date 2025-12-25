FROM node:20-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖（生产环境）
RUN npm ci --only=production

# 复制源代码
COPY src ./src

# 创建数据目录
RUN mkdir -p /data

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/stats || exit 1

# 启动服务
CMD ["node", "src/index.js"]
