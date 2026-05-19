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
        "通过自托管的开源分析平台跟踪你的文档，将 Outline 连接到 Matomo，在你自己的服务器上实现 100% 数据掌控、GDPR 合规以及深入的使用洞察。",
      component: createLazyComponent(() => import("./Settings")),
      enabled: (_, user) => user.role === UserRole.Admin,
    },
  },
]);
