FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node . .
USER node
# 镜像内不含任何密钥；TAOBAO_* 与 QUANSHENG_PRODUCT_REF_KEY 由运行时环境注入。
ENV PORT=3000 QUANSHENG_UPSTREAM=live
EXPOSE 3000
CMD ["node", "server/server.cjs"]
