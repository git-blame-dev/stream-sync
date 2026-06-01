import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs";
import type { IncomingMessage } from "http";
import https from "https";
import type { AddressInfo } from "net";
import net from "net";
import os from "os";
import path from "path";
import selfsigned from "selfsigned";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createRecordingLogger } from "../../helpers/recording-logger";
import {
  initializeStaticSecrets,
  secrets,
  _resetForTesting,
} from "../../../src/core/secrets";
import { TWITCH } from "../../../src/core/endpoints";
import { safeSetTimeout } from "../../../src/utils/timeout-validator";
import {
  generateSelfSignedCert,
  buildAuthUrl,
  startCallbackServer,
  renderCallbackHtml,
  resolveBrowserOpenCommand,
  exchangeCodeForTokens,
  openBrowser,
  runOAuthFlow,
} from "../../../src/auth/oauth-flow.ts";

describe("oauth-flow behavior", () => {
  let tempDir: string;
  let tokenStorePath: string;
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  const fetchLocal = (options: https.RequestOptions) =>
    new Promise<{ statusCode: number | undefined; headers: IncomingMessage["headers"]; body: string }>((resolve, reject) => {
      const req = https.request({ ...options, agent: httpsAgent }, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          clearTimeout(timeoutId);
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        });
      });
      const timeoutId = safeSetTimeout(() => {
        req.destroy(new Error("request timeout"));
      }, 2000);
      req.on("error", (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
      req.end();
    });

  const hasErrorCode = (error: unknown, code: string): boolean => {
    return error instanceof Error && "code" in error && error.code === code;
  };

  const getServerPort = (server: net.Server | https.Server): number => {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected server to bind to a TCP port");
    }
    return (address as AddressInfo).port;
  };

  const createLocalHttpsRequest = (agent: https.Agent): typeof https.request => {
    return ((
      options: string | URL | https.RequestOptions,
      callback?: (res: IncomingMessage) => void,
    ) => {
      if (typeof options === "string" || options instanceof URL) {
        return https.request(options, { agent }, callback);
      }
      return https.request({ ...options, agent }, callback);
    }) as typeof https.request;
  };

  const createCallbackServerStub = () => ({
    server: { close: createMockFn() } as unknown as https.Server,
    waitForCode: Promise.resolve("test-auth-code"),
    port: 443,
    redirectUri: "https://example.test/callback",
  });

  const listenInPortRange = async (
    server: net.Server,
    startPort: number,
    endPort: number,
  ) => {
    let candidatePort = startPort;
    while (candidatePort <= endPort) {
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            server.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            server.off("error", onError);
            resolve();
          };

          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(candidatePort);
        });
        return candidatePort;
      } catch (error) {
        if (hasErrorCode(error, "EADDRINUSE")) {
          candidatePort += 1;
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `No available test port found in range ${startPort}-${endPort}`,
    );
  };

  beforeEach(async () => {
    _resetForTesting();
    secrets.twitch.clientSecret = "test-client-secret";
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "oauth-flow-"));
    tokenStorePath = path.join(tempDir, "token-store.json");
  });

  afterEach(async () => {
    restoreAllMocks();
    _resetForTesting();
    initializeStaticSecrets();
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

it("exposes oauth-flow helper functions", () => {
    expect(typeof generateSelfSignedCert).toBe("function");
    expect(typeof buildAuthUrl).toBe("function");
    expect(typeof startCallbackServer).toBe("function");
    expect(typeof renderCallbackHtml).toBe("function");
    expect(typeof resolveBrowserOpenCommand).toBe("function");
    expect(typeof exchangeCodeForTokens).toBe("function");
    expect(typeof openBrowser).toBe("function");
    expect(typeof runOAuthFlow).toBe("function");
  });

  it("buildAuthUrl uses Twitch authorize endpoint and required params", () => {
    const authUrl = buildAuthUrl(
      "test-client-id",
      "https://example.test/callback",
      ["test-scope-one", "test-scope-two"],
    );

    const parsed = new URL(authUrl);
    const params = parsed.searchParams;

    expect(`${parsed.origin}${parsed.pathname}`).toBe(TWITCH.OAUTH.AUTHORIZE);
    expect(params.get("client_id")).toBe("test-client-id");
    expect(params.get("redirect_uri")).toBe("https://example.test/callback");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("scope")).toBe("test-scope-one test-scope-two");
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("buildAuthUrl can use a supplied state", () => {
    const authUrl = buildAuthUrl(
      "test-client-id",
      "https://example.test/callback",
      ["test-scope"],
      "expected-state",
    );

    expect(new URL(authUrl).searchParams.get("state")).toBe("expected-state");
  });

  it("renderCallbackHtml returns headings for all outcomes", () => {
    const successHtml = renderCallbackHtml("success");
    const failedHtml = renderCallbackHtml("failed", { error: "test-error" });
    const invalidHtml = renderCallbackHtml("invalid");
    const serverHtml = renderCallbackHtml("server");

    expect(successHtml).toContain("Authentication Successful!");
    expect(failedHtml).toContain("Authentication Failed");
    expect(invalidHtml).toContain("Invalid Callback");
    expect(serverHtml).toContain("Server Error");
  });

  it("renderCallbackHtml escapes callback details", () => {
    const html = renderCallbackHtml("failed", {
      error: '<script>alert("error")</script>',
      description: "bad & worse 'quoted'",
    });

    expect(html).toContain("&lt;script&gt;alert(&quot;error&quot;)&lt;/script&gt;");
    expect(html).toContain("bad &amp; worse &#39;quoted&#39;");
    expect(html).not.toContain("<script>");
  });

  it("startCallbackServer resolves authorization code", async () => {
    const { server, waitForCode, port, redirectUri } =
      await startCallbackServer({
        port: 0,
        autoFindPort: false,
        logger: noOpLogger,
        expectedState: "expected-state",
      });
    const boundPort = getServerPort(server);

    try {
      await fetchLocal({
        hostname: "localhost",
        port: boundPort,
        path: "/?code=test-auth-code&state=expected-state",
        method: "GET",
      });

      const code = await waitForCode;

      expect(code).toBe("test-auth-code");
      expect(port).toBe(boundPort);
      expect(redirectUri).toBe(`https://localhost:${boundPort}`);
    } finally {
      server.close();
    }
  });

  it("startCallbackServer sends no-store headers on callback responses", async () => {
    const { server, waitForCode } = await startCallbackServer({
      port: 0,
      autoFindPort: false,
      logger: noOpLogger,
      expectedState: "expected-state",
    });
    const boundPort = getServerPort(server);

    try {
      const response = await fetchLocal({
        hostname: "localhost",
        port: boundPort,
        path: "/?code=test-auth-code&state=expected-state",
        method: "GET",
      });
      await waitForCode;

      expect(response.headers["cache-control"]).toBe("no-store, max-age=0");
      expect(response.headers.pragma).toBe("no-cache");
    } finally {
      server.close();
    }
  });

  it("startCallbackServer rejects OAuth errors", async () => {
    const { server, waitForCode } = await startCallbackServer({
      port: 0,
      autoFindPort: false,
      logger: noOpLogger,
    });
    const boundPort = getServerPort(server);

    const errorPromise = waitForCode.catch((error) => error);
    await fetchLocal({
      hostname: "localhost",
      port: boundPort,
      path: "/?error=access_denied&error_description=test-error",
      method: "GET",
    });

    const error = await errorPromise;
    expect(error.message).toContain("OAuth error: access_denied");
    server.close();
  });

  it("startCallbackServer rejects missing state before accepting a code", async () => {
    const { server, waitForCode } = await startCallbackServer({
      port: 0,
      autoFindPort: false,
      logger: noOpLogger,
      expectedState: "expected-state",
    });
    const boundPort = getServerPort(server);

    const errorPromise = waitForCode.catch((error) => error);
    await fetchLocal({
      hostname: "localhost",
      port: boundPort,
      path: "/?code=test-auth-code",
      method: "GET",
    });

    const error = await errorPromise;
    expect(error.message).toContain("state did not match");
    server.close();
  });

  it("startCallbackServer rejects mismatched state before provider errors", async () => {
    const { server, waitForCode } = await startCallbackServer({
      port: 0,
      autoFindPort: false,
      logger: noOpLogger,
      expectedState: "expected-state",
    });
    const boundPort = getServerPort(server);

    const errorPromise = waitForCode.catch((error) => error);
    await fetchLocal({
      hostname: "localhost",
      port: boundPort,
      path: "/?error=access_denied&state=wrong-state",
      method: "GET",
    });

    const error = await errorPromise;
    expect(error.message).toContain("state did not match");
    expect(error.message).not.toContain("OAuth error");
    server.close();
  });

  it("startCallbackServer accepts provider errors with matching state", async () => {
    const { server, waitForCode } = await startCallbackServer({
      port: 0,
      autoFindPort: false,
      logger: noOpLogger,
      expectedState: "expected-state",
    });
    const boundPort = getServerPort(server);

    const errorPromise = waitForCode.catch((error) => error);
    await fetchLocal({
      hostname: "localhost",
      port: boundPort,
      path: "/?error=access_denied&error_description=test-error&state=expected-state",
      method: "GET",
    });

    const error = await errorPromise;
    expect(error.message).toContain("OAuth error: access_denied");
    server.close();
  });

  it("startCallbackServer rejects invalid callbacks", async () => {
    const { server, waitForCode } = await startCallbackServer({
      port: 0,
      autoFindPort: false,
      logger: noOpLogger,
    });
    const boundPort = getServerPort(server);

    const errorPromise = waitForCode.catch((error) => error);
    await fetchLocal({
      hostname: "localhost",
      port: boundPort,
      path: "/",
      method: "GET",
    });

    const error = await errorPromise;
    expect(error.message).toContain("Invalid callback");
    server.close();
  });

  it("startCallbackServer returns callback metadata using the actual bound port", async () => {
    const { server, port, redirectUri } = await startCallbackServer({
      port: 0,
      autoFindPort: false,
      logger: noOpLogger,
    });

    try {
      expect(port).toBeGreaterThan(0);
      expect(redirectUri).toBe(`https://localhost:${port}`);
    } finally {
      server.close();
    }
  });

  it("startCallbackServer retries to another port when preferred port is unavailable", async () => {
    const blocker = net.createServer();
    const blockedPort = await listenInPortRange(blocker, 3000, 3100);

    let callbackServer;
    try {
      const result = await startCallbackServer({
        port: blockedPort,
        autoFindPort: true,
        logger: noOpLogger,
      });
      callbackServer = result.server;
      expect(result.port).not.toBe(blockedPort);
      expect(result.redirectUri).toBe(`https://localhost:${result.port}`);
    } finally {
      if (callbackServer) {
        callbackServer.close();
      }
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it("exchangeCodeForTokens parses Twitch response", async () => {
    const attrs = [{ name: "commonName", value: "localhost" }];
    const pems = selfsigned.generate(attrs, {
      days: 1,
      keySize: 2048,
      algorithm: "sha256",
    });
    const server = https.createServer(
      { key: pems.private, cert: pems.cert },
      (req, res) => {
        req.on("data", () => {});
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              access_token: "test-access-token",
              refresh_token: "test-refresh-token",
              expires_in: 3600,
            }),
          );
        });
      },
    );

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = getServerPort(server);
    const originalUrl = TWITCH.OAUTH.TOKEN;
    TWITCH.OAUTH.TOKEN = `https://localhost:${port}/oauth2/token`;
    const httpsRequest = createLocalHttpsRequest(httpsAgent);

    try {
      const tokens = await exchangeCodeForTokens("test-code", {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        redirectUri: "https://example.test/callback",
        logger: noOpLogger,
        httpsRequest,
      });

      expect(tokens).toMatchObject({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresIn: 3600,
      });
    } finally {
      TWITCH.OAUTH.TOKEN = originalUrl;
      server.close();
    }
  });

  it("exchangeCodeForTokens rejects invalid responses", async () => {
    const attrs = [{ name: "commonName", value: "localhost" }];
    const pems = selfsigned.generate(attrs, {
      days: 1,
      keySize: 2048,
      algorithm: "sha256",
    });
    const server = https.createServer(
      { key: pems.private, cert: pems.cert },
      (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: "test-access-token" }));
      },
    );

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = getServerPort(server);
    const originalUrl = TWITCH.OAUTH.TOKEN;
    TWITCH.OAUTH.TOKEN = `https://localhost:${port}/oauth2/token`;
    const httpsRequest = createLocalHttpsRequest(httpsAgent);

    try {
      await expect(
        exchangeCodeForTokens("test-code", {
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          redirectUri: "https://example.test/callback",
          logger: noOpLogger,
          httpsRequest,
        }),
      ).rejects.toThrow("Token exchange failed");
    } finally {
      TWITCH.OAUTH.TOKEN = originalUrl;
      server.close();
    }
  });

  it("openBrowser respects skipBrowserOpen", () => {
    expect(() =>
      openBrowser("https://example.test", noOpLogger, {
        skipBrowserOpen: true,
      }),
    ).not.toThrow();
  });

  it("resolveBrowserOpenCommand selects platform commands without side effects", () => {
    expect(resolveBrowserOpenCommand("https://example.test", { platform: "win32" }).command).toContain("start");
    expect(resolveBrowserOpenCommand("https://example.test", { platform: "darwin" }).command).toBe('open "https://example.test"');
    expect(resolveBrowserOpenCommand("https://example.test", { platform: "linux", env: {}, procVersion: "Linux microsoft" })).toMatchObject({
      command: "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command \"Start-Process 'https://example.test'\"",
      isWsl: true,
    });
    expect(resolveBrowserOpenCommand("https://example.test", { platform: "linux", env: {}, procVersion: "Linux" })).toMatchObject({
      command: 'xdg-open "https://example.test"',
      isWsl: false,
    });
  });

  it("runOAuthFlow persists tokens and returns camelCase values", async () => {
    const startCallbackServer = createMockFn().mockResolvedValue(
      createCallbackServerStub(),
    );
    const exchangeCodeForTokens = createMockFn().mockResolvedValue({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      expiresIn: 3600,
    });
    const openBrowser = createMockFn();

    const result = await runOAuthFlow(
      {
        clientId: "test-client-id",
        tokenStorePath,
        logger: noOpLogger,
      },
      {
        startCallbackServer,
        exchangeCodeForTokens,
        openBrowser,
      },
    );

    expect(result).toMatchObject({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      expiresIn: 3600,
    });

    const stored = JSON.parse(
      await fs.promises.readFile(tokenStorePath, "utf8"),
    );
    expect(stored.twitch.accessToken).toBe("test-access-token");
    expect(stored.twitch.refreshToken).toBe("test-refresh-token");
    const startOptions = startCallbackServer.mock.calls[0]?.[0] as { expectedState?: unknown } | undefined;
    const expectedState = startOptions?.expectedState;
    expect(expectedState).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (typeof expectedState !== "string") {
      throw new Error("Expected OAuth state to be generated");
    }
    const openedAuthUrl = openBrowser.mock.calls[0]?.[0];
    if (typeof openedAuthUrl !== "string") {
      throw new Error("Expected OAuth browser URL to be opened");
    }
    const openedUrl = new URL(openedAuthUrl);
    expect(openedUrl.searchParams.get("state")).toBe(expectedState);
  });

  it("runOAuthFlow returns null when exchange returns null", async () => {
    const startCallbackServer = createMockFn().mockResolvedValue(
      createCallbackServerStub(),
    );
    const exchangeCodeForTokens = async () => null as never;
    const openBrowser = createMockFn();

    const result = await runOAuthFlow(
      {
        clientId: "test-client-id",
        tokenStorePath,
        logger: noOpLogger,
      },
      {
        startCallbackServer,
        exchangeCodeForTokens,
        openBrowser,
      },
    );

    expect(result).toBeNull();
  });

  it("runOAuthFlow returns null when accessToken is missing", async () => {
    const startCallbackServer = createMockFn().mockResolvedValue(
      createCallbackServerStub(),
    );
    const exchangeCodeForTokens = async () =>
      ({ refreshToken: "test-refresh-token" }) as never;
    const openBrowser = createMockFn();

    const result = await runOAuthFlow(
      {
        clientId: "test-client-id",
        tokenStorePath,
        logger: noOpLogger,
      },
      {
        startCallbackServer,
        exchangeCodeForTokens,
        openBrowser,
      },
    );

    expect(result).toBeNull();
  });

  it("runOAuthFlow throws when clientId is missing", async () => {
    await expect(
      runOAuthFlow({ tokenStorePath, logger: noOpLogger } as Parameters<
        typeof runOAuthFlow
      >[0]),
    ).rejects.toThrow("clientId");
  });

  it("runOAuthFlow throws when tokenStorePath is missing", async () => {
    await expect(
      runOAuthFlow({ clientId: "test-client-id", logger: noOpLogger } as Parameters<
        typeof runOAuthFlow
      >[0]),
    ).rejects.toThrow("tokenStorePath");
  });

  it("exchangeCodeForTokens logs invalid token responses without token values", async () => {
    const attrs = [{ name: "commonName", value: "localhost" }];
    const pems = selfsigned.generate(attrs, {
      days: 1,
      keySize: 2048,
      algorithm: "sha256",
    });
    const server = https.createServer(
      { key: pems.private, cert: pems.cert },
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          access_token: "test-access-token",
          error: "invalid_grant",
          "test-private-dynamic-key test-client-secret": "value",
        }));
      },
    );

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = getServerPort(server);
    const originalUrl = TWITCH.OAUTH.TOKEN;
    TWITCH.OAUTH.TOKEN = `https://localhost:${port}/oauth2/token`;
    const localHttpsAgent = new https.Agent({ rejectUnauthorized: false });
    const httpsRequest = createLocalHttpsRequest(localHttpsAgent);
    const logger = createRecordingLogger();

    try {
      await expect(
        exchangeCodeForTokens("test-code", {
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          redirectUri: "https://example.test/callback",
          logger,
          httpsRequest,
        }),
      ).rejects.toThrow("Token exchange failed");

      const serializedLogs = JSON.stringify(logger.entries);
      expect(serializedLogs).toContain("Invalid token response");
      expect(serializedLogs).toContain("hasAccessToken");
      expect(serializedLogs).not.toContain("test-access-token");
      expect(serializedLogs).not.toContain("test-client-secret");
      expect(serializedLogs).not.toContain("test-private-dynamic-key");
    } finally {
      TWITCH.OAUTH.TOKEN = originalUrl;
      server.close();
    }
  });
});
