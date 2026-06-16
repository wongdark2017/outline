import { Hook, PluginManager } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./api/figma";
import env from "./env";
import { Figma } from "./figma";
import { Minute } from "@shared/utils/time";

// 检查 Figma 插件是否已配置必需的环境变量（客户端 ID 和密钥）
const enabled = !!env.FIGMA_CLIENT_ID && !!env.FIGMA_CLIENT_SECRET;

// 仅在配置了必需的环境变量时才注册 Figma 插件
if (enabled) {
  PluginManager.add([
    {
      // 注册 Figma API 路由，用于处理 OAuth 认证和 API 请求
      ...config,
      type: Hook.API,
      value: router,
    },
    {
      // 注册 Figma 链接展开提供者，用于在文档中自动展开 Figma 链接为富媒体预览
      // 缓存过期时间设置为 10 分钟，以减少对 Figma API 的请求频率
      type: Hook.UnfurlProvider,
      value: { unfurl: Figma.unfurl, cacheExpiry: 10 * Minute.seconds },
    },
  ]);
}
