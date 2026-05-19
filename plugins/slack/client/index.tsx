import { createLazyComponent } from "~/components/LazyLoad";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import Icon from "./Icon";

PluginManager.add([
  {
    ...config,
    type: Hook.Settings,
    value: {
      group: "Integrations",
      icon: Icon,
      description:
        "直接在 Slack 中搜索你的知识库，使用 /outline 搜索命令，查看丰富的链接预览，并接收新建或更新文档的通知。",
      component: createLazyComponent(() => import("./Settings")),
      enabled: () => true,
    },
  },
  {
    ...config,
    type: Hook.Icon,
    value: Icon,
  },
]);
