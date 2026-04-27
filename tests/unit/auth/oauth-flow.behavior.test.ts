import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs";
import https from "https";
import net from "net";
import os from "os";
import path from "path";
import selfsigned from "selfsigned";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
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
  exchangeCodeForTokens,
  openBrowser,
  runOAuthFlow,
} from "../../../src/auth/oauth-flow.ts";

describe("oauth-flow behavior", () => {
  let tempDir;
  let tokenStorePath;
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  const fetchLocal = (options) =>
    new Promise((resolve, reject) => {
      const req = https.request({ ...options, agent: httpsAgent }, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          clearTimeout(timeoutId);
          resolve({ statusCode: res.statusCode, body: data });
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

  const listenInPortRange = async (server, startPort, endPort) => {
    let candidatePort = startPort;
    while (candidatePort <= endPort) {
      try {
        await new Promise((resolve, reject) => {
          const onError = (error) => {
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
        if (error.code === "EADDRINUSE") {
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
    expect(params.get("state").startsWith("cb_")).toBe(true);
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

  it("startCallbackServer resolves authorization code", async () => {
    const { server, waitForCode, port, redirectUri } =
      await startCallbackServer({
        port: 0,
        autoFindPort: false,
        logger: noOpLogger,
      });
    const boundPort = server.address().port;

    try {
      await fetchLocal({
        hostname: "localhost",
        port: boundPort,
        path: "/?code=test-auth-code",
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

  it("startCallbackServer rejects OAuth errors", async () => {
    const { server, waitForCode } = await startCallbackServer({
      port: 0,
      autoFindPort: false,
      logger: noOpLogger,
    });
    const boundPort = server.address().port;

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

  it("startCallbackServer rejects invalid callbacks", async () => {
    const { server, waitForCode } = await startCallbackServer({
      port: 0,
      autoFindPort: false,
      logger: noOpLogger,
    });
    const boundPort = server.address().port;

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

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const originalUrl = TWITCH.OAUTH.TOKEN;
    TWITCH.OAUTH.TOKEN = `https://localhost:${port}/oauth2/token`;
    const httpsRequest = (options, callback) =>
      https.request({ ...options, agent: httpsAgent }, callback);

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

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const originalUrl = TWITCH.OAUTH.TOKEN;
    TWITCH.OAUTH.TOKEN = `https://localhost:${port}/oauth2/token`;
    const httpsRequest = (options, callback) =>
      https.request({ ...options, agent: httpsAgent }, callback);

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

  it("runOAuthFlow persists tokens and returns camelCase values", async () => {
    const startCallbackServer = createMockFn().mockResolvedValue({
      server: { close: createMockFn() },
      waitForCode: Promise.resolve("test-auth-code"),
      redirectUri: "https://example.test/callback",
    });
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
  });

  it("runOAuthFlow returns null when exchange returns null", async () => {
    const startCallbackServer = createMockFn().mockResolvedValue({
      server: { close: createMockFn() },
      waitForCode: Promise.resolve("test-auth-code"),
      redirectUri: "https://example.test/callback",
    });
    const exchangeCodeForTokens = createMockFn().mockResolvedValue(null);
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
    const startCallbackServer = createMockFn().mockResolvedValue({
      server: { close: createMockFn() },
      waitForCode: Promise.resolve("test-auth-code"),
      redirectUri: "https://example.test/callback",
    });
    const exchangeCodeForTokens = createMockFn().mockResolvedValue({
      refreshToken: "test-refresh-token",
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

    expect(result).toBeNull();
  });

  it("runOAuthFlow throws when clientId is missing", async () => {
    await expect(
      runOAuthFlow({ tokenStorePath, logger: noOpLogger }),
    ).rejects.toThrow("clientId");
  });

  it("runOAuthFlow throws when tokenStorePath is missing", async () => {
    await expect(
      runOAuthFlow({ clientId: "test-client-id", logger: noOpLogger }),
    ).rejects.toThrow("tokenStorePath");
  });
});
