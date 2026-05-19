import { createLazyComponent } from "~/components/LazyLoad";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import Icon from "./components/Icon";

PluginManager.add([
  {
    ...config,
    type: Hook.Settings,
    value: {
      group: "Integrations",
      icon: Icon,
      description:
        "连接你的 GitLab 账号到 Outline，以便在文档中启用丰富的实时 issue 和 merge request 预览。",
      component: createLazyComponent(() => import("./Settings")),
    },
  },
]);
