import { Hook, PluginManager } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./api/demo";

PluginManager.add({
  ...config,
  type: Hook.API,
  value: router,
});
