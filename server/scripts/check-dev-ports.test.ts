import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const script = path.resolve(__dirname, "check-dev-ports.js");
const listeners: net.Server[] = [];
let directory: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "outline-dev-ports-"));
});

afterEach(async () => {
  await Promise.all(listeners.splice(0).map(close));
  await fs.rm(directory, { recursive: true, force: true });
});

function close(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function listen(host = "127.0.0.1", port = 0) {
  const server = net.createServer((socket) => socket.end("still alive"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port, ipv6Only: host.includes(":") }, resolve);
  });
  listeners.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP listener");
  }
  return { server, port: address.port };
}

async function freePort() {
  const { server, port } = await listen();
  listeners.splice(listeners.indexOf(server), 1);
  await close(server);
  return port;
}

function run(environment: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env };
  delete env.PORT;
  delete env.PORT_FILE;
  delete env.OUTLINE_SERVER_ARGS;
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [script], {
        cwd: directory,
        env: { ...env, ...environment },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Development port check did not exit"));
      }, 5000);
      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        resolve({ code, stdout, stderr });
      });
    }
  );
}

function expectListenerAlive(port: number, host = "127.0.0.1") {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect({ port, host });
    let message = "";
    socket.once("error", reject);
    socket.on("data", (data) => {
      message += data.toString();
    });
    socket.once("end", () => {
      try {
        expect(message).toBe("still alive");
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

describe("development port preflight", () => {
  it("rejects the occupied default application port once without stopping its owner", async () => {
    await listen("127.0.0.1", 3000);

    const result = await run();

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.match(/Port 3000 is already in use/g)).toHaveLength(1);
    expect(result.stderr).toContain("Ctrl+C");
    expect(result.stderr).toContain("lsof -nP -iTCP:3000 -sTCP:LISTEN");
    await expectListenerAlive(3000);
  });

  it.each(["127.0.0.1", "::1"])("detects a listener on %s", async (host) => {
    const { port } = await listen(host);

    const result = await run({ PORT: String(port) });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`Port ${port} is already in use`);
    await expectListenerAlive(port, host);
  });

  it("rejects an occupied Vite port and releases the application probe", async () => {
    await listen("127.0.0.1", 3001);
    const port = await freePort();

    const result = await run({ PORT: String(port) });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Port 3001 is already in use");
    await expectListenerAlive(3001);
    await listen("127.0.0.1", port);
  });

  it.each(["shell", ".env.local", ".env.development", ".env"])(
    "resolves PORT from %s with backend precedence",
    async (source) => {
      const { port } = await listen();
      const sources = [".env", ".env.development", ".env.local", "shell"];
      const priority = sources.indexOf(source);
      for (const file of sources.slice(0, priority + 1)) {
        if (file !== "shell") {
          await fs.writeFile(
            path.join(directory, file),
            `PORT=${file === source ? port : 0}\n`
          );
        }
      }

      const result = await run(
        source === "shell" ? { PORT: String(port) } : {}
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`Port ${port} is already in use`);
    }
  );

  it("uses development mode even when .env declares production", async () => {
    const { port } = await listen();
    await fs.writeFile(
      path.join(directory, ".env"),
      "NODE_ENV=production\nPORT=0\n"
    );
    await fs.writeFile(path.join(directory, ".env.production"), "PORT=0\n");
    await fs.writeFile(
      path.join(directory, ".env.development"),
      `PORT=${port}\n`
    );

    const result = await run();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`Port ${port} is already in use`);
  });

  it.each(["--port", "-p"])(
    "honors %s=N before environment configuration",
    async (flag) => {
      const { port } = await listen();

      const result = await run({
        PORT: "0",
        OUTLINE_SERVER_ARGS: `--no-migrate ${flag}=${port}`,
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`Port ${port} is already in use`);
    }
  );

  it("reads PORT_FILE when PORT is unset", async () => {
    const { port } = await listen();
    const file = path.join(directory, "port");
    await fs.writeFile(file, ` ${port}\n`);

    const result = await run({ PORT_FILE: file });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`Port ${port} is already in use`);
  });

  it.each(['--port="N"', "'--port=N'", "-p=' N '"])(
    "supports a quoted port argument %s",
    async (argument) => {
      const { port } = await listen();

      const result = await run({
        PORT: "0",
        OUTLINE_SERVER_ARGS: argument.replace("N", String(port)),
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`Port ${port} is already in use`);
    }
  );

  it("ignores unrelated arguments containing a port-like suffix", async () => {
    const { port } = await listen();

    const result = await run({
      PORT: String(port),
      OUTLINE_SERVER_ARGS: "--other-p=0",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`Port ${port} is already in use`);
  });

  it.each(["invalid", "65536", "3001"])(
    "rejects invalid development PORT=%s without spawning services",
    async (port) => {
      const result = await run({ PORT: port });

      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(
        /Invalid development port|Vite uses this port/
      );
    }
  );

  it("exits cleanly and releases both available ports", async () => {
    const port = await freePort();

    const result = await run({ PORT: String(port) });

    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
    await listen("127.0.0.1", port);
    await listen("127.0.0.1", 3001);
  });
});
