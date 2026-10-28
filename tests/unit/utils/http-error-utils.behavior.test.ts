import { describe, test, expect } from "bun:test";
import { extractHttpErrorDetails } from "../../../src/utils/http-error-utils.ts";
describe("http-error-utils behavior", () => {
  test("redacts quoted assignments and embedded quotes throughout HTTP diagnostics", () => {
    for (const assignment of ['password="synthetic-password"', "access_token='synthetic-token'", "password=synthetic'credential", 'access_token=synthetic"credential']) {
      const text = `${assignment}; scope missing`;
      const details = extractHttpErrorDetails({ message: text, response: { data: { error: text, message: text, nested: [text] } } });
      expect(JSON.stringify(details)).not.toMatch(/synthetic|credential/);
      expect(details.message).toContain('; scope missing');
      expect(extractHttpErrorDetails({ response: { data: text } }).responseSnippet).not.toMatch(/synthetic|credential/);
    }
  });
  test.each([
    ['Authorization: Basic synthetic-basic-value; scope missing', 'synthetic-basic-value'],
    ['Bearer synthetic-bare-value; scope missing', 'synthetic-bare-value'],
    [JSON.stringify({ access_token: 'synthetic-json-value', message: 'scope missing' }), 'synthetic-json-value'],
  ])("does not expose credential-bearing text: %s", (text, credential) => {
    const details = extractHttpErrorDetails({ message: text, response: { data: text } });
    expect(JSON.stringify(details)).not.toContain(credential);
    expect(details.message).toContain('scope missing');
  });
  test("sanitizes diagnostic strings before snippet truncation", () => {
    const text = 'authorization: Bearer synthetic-http-token; scope missing https://example.invalid/path?signature=synthetic-signature';
    const details = extractHttpErrorDetails({
      message: text, code: text, config: { method: text, url: '/path?token=synthetic-query' },
      response: { status: 403, statusText: text, data: { error: text, message: text, nested: [text], password: 'synthetic-password' } }
    });
    expect(JSON.stringify(details)).not.toContain('synthetic-');
    expect(details.message).toContain('; scope missing');
    expect(details.responseSnippet).toContain('"password":"[REDACTED]"');
    expect(details.url).toBe('/path');
    for (const data of [text, JSON.stringify({ message: text }), { nested: [text] }]) {
      const result = extractHttpErrorDetails({ response: { data } }, { maxResponseSnippetLength: 45 });
      expect(result.responseSnippet).not.toContain('synthetic-');
      expect(result.responseSnippet!.length).toBeLessThanOrEqual(45);
    }
    expect(extractHttpErrorDetails(text).message).not.toContain('synthetic-');
  });
  test("sanitizes credentials crossing the response snippet boundary before cutting", () => {
    const text = 'x'.repeat(4050) + ' Authorization: Basic synthetic-cross-boundary-token; scope missing';
    const details = extractHttpErrorDetails({ response: { data: { nested: [text] } } }, { maxResponseSnippetLength: 4096 });
    expect(details.responseSnippet).not.toContain('synthetic-');
    expect(details.responseSnippet!.length).toBeLessThanOrEqual(4096);
  });
  test("extractHttpErrorDetails returns safe defaults for non-HTTP errors", () => {
    const error = new Error("boom");

    const details = extractHttpErrorDetails(error);

    expect(details).toEqual({
      message: "boom",
      code: null,
      status: null,
      statusText: null,
      serviceError: null,
      serviceMessage: null,
      isAxiosError: false,
      method: null,
      url: null,
      responseSnippet: null,
    });
  });

  test("preserves bounded traversal, alternate service fields, and safe serialization fallbacks", () => {
    const nested: Record<string, unknown> = {};
    nested.self = nested;
    const details = extractHttpErrorDetails({ response: { data: { code: 'Forbidden', error_description: 'scope missing', nested } } });
    expect(details.serviceError).toBe('Forbidden');
    expect(details.serviceMessage).toBe('scope missing');
    expect(details.responseSnippet).toContain('[Truncated]');
    expect(extractHttpErrorDetails({ response: { data: 1n } }).responseSnippet).toBe('1');
    expect(extractHttpErrorDetails({ response: { data: 'safe' } }, { maxResponseSnippetLength: 0 }).responseSnippet).toBeNull();
    expect(extractHttpErrorDetails({ config: { method: ' ', url: 42 } }).method).toBeNull();
    expect(extractHttpErrorDetails({ config: { url: 'https://example.invalid/path?q=synthetic-query#fragment' } }).url).toBe('https://example.invalid/path');
  });

  test("extractHttpErrorDetails redacts sensitive fields from response data", () => {
    const error = {
      isAxiosError: true,
      message: "Request failed with status code 401",
      code: "ERR_BAD_REQUEST",
      config: {
        method: "GET",
        url: "https://api.example.com/v1/resource?access_token=should-not-log",
      },
      response: {
        status: 401,
        statusText: "Unauthorized",
        data: {
          error: "Unauthorized",
          message: "Invalid OAuth token",
          access_token: "super-secret-token",
        },
        headers: {
          "x-request-id": "req-123",
        },
      },
    };

    const details = extractHttpErrorDetails(error, {
      maxResponseSnippetLength: 500,
    });

    expect(details.status).toBe(401);
    expect(details.serviceError).toBe("Unauthorized");
    expect(details.serviceMessage).toBe("Invalid OAuth token");
    expect(details.isAxiosError).toBe(true);
    expect(details.method).toBe("get");
    expect(details.url).toBe("https://api.example.com/v1/resource");
    expect(details.responseSnippet).toContain('"access_token":"[REDACTED]"');
    expect(details.responseSnippet).not.toContain("super-secret-token");
    expect(details.responseSnippet).not.toContain("should-not-log");
  });

  test("extractHttpErrorDetails truncates large response data safely", () => {
    const error = {
      isAxiosError: true,
      message: "Request failed",
      config: { method: "post", url: "https://api.example.com/v1/large" },
      response: {
        status: 500,
        statusText: "Internal Server Error",
        data: "x".repeat(2000),
      },
    };

    const details = extractHttpErrorDetails(error, {
      maxResponseSnippetLength: 250,
    });

    expect(details.responseSnippet).not.toBeNull();
    if (details.responseSnippet === null) {
      throw new Error("Expected response snippet for large response data");
    }
    expect(details.responseSnippet.length).toBeLessThanOrEqual(250);
    expect(details.status).toBe(500);
    expect(details.url).toBe("https://api.example.com/v1/large");
  });
});
