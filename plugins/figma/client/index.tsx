import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import Icon from "./Icon";
import { createLazyComponent } from "~/components/LazyLoad";

PluginManager.add([
  {
    ...config,
    type: Hook.Settings,
    value: {
      group: "Integrations",
      icon: Icon,
      description:
        "连接你的 Figma 账号到 Outline，以便在文档中启用丰富的设计文件预览。",
      component: createLazyComponent(() => import("./Settings")),
    },
  },
]);
