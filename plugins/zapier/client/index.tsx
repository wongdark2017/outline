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
        "将你的 Outline 工作区连接到 Zapier，以自动化工作流并集成成千上万的其他工具。",
      component: createLazyComponent(() => import("./Settings")),
    },
  },
]);
