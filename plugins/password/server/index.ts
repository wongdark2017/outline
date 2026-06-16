import coreEnv from "@server/env";
import { Hook, PluginManager } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./auth/password";
import { PasswordResetEmail } from "./email/PasswordResetEmail";
import env from "./env";

export function registerPasswordPlugin() {
  if (!env.PASSWORD_AUTH_ENABLED || coreEnv.isCloudHosted) {
    return false;
  }

  const hasProvider = PluginManager.getHooks(Hook.AuthProvider).some(
    (hook) => hook.value.id === config.id
  );
  const hasEmailTemplate = PluginManager.getHooks(Hook.EmailTemplate).some(
    (hook) => hook.value === PasswordResetEmail
  );

  if (!hasProvider) {
    PluginManager.add({
      ...config,
      type: Hook.AuthProvider,
      value: { router, id: config.id },
    });
  }

  if (!hasEmailTemplate) {
    PluginManager.add({
      ...config,
      type: Hook.EmailTemplate,
      value: PasswordResetEmail,
    });
  }

  return true;
}

void registerPasswordPlugin();
