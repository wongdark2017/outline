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
        "使用以隐私优先的方式了解团队如何使用文档，在 Outline 页面中注入你自托管的 Umami 脚本来追踪浏览和参与度，同时完全掌控你的数据。",
      component: createLazyComponent(() => import("./Settings")),
      enabled: (_, user) => user.role === UserRole.Admin,
    },
  },
]);
