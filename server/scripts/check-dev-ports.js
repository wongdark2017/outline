/* oxlint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const dotenv = require("@dotenvx/dotenvx");

// dev:watch always starts the backend in development mode.
process.env.NODE_ENV = "development";

/**
 * Reads an optional environment file with the backend's dotenv parser.
 *
 * @param {string} filename the environment file name.
 * @returns {Record<string, string>} the parsed variables.
 */
function readEnvironment(filename) {
  const resolvedPath = path.resolve(process.cwd(), filename);
  return fs.existsSync(resolvedPath)
    ? dotenv.parse(fs.readFileSync(resolvedPath, "utf8"))
    : {};
}

/**
 * Resolves the development port before the server's TypeScript is compiled.
 *
 * @returns {number} the configured application port.
 */
function getApplicationPort() {
  const defaults = readEnvironment(".env");
  let environment = { ...defaults };

  // Match server/utils/environment.ts, including the mode declared in .env.
  for (const mode of ["production", "development", "local", "test"]) {
    if (
      mode === "development" ||
      mode === "local" ||
      defaults.NODE_ENV === mode
    ) {
      environment = { ...environment, ...readEnvironment(`.env.${mode}`) };
    }
  }
  environment = { ...environment, ...process.env };

  // These are the equals-sign forms accepted by server/utils/args.ts.
  const words =
    (process.env.OUTLINE_SERVER_ARGS || "").match(
      /(?:[^\s"']+|"[^"]*"|'[^']*')+/g
    ) || [];
  const argument = words
    .map((arg) => arg.replace(/(["'])(.*?)\1/g, "$2"))
    .filter((arg) => arg === "--port" || /^(--port|-p)=/.test(arg))
    .map((arg) => (arg.split("=")[1] ?? "true").trim())
    .join(",");
  const configuredPort =
    environment.PORT ??
    (environment.PORT_FILE
      ? fs.readFileSync(environment.PORT_FILE, "utf8").trim()
      : undefined);
  const port = argument
    ? Number(argument)
    : configuredPort
      ? parseInt(configuredPort, 10)
      : 3000;

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      "Invalid development port. Set PORT or --port=N to a valid TCP port."
    );
  }
  if (port === 3001) {
    throw new Error(
      "Application PORT cannot be 3001: Vite uses this port. Choose another application port."
    );
  }
  return port;
}

/**
 * Checks a local address by binding and immediately releasing it.
 *
 * @param {number} port the TCP port to check.
 * @param {string} host the IPv4 or IPv6 wildcard address.
 * @returns {Promise<void>} resolves when the address is available.
 */
function checkPort(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (
        host === "::" &&
        ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)
      ) {
        resolve();
        return;
      }
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use. Outline development was not started. ` +
              "Use the existing instance, or stop it with Ctrl+C in its terminal before retrying make up / yarn dev:watch. " +
              `To identify the listener: lsof -nP -iTCP:${port} -sTCP:LISTEN`
          )
        );
        return;
      }
      reject(error);
    });
    server.listen(
      { port, host, ipv6Only: host === "::", exclusive: true },
      () => {
        server.close((error) => (error ? reject(error) : resolve()));
      }
    );
  });
}

/**
 * Verifies both application and Vite ports before building or spawning watchers.
 *
 * @returns {Promise<void>} resolves after all probes have released their ports.
 */
async function main() {
  const port = getApplicationPort();
  for (const candidate of [port, 3001]) {
    if (candidate === 0) {
      continue;
    }
    await checkPort(candidate, "0.0.0.0");
    await checkPort(candidate, "::");
  }
}

main().catch((error) => {
  process.stderr.write(`[dev] ${error.message}\n`);
  process.exitCode = 1;
});
