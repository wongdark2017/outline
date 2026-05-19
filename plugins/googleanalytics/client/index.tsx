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
        "将浏览和事件分析直接发送到你的 GA4 仪表板，以衡量使用情况和参与度。",
      component: createLazyComponent(() => import("./Settings")),
    },
  },
]);
