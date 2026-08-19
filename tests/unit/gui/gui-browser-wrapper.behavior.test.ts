import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readObsFile(name: string): string {
  return readFileSync(resolve(process.cwd(), "obs", name), "utf8");
}

describe("OBS browser wrappers", () => {
  test("shares compatibility polling while preserving source query parameters", () => {
    const wrapper = readObsFile("browser-wrapper.html");

    expect(wrapper).toContain('src="browser-wrapper.js?v=2"');
    expect(wrapper).toContain('href="browser-wrapper.css?v=2"');
    expect(wrapper).toContain("data-status-visible");
    expect(wrapper).toContain("data-status-visible=\"false\"");
  });

  test.each([
    ["overlay.html", "/overlay"],
    ["dock.html", "/dock"],
    ["notifications.html", "/notifications"],
    ["tiktok-animations.html", "/tiktok-animations"],
    ["demo.html", "/demo"],
  ])("forwards query parameters from %s", (fileName, route) => {
    const launcher = readObsFile(fileName);

    expect(launcher).toContain(`data-route="${route}"`);
    expect(launcher).toContain('src="browser-wrapper.js?v=2"');
    expect(launcher).toContain('href="browser-wrapper.css?v=2"');
    expect(launcher).not.toContain("window.location.replace");
    expect(readObsFile("browser-wrapper.js")).toContain("window.location.search");
  });

  test("keeps dock status visible and stream-facing launchers transparent", () => {
    expect(readObsFile("dock.html")).toContain('data-status-visible="true"');
    for (const fileName of ["overlay.html", "notifications.html", "tiktok-animations.html"]) {
      const launcher = readObsFile(fileName);
      expect(launcher).toContain('data-status-visible="false"');
    }
    expect(readObsFile("browser-wrapper.css")).toContain("background: transparent");
  });

  test("recovers the iframe after the server becomes unavailable and returns", () => {
    const wrapper = readObsFile("browser-wrapper.js");

    expect(wrapper).toContain("HEALTH_POLL_MS");
    expect(wrapper).toContain("frame.removeAttribute('src')");
    expect(wrapper).toContain("setHealthMonitoring");
    expect(wrapper).toContain("loadFrame();");
    expect(wrapper).toContain("root.dataset.statusVisible === 'true'");
    expect(wrapper).toContain("new URL(targetRoute, origin).toString()");
    expect(wrapper).toContain("frame.addEventListener('load'");
    expect(wrapper).toContain("frame.getAttribute('src') === targetUrl");
    expect(wrapper).toContain("Connecting to Stream Sync...");
    expect(wrapper).toContain("http://localhost:3399");
    expect(wrapper).not.toContain("?t=${Date.now()}");
  });
});
