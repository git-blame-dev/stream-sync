import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import { createServer, request, type IncomingMessage, type RequestOptions, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { AxiosInstance } from "axios";
import { EnhancedHttpClient } from "../../../src/utils/enhanced-http-client";
import { TwitchApiClient } from "../../../src/utils/api-clients/twitch-api-client";
import { secrets } from "../../../src/core/secrets";
import { noOpLogger } from "../../helpers/mock-factories";

const load = createRequire(import.meta.url);
// The installed Node transport, not the package-entry mock registered by suite setup.
const nativeAxios = load("../../../node_modules/axios/dist/node/axios.cjs") as typeof import("axios").default;
type HttpAdapter = NonNullable<NonNullable<ConstructorParameters<typeof EnhancedHttpClient>[0]>["axios"]>;
type WireRequest = { authorization: string | undefined; clientId: string | string[] | undefined; path: string | undefined };

const callerBasic = { username: "synthetic-user", password: "synthetic-password" };
const defaultBasic = { username: "synthetic-default-user", password: "synthetic-default-password" };
const basicHeader = (auth: typeof callerBasic) => `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;

function nativeAdapter(instance: AxiosInstance, expectedUrl: string): HttpAdapter {
  const send = async (method: string, url: string, data: unknown, config: Record<string, unknown>) => {
    if (url !== expectedUrl) throw new Error("Unexpected synthetic HTTP target");
    const response = await instance.request({ ...config, method, url, data });
    return { status: response.status, data: response.data };
  };
  return {
    get: (url, config) => send("GET", url, undefined, config),
    post: (url, data, config) => send("POST", url, data, config),
    put: (url, data, config) => send("PUT", url, data, config),
    delete: (url, config) => send("DELETE", url, undefined, config),
  };
}

async function withLoopback(
  respond: (response: ServerResponse, requestNumber: number) => void,
  run: (port: number, observed: WireRequest[]) => Promise<void>,
) {
  const observed: WireRequest[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((incoming, response) => {
    observed.push({ authorization: incoming.headers.authorization, clientId: incoming.headers["client-id"], path: incoming.url });
    respond(response, observed.length);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => { sockets.delete(socket); });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing synthetic loopback address");
    await run(address.port, observed);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function respondJson(response: ServerResponse, status: number) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ data: [] }));
}

describe("installed Axios HTTP authentication ownership", () => {
  let originalToken: typeof secrets.twitch.accessToken;
  beforeEach(() => {
    originalToken = secrets.twitch.accessToken;
    secrets.twitch.accessToken = "synthetic-owned-initial";
  });
  afterEach(() => { secrets.twitch.accessToken = originalToken; });

  it("sends generated Bearer auth instead of caller or instance-default Basic credentials", async () => {
    await withLoopback((response) => respondJson(response, 200), async (port, observed) => {
      const url = `http://127.0.0.1:${port}/synthetic-owned`;
      const instance = nativeAxios.create({ adapter: "http", proxy: false, maxRedirects: 0, auth: defaultBasic });
      const client = new EnhancedHttpClient({ axios: nativeAdapter(instance, url), logger: noOpLogger });
      const options = { authToken: "synthetic-owned-token", auth: callerBasic, overallBudgetMs: 1000 };
      await client.get(url, options);
      await client.get(url, { authToken: "synthetic-owned-token", overallBudgetMs: 1000 });
      expect(observed.map((entry) => entry.authorization)).toEqual(["Bearer synthetic-owned-token", "Bearer synthetic-owned-token"]);
      expect(instance.defaults.auth).toEqual(defaultBasic);
      expect(options.auth).toBe(callerBasic);
    });
  });

  it("preserves caller and instance-default Basic credentials without a generated token", async () => {
    await withLoopback((response) => respondJson(response, 200), async (port, observed) => {
      const url = `http://127.0.0.1:${port}/synthetic-basic`;
      const instance = nativeAxios.create({ adapter: "http", proxy: false, maxRedirects: 0, auth: defaultBasic });
      const client = new EnhancedHttpClient({ axios: nativeAdapter(instance, url), logger: noOpLogger });
      await client.get(url, { auth: callerBasic, overallBudgetMs: 1000 });
      await client.get(url, { overallBudgetMs: 1000 });
      expect(observed.map((entry) => entry.authorization)).toEqual([basicHeader(callerBasic), basicHeader(defaultBasic)]);
    });
  });

  it("rejects request-URL credentials before native transport when a generated token owns authentication", async () => {
    await withLoopback((response) => respondJson(response, 200), async (port, observed) => {
      const url = `http://synthetic-url-user:synthetic-url-password@127.0.0.1:${port}/synthetic-url-auth`;
      const instance = nativeAxios.create({ adapter: "http", proxy: false, maxRedirects: 0 });
      let nativeRequests = 0;
      instance.interceptors.request.use((config) => { nativeRequests += 1; return config; });
      const client = new EnhancedHttpClient({ axios: nativeAdapter(instance, url), logger: noOpLogger });
      await expect(client.get(url, { authToken: "synthetic-owned-token", overallBudgetMs: 1000 })).rejects.toThrow(/^Conflicting URL authentication$/);
      expect(nativeRequests).toBe(0);
      expect(observed).toHaveLength(0);
    });
  });

  it("rejects credentials introduced by Axios URL composition before interceptors or the wire", async () => {
    await withLoopback((response) => respondJson(response, 200), async (port, observed) => {
      const instance = nativeAxios.create({ adapter: "http", proxy: false, maxRedirects: 0 });
      let nativeRequests = 0;
      instance.interceptors.request.use((config) => { nativeRequests += 1; return config; });
      const url = `synthetic-user:synthetic-password@127.0.0.1:${port}/synthetic`;
      expect(new URL(instance.getUri({ url, baseURL: "http://" })).username).toBe("synthetic-user");
      const client = new EnhancedHttpClient({ axios: nativeAdapter(instance, url), logger: noOpLogger });
      for (const allowAbsoluteUrls of [true, false]) {
        await expect(client.get(url, { baseURL: "http://", allowAbsoluteUrls, authToken: "synthetic-owned-token", overallBudgetMs: 1000 })).rejects.toThrow(/^Conflicting URL authentication$/);
      }
      expect(nativeRequests).toBe(0);
      expect(observed).toHaveLength(0);
    });
  });

  it("rejects explicit baseURL credentials for both relative and absolute owned requests", async () => {
    await withLoopback((response) => respondJson(response, 200), async (port, observed) => {
      const baseURL = `http://synthetic-url-user:synthetic-url-password@127.0.0.1:${port}/`;
      const instance = nativeAxios.create({ adapter: "http", proxy: false, maxRedirects: 0 });
      let nativeRequests = 0;
      instance.interceptors.request.use((config) => { nativeRequests += 1; return config; });
      for (const url of ["/synthetic-relative", `http://127.0.0.1:${port}/synthetic-absolute`]) {
        const client = new EnhancedHttpClient({ axios: nativeAdapter(instance, url), logger: noOpLogger });
        await expect(client.get(url, { authToken: "synthetic-owned-token", baseURL, overallBudgetMs: 1000 })).rejects.toThrow(/^Conflicting URL authentication$/);
      }
      expect(nativeRequests).toBe(0);
      expect(observed).toHaveLength(0);
    });
  });

  it("preserves native URL Basic credentials without a generated token, including explicit baseURL resolution", async () => {
    await withLoopback((response) => respondJson(response, 200), async (port, observed) => {
      const baseURL = `http://synthetic-url-user:synthetic-url-password@127.0.0.1:${port}/`;
      const instance = nativeAxios.create({ adapter: "http", proxy: false, maxRedirects: 0 });
      const absolute = `${baseURL}synthetic-absolute`;
      await new EnhancedHttpClient({ axios: nativeAdapter(instance, absolute), logger: noOpLogger }).get(absolute, { overallBudgetMs: 1000 });
      const relative = "/synthetic-relative";
      await new EnhancedHttpClient({ axios: nativeAdapter(instance, relative), logger: noOpLogger }).get(relative, { baseURL, overallBudgetMs: 1000 });
      expect(observed.map((entry) => entry.authorization)).toEqual([
        basicHeader({ username: "synthetic-url-user", password: "synthetic-url-password" }),
        basicHeader({ username: "synthetic-url-user", password: "synthetic-url-password" }),
      ]);
    });
  });

  it("preserves no-token Basic credentials introduced by URL composition", async () => {
    await withLoopback((response) => respondJson(response, 200), async (port, observed) => {
      const url = `synthetic-user:synthetic-password@127.0.0.1:${port}/synthetic`;
      const instance = nativeAxios.create({ adapter: "http", proxy: false, maxRedirects: 0 });
      const client = new EnhancedHttpClient({ axios: nativeAdapter(instance, url), logger: noOpLogger });
      await client.get(url, { baseURL: "http://", overallBudgetMs: 1000 });
      expect(observed.map((entry) => entry.authorization)).toEqual([basicHeader(callerBasic)]);
    });
  });

  for (const withCallerBasic of [true, false]) {
    it(`sends owned Twitch tokens on initial and refreshed native requests with caller Basic=${withCallerBasic}`, async () => {
      await withLoopback((response, index) => respondJson(response, index === 1 ? 401 : 200), async (port, observed) => {
        const url = "https://api.twitch.tv/helix/users?synthetic=1";
        let transportCalls = 0;
        const transport = {
          request(options: RequestOptions, callback: (response: IncomingMessage) => void) {
            if (options.protocol !== "https:" || options.hostname !== "api.twitch.tv" || options.path !== "/helix/users?synthetic=1") {
              throw new Error("Unexpected native Twitch transport target");
            }
            transportCalls += 1;
            // Preserve native Axios-produced auth/headers; redirect only the test socket destination.
            return request({ ...options, protocol: "http:", hostname: "127.0.0.1", port }, callback);
          },
        };
        const instance = nativeAxios.create({ adapter: "http", proxy: false, maxRedirects: 0, auth: defaultBasic, transport });
        const enhanced = new EnhancedHttpClient({ axios: nativeAdapter(instance, url), logger: noOpLogger });
        let refreshes = 0;
        const client = new TwitchApiClient({ refreshTokens: async () => {
          refreshes += 1;
          secrets.twitch.accessToken = "synthetic-owned-refreshed";
          return true;
        } }, { clientId: "synthetic-client" }, noOpLogger, { enhancedHttpClient: enhanced });
        const options = { ...(withCallerBasic ? { auth: callerBasic } : {}), overallBudgetMs: 1000, retryScope: "synthetic-native-auth", maxAttempts: 3 };
        await expect(client.makeRequest("/users?synthetic=1", options)).resolves.toEqual({ data: [] });
        expect(observed).toEqual([
          { authorization: "Bearer synthetic-owned-initial", clientId: "synthetic-client", path: "/helix/users?synthetic=1" },
          { authorization: "Bearer synthetic-owned-refreshed", clientId: "synthetic-client", path: "/helix/users?synthetic=1" },
        ]);
        expect(transportCalls).toBe(2);
        expect(refreshes).toBe(1);
        expect(instance.defaults.auth).toEqual(defaultBasic);
        if (withCallerBasic) expect(options.auth).toBe(callerBasic);
        else expect(options).not.toHaveProperty("auth");
      });
    });
  }
});
