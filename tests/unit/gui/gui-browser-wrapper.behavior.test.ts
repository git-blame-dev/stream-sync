import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readObsFile(name: string): string {
  return readFileSync(resolve(process.cwd(), "obs", name), "utf8");
}

describe("OBS browser wrappers", () => {
  test("preserves source query parameters while probing health by pathname", () => {
    const wrapper = readObsFile("browser-wrapper.html");

    expect(wrapper).toContain("`${url.pathname}${url.search}`");
    expect(wrapper).toContain("new URL(route, DEFAULT_ORIGIN).pathname");
  });

  test.each([
    ["overlay.html", "/overlay"],
    ["dock.html", "/dock"],
    ["notifications.html", "/notifications"],
  ])("forwards query parameters from %s", (fileName, route) => {
    const launcher = readObsFile(fileName);

    expect(launcher).toContain(`browser-wrapper.html#${route}`);
    expect(launcher).toContain("window.location.search");
  });
});
