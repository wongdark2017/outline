import { createLazyComponent } from "~/components/LazyLoad";
import { PluginManager, Hook } from "~/utils/PluginManager";
import { KeyIcon } from "outline-icons";
import config from "../plugin.json";

PluginManager.add([
  {
    ...config,
    type: Hook.Icon,
    value: KeyIcon,
  },
  {
    ...config,
    type: Hook.Settings,
    value: {
      group: "Account",
      after: "Notifications",
      icon: KeyIcon,
      description:
        "管理你的通行密钥，使用生物识别或安全密钥进行无密码认证。",
      component: createLazyComponent(() => import("./Settings")),
      enabled: () => true,
    },
  },
]);
