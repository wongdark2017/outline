import { UserRole } from "@shared/types";
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
        "配置自定义的 Diagrams.net 安装 URL，以使用你自托管的实例在文档中嵌入图表。",
      component: createLazyComponent(() => import("./Settings")),
      enabled: (_, user) => user.role === UserRole.Admin,
    },
  },
]);
