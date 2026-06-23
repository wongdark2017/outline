/* oxlint-disable @typescript-eslint/no-misused-promises */
/* oxlint-disable import/order */
import cluster from "node:cluster";
import http from "node:http";
import https from "node:https";
import type { Context } from "koa";
import Koa from "koa";
import helmet from "koa-helmet";
import logger from "koa-logger";
import Router from "koa-router";
import type { AddressInfo } from "node:net";
import stoppable from "stoppable";
import throng from "throng";
import { escape } from "es-toolkit/compat";
import type * as EnvModule from "./env";
import type * as LoggerModule from "./logging/Logger";
import type * as ServicesModule from "./services";
import type * as ArgsModule from "./utils/args";
import type * as SslModule from "./utils/ssl";
import type * as RateLimiterModule from "@server/middlewares/rateLimiter";
import type * as StartupModule from "./utils/startup";
import type * as UpdatesModule from "./utils/updates";
import type * as OnErrorModule from "./onerror";
import type * as ShutdownHelperModule from "./utils/ShutdownHelper";
import type * as DatabaseModule from "./storage/database";
import type * as RedisModule from "@server/storage/redis";
import type * as MetricsModule from "@server/logging/Metrics";
import type * as CacheHelperModule from "./utils/CacheHelper";
import type * as RedisPrefixHelperModule from "./utils/RedisPrefixHelper";
import type * as PluginManagerModule from "./utils/PluginManager";
import {
  bootstrapSystemSettings,
  runPreBootstrapMigrations,
} from "./utils/systemSettingsBootstrap";

interface RuntimeModules {
  Logger: typeof LoggerModule.default;
  services: typeof ServicesModule.default;
  getArg: typeof ArgsModule.getArg;
  getSSLOptions: typeof SslModule.getSSLOptions;
  defaultRateLimiter: typeof RateLimiterModule.defaultRateLimiter;
  printEnv: typeof StartupModule.printEnv;
  checkPendingMigrations: typeof StartupModule.checkPendingMigrations;
  checkUpdates: typeof UpdatesModule.checkUpdates;
  onerror: typeof OnErrorModule.default;
  ShutdownHelper: typeof ShutdownHelperModule.default;
  ShutdownOrder: typeof ShutdownHelperModule.ShutdownOrder;
  checkConnection: typeof DatabaseModule.checkConnection;
  sequelize: typeof DatabaseModule.sequelize;
  Redis: typeof RedisModule.default;
  Metrics: typeof MetricsModule.default;
  CacheHelper: typeof CacheHelperModule.CacheHelper;
  RedisPrefixHelper: typeof RedisPrefixHelperModule.RedisPrefixHelper;
  PluginManager: typeof PluginManagerModule.PluginManager;
}

let runtimeModules: RuntimeModules | undefined;
let envModule: typeof EnvModule | undefined;

// The number of processes to run, defaults to the number of CPU's available
// for the web service, and 1 for collaboration unless REDIS_COLLABORATION_URL is set.
let webProcessCount: number | undefined;

// This function will only be called once in the original process
async function master() {
  const {
    checkConnection,
    checkPendingMigrations,
    checkUpdates,
    printEnv,
    sequelize,
  } = await loadRuntimeModules();
  const env = await loadEnv();

  await checkConnection(sequelize);
  await checkPendingMigrations();
  await printEnv();

  if (env.TELEMETRY && env.isProduction) {
    void checkUpdates();
    setInterval(checkUpdates, 24 * 3600 * 1000);
  }
}

// This function will only be called in each forked process
async function start(_id: number, disconnect: () => void) {
  const {
    CacheHelper,
    defaultRateLimiter,
    getArg,
    getSSLOptions,
    Logger,
    Metrics,
    onerror,
    PluginManager,
    Redis,
    RedisPrefixHelper,
    services,
    sequelize,
    ShutdownHelper,
    ShutdownOrder,
  } = await loadRuntimeModules();
  const env = await loadEnv();

  // Ensure plugins are loaded
  PluginManager.loadPlugins();

  // Clear unfurl cache in development so code changes take effect immediately
  if (env.isDevelopment) {
    void CacheHelper.clearData(RedisPrefixHelper.getUnfurlKey(""));
  }

  // Find if SSL certs are available
  const ssl = getSSLOptions();
  const useHTTPS = !!ssl.key && !!ssl.cert;

  // If a --port flag is passed then it takes priority over the env variable
  const normalizedPort = getArg("port", "p") || env.PORT;
  const app = new Koa();
  const server = stoppable(
    useHTTPS
      ? https.createServer(ssl, app.callback())
      : http.createServer(app.callback()),
    ShutdownHelper.connectionGraceTimeout
  );
  const router = new Router();

  // install basic middleware shared by all services
  if (env.DEBUG.includes("http")) {
    app.use(logger((str) => Logger.info("http", str)));
  }

  app.use(helmet());

  // catch errors in one place, automatically set status and response headers
  onerror(app);

  // Apply default rate limit to all routes
  app.use(defaultRateLimiter());

  /** Perform a redirect on the browser so that the user's auth cookies are included in the request. */
  app.context.redirectOnClient = function (
    this: Context,
    /** The URL to redirect to */
    url: string,
    /**
     * The HTTP method to use for the redirect. Use POST when preventing links in emails from being
     * clicked by bots. Otherwise, use GET.
     */
    method: "GET" | "POST" = "GET"
  ) {
    this.type = "text/html";

    if (method === "POST") {
      // For POST method, create a form that auto-submits
      const urlObj = new URL(url);
      const formAction = `${urlObj.origin}${urlObj.pathname}`;
      const searchParams = urlObj.searchParams;

      let formFields = "";
      searchParams.forEach((value, key) => {
        formFields += `<input type="hidden" name="${escape(
          key
        )}" value="${escape(value)}" />`;
      });

      if (this.userAgent.isBot) {
        formFields += `
          <p>If you are not redirected automatically, please click the button below.</p>
          <input type="submit" value="Continue" />
        `;
      }

      this.body = `
<html lang="en">
<head>
  <title>Redirecting…</title>
</head>
<body>
  <form id="redirect-form" method="POST" action="${formAction}">
    ${formFields}
  </form>
  <script nonce="${this.state.cspNonce}">
    ${!this.userAgent.isBot} && document.getElementById('redirect-form').submit();
  </script>
</body>
</html>`;
    } else {
      // Default GET method using meta refresh
      this.body = `
<html lang="en">
<head>
<meta http-equiv="refresh" content="0;URL='${escape(url)}'" />
</head>
</html>`;
    }
  };

  // Add a health check endpoint to all services
  router.get("/_health", async (ctx) => {
    try {
      await sequelize.query("SELECT 1");
    } catch (err) {
      Logger.error("Database connection failed", err);
      ctx.status = 500;
      return;
    }

    try {
      await Redis.defaultClient.ping();
    } catch (err) {
      Logger.error("Redis ping failed", err);
      ctx.status = 500;
      return;
    }

    ctx.body = "OK";
  });

  app.use(router.routes());

  // loop through requested services at startup
  for (const name of env.SERVICES) {
    if (!Object.keys(services).includes(name)) {
      throw new Error(`Unknown service ${name}`);
    }

    Logger.info("lifecycle", `Starting ${name} service`);
    const init = services[name as keyof typeof services];
    await init(app, server as https.Server, env.SERVICES);
  }

  server.on("error", (err) => {
    if ("code" in err && err.code === "EADDRINUSE") {
      Logger.error(`Port ${normalizedPort} is already in use. Exiting…`, err);
      process.exit(0);
    }

    if ("code" in err && err.code === "EACCES") {
      Logger.error(
        `Port ${normalizedPort} requires elevated privileges. Exiting…`,
        err
      );
      process.exit(0);
    }

    throw err;
  });
  server.on("listening", () => {
    const address = server.address();
    const port = (address as AddressInfo).port;

    Logger.info(
      "lifecycle",
      `Listening on ${useHTTPS ? "https" : "http"}://localhost:${port} / ${
        env.URL
      }`
    );
  });

  server.listen(normalizedPort);
  server.setTimeout(env.REQUEST_TIMEOUT);

  ShutdownHelper.add(
    "server",
    ShutdownOrder.last,
    () =>
      new Promise((resolve, reject) => {
        // Calling stop prevents new connections from being accepted and waits for
        // existing connections to close for the grace period before forcefully
        // closing them.
        server.stop((err, gracefully) => {
          disconnect();

          if (err) {
            reject(err);
          } else {
            resolve(gracefully);
          }
        });
      })
  );

  ShutdownHelper.add("metrics", ShutdownOrder.last, () => Metrics.flush());

  // Handle uncaught promise rejections
  process.on("unhandledRejection", (error: Error) => {
    Logger.error("Unhandled promise rejection", error, {
      stack: error.stack,
    });
  });

  // Handle shutdown signals
  process.once("SIGTERM", () => ShutdownHelper.execute());
  process.once("SIGINT", () => ShutdownHelper.execute());
}

void startServer();

async function startServer() {
  if (!cluster.isWorker) {
    await runPreBootstrapMigrations();
  }

  await bootstrapSystemSettings();
  const env = await reloadEnv();

  await loadRuntimeModules();

  webProcessCount = env.WEB_CONCURRENCY;

  if (env.SERVICES.includes("collaboration") && !env.REDIS_COLLABORATION_URL) {
    if (webProcessCount !== 1) {
      const { Logger } = await loadRuntimeModules();
      Logger.info(
        "lifecycle",
        "Note: Restricting process count to 1 due to use of collaborative service without REDIS_COLLABORATION_URL"
      );
    }

    webProcessCount = 1;
  }

  const isWebProcess =
    env.SERVICES.includes("web") ||
    env.SERVICES.includes("api") ||
    env.SERVICES.includes("collaboration");

  void throng({
    master,
    worker: start,
    count: isWebProcess ? webProcessCount : undefined,
  });
}

async function loadRuntimeModules() {
  if (runtimeModules) {
    return runtimeModules;
  }

  await import("./logging/tracer"); // must come before importing instrumented modules

  const [
    LoggerModule,
    servicesModule,
    argsModule,
    sslModule,
    rateLimiterModule,
    startupModule,
    updatesModule,
    onerrorModule,
    shutdownHelperModule,
    databaseModule,
    redisModule,
    metricsModule,
    cacheHelperModule,
    redisPrefixHelperModule,
    pluginManagerModule,
  ] = await Promise.all([
    import("./logging/Logger"),
    import("./services"),
    import("./utils/args"),
    import("./utils/ssl"),
    import("@server/middlewares/rateLimiter"),
    import("./utils/startup"),
    import("./utils/updates"),
    import("./onerror"),
    import("./utils/ShutdownHelper"),
    import("./storage/database"),
    import("@server/storage/redis"),
    import("@server/logging/Metrics"),
    import("./utils/CacheHelper"),
    import("./utils/RedisPrefixHelper"),
    import("./utils/PluginManager"),
  ]);

  runtimeModules = {
    Logger: LoggerModule.default,
    services: servicesModule.default,
    getArg: argsModule.getArg,
    getSSLOptions: sslModule.getSSLOptions,
    defaultRateLimiter: rateLimiterModule.defaultRateLimiter,
    printEnv: startupModule.printEnv,
    checkPendingMigrations: startupModule.checkPendingMigrations,
    checkUpdates: updatesModule.checkUpdates,
    onerror: onerrorModule.default,
    ShutdownHelper: shutdownHelperModule.default,
    ShutdownOrder: shutdownHelperModule.ShutdownOrder,
    checkConnection: databaseModule.checkConnection,
    sequelize: databaseModule.sequelize,
    Redis: redisModule.default,
    Metrics: metricsModule.default,
    CacheHelper: cacheHelperModule.CacheHelper,
    RedisPrefixHelper: redisPrefixHelperModule.RedisPrefixHelper,
    PluginManager: pluginManagerModule.PluginManager,
  };

  return runtimeModules;
}

async function loadEnv() {
  if (envModule) {
    return envModule.default;
  }

  envModule = await import("./env");
  return envModule.default;
}

async function reloadEnv() {
  if (!envModule) {
    envModule = await import("./env");
    return envModule.default;
  }

  return envModule.reloadEnvironment();
}
