import { createLazyComponent } from "~/components/LazyLoad";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import Icon from "./Icon";

PluginManager.add([
  {
    ...config,
    type: Hook.Settings,
    value: {
      group: "Workspace",
      after: "Shared Links",
      icon: Icon,
      description:
        "通过实时 JSON POST 自动化下游工作流，订阅 Outline 中的事件，使外部系统能够即时响应。",
      component: createLazyComponent(() => import("./Settings")),
    },
  },
]);
