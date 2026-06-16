import { Hook, PluginManager } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./api/journal";
import JournalProcessor from "./processors/JournalProcessor";

PluginManager.add([
  {
    ...config,
    type: Hook.API,
    value: router,
  },
  {
    ...config,
    type: Hook.Processor,
    value: JournalProcessor,
  },
]);
