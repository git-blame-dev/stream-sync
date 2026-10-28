import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import {
  initializeStaticSecrets,
  secrets,
  _resetForTesting,
} from "../../../src/core/secrets";
import { TwitchAuth } from "../../../src/auth/TwitchAuth.ts";
import { HttpRetryExecutor } from "../../../src/utils/http-retry-executor";

const requiredScopes = [
  "user:read:chat",
  "chat:edit",
  "channel:read:subscriptions",
  "bits:read",
  "moderator:read:followers",
];

type TokenStorePayload = Record<string, unknown>;
type CreateAuthOptions = {
  tokenStorePathOverride?: string;
  clientId?: unknown;
  expectedUsername?: unknown;
  httpClient?: unknown;
  oauthFlow?: unknown;
  retryExecutor?: unknown;
};

const buildValidationResponse = (overrides: Record<string, unknown> = {}) => ({
  data: {
    user_id: "test-user-id",
    client_id: "test-client-id",
    login: "test-user",
    scopes: requiredScopes,
    expires_in: 3600,
    ...overrides,
  },
});

describe("TwitchAuth behavior", () => {
  let tempDir: string;
  let tokenStorePath: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    _resetForTesting();
    secrets.twitch.clientSecret = "test-client-secret";
    delete process.env.TWITCH_DISABLE_AUTH;
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "twitch-auth-"));
    tokenStorePath = path.join(tempDir, "token-store.json");
  });

  afterEach(async () => {
    restoreAllMocks();
    _resetForTesting();
    initializeStaticSecrets();
    process.env = { ...originalEnv };
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  const writeTokenStore = async (payload: TokenStorePayload) => {
    const content = JSON.stringify(payload, null, 2);
    await fs.promises.writeFile(tokenStorePath, content, "utf8");
  };

  const createAuth = ({
    tokenStorePathOverride = tokenStorePath,
    clientId = "test-client-id",
    expectedUsername = "test-user",
    httpClient,
    oauthFlow,
    retryExecutor,
  }: CreateAuthOptions = {}) => {
    const authOptions: ConstructorParameters<typeof TwitchAuth>[0] = {
      tokenStorePath: tokenStorePathOverride,
      clientId,
      expectedUsername,
      logger: noOpLogger,
    };
    if (httpClient !== undefined) {
      authOptions.httpClient = httpClient as NonNullable<
        ConstructorParameters<typeof TwitchAuth>[0]["httpClient"]
      >;
    }
    if (oauthFlow !== undefined) {
      authOptions.oauthFlow = oauthFlow as NonNullable<
        ConstructorParameters<typeof TwitchAuth>[0]["oauthFlow"]
      >;
    }
    if (retryExecutor !== undefined) {
      authOptions.retryExecutor = retryExecutor as NonNullable<
        ConstructorParameters<typeof TwitchAuth>[0]["retryExecutor"]
      >;
    }
    return new TwitchAuth(authOptions);
  };

  const createValidationRetryExecutor = (delay: unknown) =>
    new HttpRetryExecutor({
      logger: noOpLogger,
      safeDelay: delay as NonNullable<
        NonNullable<ConstructorParameters<typeof HttpRetryExecutor>[0]>["safeDelay"]
      >,
    });

  it("throws when expectedUsername is missing", async () => {
    const httpClient = { get: createMockFn(), post: createMockFn() };
    const oauthFlow = createMockFn();
    const auth = createAuth({ expectedUsername: null, httpClient, oauthFlow });

    await expect(auth.initialize()).rejects.toThrow("expectedUsername");
  });

  it("throws when clientId is missing", async () => {
    const httpClient = { get: createMockFn(), post: createMockFn() };
    const oauthFlow = createMockFn();
    const auth = createAuth({ clientId: null, httpClient, oauthFlow });

    await expect(auth.initialize()).rejects.toThrow("clientId");
  });

  it("throws when clientSecret is missing", async () => {
    secrets.twitch.clientSecret = null;
    const httpClient = { get: createMockFn(), post: createMockFn() };
    const oauthFlow = createMockFn();
    const auth = createAuth({ httpClient, oauthFlow });

    await expect(auth.initialize()).rejects.toThrow("clientSecret");
  });

  it("throws when oauthFlow override is not a function", () => {
    const httpClient = { get: createMockFn(), post: createMockFn() };

    expect(() =>
      createAuth({ httpClient, oauthFlow: { runOAuthFlow: createMockFn() } }),
    ).toThrow("oauthFlow must be a function when provided");
  });

  it("loads token store tokens and validates successfully", async () => {
    await writeTokenStore({
      twitch: {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
      },
    });

    const httpClient = {
      get: createMockFn().mockResolvedValue(buildValidationResponse()),
      post: createMockFn(),
    };
    const oauthFlow = createMockFn();
    const auth = createAuth({ httpClient, oauthFlow });

    const userId = await auth.initialize();

    expect(userId).toBe("test-user-id");
    expect(auth.isReady()).toBe(true);
    expect(auth.getUserId()).toBe("test-user-id");
    expect(secrets.twitch.accessToken).toBe("test-access-token");
    expect(secrets.twitch.refreshToken).toBe("test-refresh-token");
    expect(oauthFlow.mock.calls.length).toBe(0);
    expect(httpClient.get.mock.calls[0]?.[1]).toMatchObject({ timeout: 5000 });
  });

  it("runs OAuth flow when tokens are missing", async () => {
    const httpClient = {
      get: createMockFn().mockResolvedValue(buildValidationResponse()),
      post: createMockFn(),
    };
    const oauthFlow = createMockFn().mockResolvedValue({
      accessToken: "test-oauth-access-token",
      refreshToken: "test-oauth-refresh-token",
      expiresIn: 3600,
    });
    const auth = createAuth({ httpClient, oauthFlow });

    const userId = await auth.initialize();

    expect(userId).toBe("test-user-id");
    expect(auth.isReady()).toBe(true);
    expect(secrets.twitch.accessToken).toBe("test-oauth-access-token");
    expect(secrets.twitch.refreshToken).toBe("test-oauth-refresh-token");
    expect(oauthFlow.mock.calls.length).toBe(1);
    const stored = JSON.parse(await fs.promises.readFile(tokenStorePath, "utf8"));
    expect(stored.twitch.accessToken).toBe("test-oauth-access-token");
    expect(stored.twitch.refreshToken).toBe("test-oauth-refresh-token");
  });

  it("throws when OAuth flow returns snake_case tokens", async () => {
    const httpClient = {
      get: createMockFn().mockResolvedValue(buildValidationResponse()),
      post: createMockFn(),
    };
    const oauthFlow = createMockFn().mockResolvedValue({
      access_token: "test-oauth-access-token",
      refresh_token: "test-oauth-refresh-token",
      expires_in: 3600,
    });
    const auth = createAuth({ httpClient, oauthFlow });

    await expect(auth.initialize()).rejects.toThrow(
      "OAuth flow must return camelCase token fields",
    );
  });

  it("throws when token store accessToken is not a string", async () => {
    await writeTokenStore({
      twitch: {
        accessToken: 12345,
        refreshToken: "test-refresh-token",
      },
    });

    const httpClient = { get: createMockFn(), post: createMockFn() };
    const oauthFlow = createMockFn();
    const auth = createAuth({ httpClient, oauthFlow });

    await expect(auth.initialize()).rejects.toThrow(
      "Token store must provide string accessToken",
    );
  });

  it("throws when OAuth flow returns non-string accessToken", async () => {
    const httpClient = {
      get: createMockFn().mockResolvedValue(buildValidationResponse()),
      post: createMockFn(),
    };
    const oauthFlow = createMockFn().mockResolvedValue({
      accessToken: 12345,
      refreshToken: "test-oauth-refresh-token",
      expiresIn: 3600,
    });
    const auth = createAuth({ httpClient, oauthFlow });

    await expect(auth.initialize()).rejects.toThrow(
      "OAuth flow must provide string accessToken",
    );
  });

  it("re-authenticates when scopes are missing", async () => {
    await writeTokenStore({
      twitch: {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
      },
    });

    const httpClient = {
      get: createMockFn()
        .mockResolvedValueOnce(
          buildValidationResponse({ scopes: ["chat:edit"] }),
        )
        .mockResolvedValueOnce(buildValidationResponse()),
      post: createMockFn(),
    };
    const oauthFlow = createMockFn().mockResolvedValue({
      accessToken: "test-oauth-access-token",
      refreshToken: "test-oauth-refresh-token",
      expiresIn: 3600,
    });
    const auth = createAuth({ httpClient, oauthFlow });

    const userId = await auth.initialize();

    expect(userId).toBe("test-user-id");
    expect(oauthFlow.mock.calls.length).toBe(1);
    expect(auth.isReady()).toBe(true);
  });

  it.each([
    ["timeout", Object.assign(new Error("validation timed out"), { code: "ETIMEDOUT" })],
    ["network failure", Object.assign(new Error("connection reset"), { code: "ECONNRESET" })],
    ["429", { response: { status: 429 } }],
    ["503", { response: { status: 503 } }],
  ])(
    "retries transient %s validation failures up to three total attempts",
    async (_label, failure) => {
      await writeTokenStore({
        twitch: {
          accessToken: "test-startup-access-token",
          refreshToken: "test-startup-refresh-token",
        },
      });
      const get = createMockFn<[], Promise<{ data?: unknown }>>()
        .mockRejectedValueOnce(failure)
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(buildValidationResponse());
      const httpClient = {
        get,
        post: createMockFn(),
      };
      const oauthFlow = createMockFn();
      const retryDelay = createMockFn().mockResolvedValue(undefined);
      const auth = createAuth({
        httpClient,
        oauthFlow,
        retryExecutor: createValidationRetryExecutor(retryDelay),
      });

      await expect(auth.initialize()).resolves.toBe("test-user-id");
      expect(httpClient.get.mock.calls.length).toBe(3);
      expect(retryDelay.mock.calls.length).toBe(2);
      expect(oauthFlow.mock.calls.length).toBe(0);
      expect(httpClient.post.mock.calls.length).toBe(0);
    },
  );

  it("rejects after three transient validation attempts without recovery or credential mutation", async () => {
    await writeTokenStore({
      twitch: {
        accessToken: "test-original-access-token",
        refreshToken: "test-original-refresh-token",
      },
    });
    const exhaustedError = { response: { status: 503 } };
    const httpClient = {
      get: createMockFn().mockRejectedValue(exhaustedError),
      post: createMockFn(),
    };
    const oauthFlow = createMockFn();
    const retryDelay = createMockFn().mockResolvedValue(undefined);
    const auth = createAuth({
      httpClient,
      oauthFlow,
      retryExecutor: createValidationRetryExecutor(retryDelay),
    });

    await expect(auth.initialize()).rejects.toBe(exhaustedError);
    expect(httpClient.get.mock.calls.length).toBe(3);
    expect(retryDelay.mock.calls.length).toBe(2);
    expect(httpClient.post.mock.calls.length).toBe(0);
    expect(oauthFlow.mock.calls.length).toBe(0);
    expect(secrets.twitch.accessToken).toBeNull();
    expect(secrets.twitch.refreshToken).toBeNull();
  });

  it("does not retry malformed successful validation data or trigger recovery", async () => {
    await writeTokenStore({
      twitch: {
        accessToken: "test-malformed-access-token",
        refreshToken: "test-malformed-refresh-token",
      },
    });
    const httpClient = {
      get: createMockFn().mockResolvedValue({ data: { login: "wrong-shape" } }),
      post: createMockFn(),
    };
    const oauthFlow = createMockFn();
    const retryDelay = createMockFn().mockResolvedValue(undefined);
    const auth = createAuth({
      httpClient,
      oauthFlow,
      retryExecutor: createValidationRetryExecutor(retryDelay),
    });

    await expect(auth.initialize()).rejects.toThrow();
    expect(httpClient.get.mock.calls.length).toBe(1);
    expect(retryDelay.mock.calls.length).toBe(0);
    expect(httpClient.post.mock.calls.length).toBe(0);
    expect(oauthFlow.mock.calls.length).toBe(0);
  });

  it.each([
    { login: "test-other-user" },
    { client_id: "test-other-client" },
    { user_id: 123 },
    { scopes: ["chat:edit", 123] },
  ])("rejects untrusted stored identity before publication: %j", async (invalid) => {
    await writeTokenStore({ twitch: { accessToken: "test-candidate", refreshToken: "test-refresh" } });
    const before = await fs.promises.readFile(tokenStorePath, "utf8");
    secrets.twitch.accessToken = "test-previous";
    const oauthFlow = createMockFn();
    const auth = createAuth({ httpClient: { get: createMockFn().mockResolvedValue(buildValidationResponse(invalid)), post: createMockFn() }, oauthFlow });
    await expect(auth.initialize()).rejects.toThrow();
    expect(secrets.twitch.accessToken).toBe("test-previous");
    expect(auth.isReady()).toBe(false);
    expect(await fs.promises.readFile(tokenStorePath, "utf8")).toBe(before);
    expect(oauthFlow.mock.calls.length).toBe(0);
  });

  it("retains refresh recovery for a non-transient validation 401", async () => {
    await writeTokenStore({
      twitch: {
        accessToken: "test-expired-access-token",
        refreshToken: "test-refresh-token",
      },
    });
    const get = createMockFn<[], Promise<{ data?: unknown }>>()
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce(buildValidationResponse());
    const httpClient = {
      get,
      post: createMockFn().mockResolvedValue({
        data: {
          access_token: "test-refreshed-access-token",
          refresh_token: "test-refresh-token",
          expires_in: 3600,
        },
      }),
    };
    const oauthFlow = createMockFn();
    const retryDelay = createMockFn().mockResolvedValue(undefined);
    const auth = createAuth({
      httpClient,
      oauthFlow,
      retryExecutor: createValidationRetryExecutor(retryDelay),
    });

    await expect(auth.initialize()).resolves.toBe("test-user-id");
    expect(httpClient.get.mock.calls.length).toBe(2);
    expect(httpClient.post.mock.calls.length).toBe(1);
    expect(retryDelay.mock.calls.length).toBe(0);
    expect(oauthFlow.mock.calls.length).toBe(0);
  });

  it("does not run OAuth when validation becomes transient after refresh", async () => {
    await writeTokenStore({
      twitch: {
        accessToken: "test-expired-access-token",
        refreshToken: "test-refresh-token",
      },
    });
    const transientError = { response: { status: 503 } };
    const httpClient = {
      get: createMockFn()
        .mockRejectedValueOnce({ response: { status: 401 } })
        .mockRejectedValue(transientError),
      post: createMockFn().mockResolvedValue({
        data: {
          access_token: "test-refreshed-access-token",
          refresh_token: "test-refresh-token",
          expires_in: 3600,
        },
      }),
    };
    const oauthFlow = createMockFn();
    const retryDelay = createMockFn().mockResolvedValue(undefined);
    const auth = createAuth({
      httpClient,
      oauthFlow,
      retryExecutor: createValidationRetryExecutor(retryDelay),
    });

    await expect(auth.initialize()).rejects.toBe(transientError);
    expect(httpClient.get.mock.calls.length).toBe(4);
    expect(httpClient.post.mock.calls.length).toBe(1);
    expect(retryDelay.mock.calls.length).toBe(2);
    expect(oauthFlow.mock.calls.length).toBe(0);
  });

  it("preserves a transient refresh failure during initialization", async () => {
    await writeTokenStore({
      twitch: {
        accessToken: "test-expired-access-token",
        refreshToken: "test-refresh-token",
      },
    });
    const refreshError = { response: { status: 503 } };
    const httpClient = {
      get: createMockFn().mockRejectedValue({ response: { status: 401 } }),
      post: createMockFn().mockRejectedValue(refreshError),
    };
    const oauthFlow = createMockFn();
    const auth = createAuth({ httpClient, oauthFlow });

    await expect(auth.initialize()).rejects.toBe(refreshError);
    expect(httpClient.post.mock.calls.length).toBe(1);
    expect(oauthFlow.mock.calls.length).toBe(0);
  });

  it("does not publish refreshed credentials when persistence fails", async () => {
    secrets.twitch.accessToken = "test-original-access-token";
    secrets.twitch.refreshToken = "test-original-refresh-token";
    const invalidParent = path.join(tempDir, "not-a-directory");
    await fs.promises.writeFile(invalidParent, "test-only", "utf8");
    const httpClient = {
      get: createMockFn().mockResolvedValue(buildValidationResponse()),
      post: createMockFn().mockResolvedValue({
        data: {
          access_token: "test-new-access-token",
          refresh_token: "test-new-refresh-token",
          expires_in: 3600,
        },
      }),
    };
    const auth = createAuth({
      tokenStorePathOverride: path.join(invalidParent, "tokens.json"),
      httpClient,
      oauthFlow: createMockFn(),
    });

    await expect(auth.refreshTokens()).resolves.toBe(false);
    expect(secrets.twitch.accessToken).toBe("test-original-access-token");
    expect(secrets.twitch.refreshToken).toBe("test-original-refresh-token");
  });

  it("deduplicates concurrent refresh requests", async () => {
    secrets.twitch.refreshToken = "test-refresh-token";

    let resolvePost: ((value: { data: Record<string, unknown> }) => void) | undefined;
    const postPromise = new Promise<{ data: Record<string, unknown> }>((resolve) => {
      resolvePost = resolve;
    });

    const httpClient = {
      get: createMockFn().mockResolvedValue(buildValidationResponse()),
      post: createMockFn().mockReturnValue(postPromise),
    };
    const oauthFlow = createMockFn();
    const auth = createAuth({ httpClient, oauthFlow });

    const first = auth.refreshTokens();
    const second = auth.refreshTokens();

    expect(httpClient.post.mock.calls.length).toBe(1);

    if (!resolvePost) {
      throw new Error("Expected refresh resolver to be captured");
    }
    resolvePost({
      data: {
        access_token: "test-new-access-token",
        refresh_token: "test-new-refresh-token",
        expires_in: 3600,
      },
    });

    const results = await Promise.all([first, second]);

    expect(results).toEqual([true, true]);
  });

  it("keeps refresh token when refresh response omits refresh_token", async () => {
    secrets.twitch.refreshToken = "test-refresh-token";

    const httpClient = {
      get: createMockFn().mockResolvedValue(buildValidationResponse()),
      post: createMockFn().mockResolvedValue({
        data: {
          access_token: "test-new-access-token",
          expires_in: 3600,
        },
      }),
    };
    const oauthFlow = createMockFn();
    const auth = createAuth({ httpClient, oauthFlow });

    const result = await auth.refreshTokens();

    expect(result).toBe(true);
    expect(secrets.twitch.accessToken).toBe("test-new-access-token");
    expect(secrets.twitch.refreshToken).toBe("test-refresh-token");

    const stored = JSON.parse(
      await fs.promises.readFile(tokenStorePath, "utf8"),
    );
    expect(stored.twitch.accessToken).toBe("test-new-access-token");
    expect(stored.twitch.refreshToken).toBe("test-refresh-token");
  });

  it("falls back to OAuth when refresh is terminal", async () => {
    secrets.twitch.refreshToken = "test-refresh-token";

    const httpClient = {
      get: createMockFn().mockResolvedValue(buildValidationResponse()),
      post: createMockFn().mockRejectedValue({
        response: { status: 400, data: { error: "invalid_grant" } },
      }),
    };
    const oauthFlow = createMockFn().mockResolvedValue({
      accessToken: "test-oauth-access-token",
      refreshToken: "test-oauth-refresh-token",
      expiresIn: 3600,
    });
    const auth = createAuth({ httpClient, oauthFlow });

    const result = await auth.refreshTokens();

    expect(result).toBe(true);
    expect(oauthFlow.mock.calls.length).toBe(1);
    expect(secrets.twitch.accessToken).toBe("test-oauth-access-token");
    expect(secrets.twitch.refreshToken).toBe("test-oauth-refresh-token");
  });

  it("rejects OAuth recovery that omits a replacement refresh token", async () => {
    secrets.twitch.accessToken = "test-old-access-token";
    secrets.twitch.refreshToken = "test-invalid-refresh-token";
    const httpClient = {
      get: createMockFn(),
      post: createMockFn().mockRejectedValue({
        response: { status: 400, data: { error: "invalid_grant" } },
      }),
    };
    const oauthFlow = createMockFn().mockResolvedValue({
      accessToken: "test-oauth-access-token",
      expiresIn: 3600,
    });
    const auth = createAuth({ httpClient, oauthFlow });

    await expect(auth.refreshTokens()).resolves.toBe(false);
    expect(secrets.twitch.accessToken).toBe("test-old-access-token");
    expect(secrets.twitch.refreshToken).toBe("test-invalid-refresh-token");
  });

  it.each(["", "   ", null, 123])("rejects explicit malformed rotated refresh token %j", async (refreshToken) => {
    secrets.twitch.accessToken = "test-accepted";
    secrets.twitch.refreshToken = "test-original-refresh";
    await writeTokenStore({ twitch: { accessToken: "test-accepted", refreshToken: "test-original-refresh" } });
    const before = await fs.promises.readFile(tokenStorePath, "utf8");
    const get = createMockFn().mockResolvedValue(buildValidationResponse());
    const auth = createAuth({ httpClient: { get, post: createMockFn().mockResolvedValue({ data: { access_token: "test-candidate", refresh_token: refreshToken } }) } });
    expect(await auth.refreshTokens()).toBe(false);
    expect(get.mock.calls.length).toBe(0);
    expect(secrets.twitch.accessToken).toBe("test-accepted");
    expect(await fs.promises.readFile(tokenStorePath, "utf8")).toBe(before);
  });

  it.each(["missing", "scopes", "terminal"])("disables interactive recovery for %s", async (route) => {
    process.env.TWITCH_DISABLE_AUTH = "true";
    const oauthFlow = createMockFn();
    if (route === "scopes") {
      await writeTokenStore({ twitch: { accessToken: "test-candidate" } });
    }
    const auth = createAuth({ oauthFlow, httpClient: {
      get: createMockFn().mockResolvedValue(buildValidationResponse({ scopes: [] })),
      post: createMockFn().mockRejectedValue({ response: { status: 400, data: { error: "invalid_grant" } } }),
    } });
    if (route === "terminal") {
      secrets.twitch.refreshToken = "test-revoked";
      expect(await auth.refreshTokens()).toBe(false);
    } else {
      await expect(auth.initialize()).rejects.toThrow("TWITCH_DISABLE_AUTH");
    }
    expect(oauthFlow.mock.calls.length).toBe(0);
  });

  it.each([{ login: "test-wrong-user" }, { client_id: "test-wrong-client" }, { scopes: [] }])("rejects OAuth candidate before persistence: %j", async (invalid) => {
    secrets.twitch.accessToken = "test-previous";
    const auth = createAuth({
      httpClient: { get: createMockFn().mockResolvedValue(buildValidationResponse(invalid)), post: createMockFn() },
      oauthFlow: createMockFn().mockResolvedValue({ accessToken: "test-candidate", refreshToken: "test-refresh" }),
    });
    await expect(auth.initialize()).rejects.toThrow();
    expect(secrets.twitch.accessToken).toBe("test-previous");
    expect(fs.existsSync(tokenStorePath)).toBe(false);
    expect(auth.isReady()).toBe(false);
  });

  it("rejects a stale stored candidate after a newer refresh is accepted", async () => {
    await writeTokenStore({ twitch: { accessToken: "test-old", refreshToken: "test-refresh" } });
    secrets.twitch.refreshToken = "test-refresh";
    let resolveOld!: (value: ReturnType<typeof buildValidationResponse>) => void;
    let oldStarted!: () => void;
    const started = new Promise<void>(resolve => { oldStarted = resolve; });
    const oldValidation = new Promise<ReturnType<typeof buildValidationResponse>>(resolve => { resolveOld = resolve; });
    const get = createMockFn().mockImplementationOnce(() => { oldStarted(); return oldValidation; }).mockResolvedValue(buildValidationResponse());
    const auth = createAuth({ httpClient: { get, post: createMockFn().mockResolvedValue({ data: { access_token: "test-new", refresh_token: "test-new-refresh" } }) } });
    const initialization = auth.initialize();
    await started;
    expect(await auth.refreshTokens()).toBe(true);
    resolveOld(buildValidationResponse());
    await expect(initialization).rejects.toThrow("superseded");
    expect(secrets.twitch.accessToken).toBe("test-new");
    expect(auth.isReady()).toBe(true);
    expect(JSON.parse(await fs.promises.readFile(tokenStorePath, "utf8")).twitch.accessToken).toBe("test-new");
  });

  it.each([{ login: "test-wrong" }, { client_id: "test-wrong" }, { scopes: [] }, { scopes: null }, { user_id: {} }])("keeps accepted credentials and identity when refreshed candidate fails validation: %j", async (invalid) => {
    await writeTokenStore({ twitch: { accessToken: "test-accepted", refreshToken: "test-refresh" } });
    const httpClient = {
      get: createMockFn().mockResolvedValueOnce(buildValidationResponse()).mockResolvedValue(buildValidationResponse(invalid)),
      post: createMockFn().mockResolvedValue({ data: { access_token: "test-rejected", refresh_token: "test-rejected-refresh" } }),
    };
    const oauthFlow = createMockFn();
    const auth = createAuth({ httpClient, oauthFlow });
    await auth.initialize();
    const before = await fs.promises.readFile(tokenStorePath, "utf8");
    expect(await auth.refreshTokens()).toBe(false);
    expect(auth.isReady()).toBe(true);
    expect(auth.getUserId()).toBe("test-user-id");
    expect(secrets.twitch.accessToken).toBe("test-accepted");
    expect(secrets.twitch.refreshToken).toBe("test-refresh");
    expect(await fs.promises.readFile(tokenStorePath, "utf8")).toBe(before);
    expect(oauthFlow.mock.calls.length).toBe(0);
  });
});
