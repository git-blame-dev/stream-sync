import { describe, it, expect } from "bun:test";
import { parseEnvContent } from "../../../src/utils/env-file-parser";
describe("env-file-parser behavior", () => {
  it("returns empty object when content is null", () => {
    const parsed = parseEnvContent(null);

    expect(parsed).toEqual({});
  });

  it("parses key-value pairs and ignores comments and blank lines", () => {
    const content = `
# comment
TWITCH_CLIENT_ID=test-client-id

OBS_PASSWORD=test-obs-password
`;

    const parsed = parseEnvContent(content);

    expect(parsed).toEqual({
      TWITCH_CLIENT_ID: "test-client-id",
      OBS_PASSWORD: "test-obs-password",
    });
  });

  it("parses values containing additional equal signs", () => {
    const content = "SIGNED_VALUE=part-one=part-two=part-three";

    const parsed = parseEnvContent(content);

    expect(parsed.SIGNED_VALUE).toBe("part-one=part-two=part-three");
  });

  it("strips surrounding quotes and trims whitespace", () => {
    const content = ' TWITCH_CLIENT_ID = " test-quoted-client-id " ';

    const parsed = parseEnvContent(content);

    expect(parsed.TWITCH_CLIENT_ID).toBe(" test-quoted-client-id ");
  });

  it("ignores malformed lines and empty keys", () => {
    const content = `
MALFORMED
=missing-key
VALID_KEY=test-valid
`;

    const parsed = parseEnvContent(content);

    expect(parsed).toEqual({ VALID_KEY: "test-valid" });
  });

  it("keeps empty keys when ignoreEmptyKeys is disabled", () => {
    const content = "=missing-key\nVALID_KEY=test-valid";

    const parsed = parseEnvContent(content, { ignoreEmptyKeys: false });

    expect(parsed).toEqual({
      "": "missing-key",
      VALID_KEY: "test-valid",
    });
  });
});
