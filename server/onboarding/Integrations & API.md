## 集成

Outline 原生支持市面上许多最流行的工具，无需任何额外设置或配置。只要粘贴一个 YouTube 视频、Figma 文件或 Google 表格的链接，就能在文档中得到即时活嵌（live-embed）。完整的支持列表请查看[集成目录](https://www.getoutline.com/integrations)。

\
我们的集成代码也是[开源](https://github.com/outline/outline)的，我们鼓励第三方开发者和社区为更多工具构建支持！

\

:::info
大多数集成只需把来自受支持服务的链接粘贴到文档里即可工作。
:::

## Slack

如果你的团队正在使用 Slack 沟通，那你一定会想启用我们的 [Slack 集成](/settings/integrations/slack)——它能为 Outline 文档提供即时的链接展开（link unfurling），并支持 `/outline` 斜杠命令，让你直接在 Slack 中搜索知识库。

## API

具备一些技术能力？Outline 构建在一个功能完备的 RPC 风格 [API](https://www.getoutline.com/developers) 之上。你可以通过编程方式创建（甚至追加内容到）文档、集合、开通用户等等。所有文档都以 Markdown 格式编辑和存储——试试下面这个 CURL 示例开始上手：

```bash
curl -XPOST -H "Content-type: application/json" -d '{
  "title": "My first document",
  "text": "Hello from the API 👋",
  "collectionId": "COLLECTION_ID", // 在浏览器地址栏 URL 中找到 collection id
  "token": "API_TOKEN", // 在 https://www.getoutline.com/settings/tokens 获取 API token
  "publish": true
}' 'https://www.getoutline.com/api/documents.create'
```
