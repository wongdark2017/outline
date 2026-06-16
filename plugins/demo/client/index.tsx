import { createLazyComponent } from "~/components/LazyLoad";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import Icon from "./Icon";

PluginManager.add({
  ...config,
  type: Hook.Settings,
  value: {
    group: "Integrations",
    icon: Icon,
    description: "Demo plugin settings page.",
    component: createLazyComponent(() => import("./Settings")),
  },
});
