const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const rootDir = path.join(__dirname, "..");
const tsxCli = require.resolve("tsx/cli");
const electronCli = require.resolve("electron/cli.js");
const children = new Set();

function start(command, args) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "inherit",
    windowsHide: false,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function stop(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}

function waitForServer(timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Servidor dev não respondeu em http://127.0.0.1:3001"));
        return;
      }
      setTimeout(probe, 200);
    };
    const probe = () => {
      const request = http.get("http://127.0.0.1:3001/", response => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
        } else {
          retry();
        }
      });
      request.on("error", retry);
      request.setTimeout(500, () => request.destroy());
    };
    probe();
  });
}

async function main() {
  const server = start(process.execPath, [tsxCli, "server/bin/dev-server.ts"]);
  try {
    await waitForServer();
    const electron = start(process.execPath, [electronCli, "."]);
    electron.once("exit", code => {
      stop(server);
      process.exit(code ?? 0);
    });
  } catch (error) {
    console.error(`[electron:dev] ${error.message}`);
    stop(server);
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    for (const child of children) stop(child);
    process.exit(0);
  });
}

main().catch(error => {
  console.error(error);
  for (const child of children) stop(child);
  process.exit(1);
});
