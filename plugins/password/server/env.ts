import { IsBoolean } from "class-validator";
import { Environment } from "@server/env";
import environment from "@server/utils/environment";

class PasswordPluginEnvironment extends Environment {
  /**
   * Enables email and password authentication. Self-hosted only.
   */
  @IsBoolean()
  public PASSWORD_AUTH_ENABLED = this.toBoolean(
    environment.PASSWORD_AUTH_ENABLED ?? "false"
  );
}

export default new PasswordPluginEnvironment();
