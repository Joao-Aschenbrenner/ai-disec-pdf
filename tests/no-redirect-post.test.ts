import { readFileSync } from "node:fs";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fetchNoRedirect } from "../noRedirectFetch";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a loopback TCP address");
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe.each([301, 302, 303, 307, 308])("sensitive POST redirect status %i", (status) => {
  it("does not resend the synthetic image or credentials", async () => {
    let sourceRequests = 0;
    let targetRequests = 0;
    let sourceUrl = "";
    let sourceMethod = "";
    let sourceAuthorization = "";
    let sourceApiKey = "";
    let sourceBody = "";
    const server = createServer((request, response) => {
      if (request.url?.startsWith("/source")) {
        sourceRequests += 1;
        sourceUrl = request.url;
        sourceMethod = request.method || "";
        sourceAuthorization = String(request.headers.authorization || "");
        sourceApiKey = String(request.headers["x-api-key"] || "");
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          sourceBody = Buffer.concat(chunks).toString("utf8");
          response.writeHead(status, { Location: "/target?key=synthetic-query-test-only" });
          response.end();
        });
        return;
      }

      if (request.url?.startsWith("/target")) {
        targetRequests += 1;
        response.writeHead(200);
        response.end("synthetic target");
        return;
      }

      response.writeHead(404);
      response.end();
    });

    const port = await listen(server);
    const body = JSON.stringify({ image: "data:image/png;base64,U1lOVEhFVElD" });
    try {
      await expect(fetchNoRedirect("http://127.0.0.1:" + port + "/source?key=synthetic-query-test-only", {
        method: "POST",
        redirect: "follow",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer synthetic-unit-test-only",
          "x-api-key": "synthetic-header-key-only",
        },
        body,
      })).rejects.toThrow();

      expect(sourceRequests).toBe(1);
      expect(sourceUrl).toBe("/source?key=synthetic-query-test-only");
      expect(sourceMethod).toBe("POST");
      expect(sourceAuthorization).toBe("Bearer synthetic-unit-test-only");
      expect(sourceApiKey).toBe("synthetic-header-key-only");
      expect(sourceBody).toBe(body);
      expect(targetRequests).toBe(0);
    } finally {
      await close(server);
    }
  });
});

describe("fetchNoRedirect", () => {
  it("preserves a normal response when the endpoint does not redirect", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("synthetic success");
    });
    const port = await listen(server);
    try {
      const response = await fetchNoRedirect("http://127.0.0.1:" + port + "/ok", { method: "POST", body: "synthetic" });
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("synthetic success");
    } finally {
      await close(server);
    }
  });
});

describe("redirect policy wiring", () => {
  it("routes server and Laya HTTP calls through the shared guard", () => {
    for (const relativePath of ["server/server.ts", "server/classification/layaClient.ts", "src/App.tsx", "scripts/benchmark-adaptive.ts"]) {
      const source = readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
      expect(source).toContain("fetchNoRedirect(");
      expect(source).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("preserves the benchmark nosemgrep annotation", () => {
    const source = readFileSync(path.resolve(process.cwd(), "scripts/benchmark-adaptive.ts"), "utf8");
    expect(source).toContain("nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request");
  });

  it("rejects redirects in the credential-bearing model updater", () => {
    const source = readFileSync(path.resolve(process.cwd(), "scripts/update-models.cjs"), "utf8");
    expect(source).toContain('const res = await fetch(url, { headers, redirect: "error" });');
  });
});