import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GuiRow } from "../../../gui/src/shared/components/GuiRow";

describe("GuiRow rendering behavior", () => {
  it("renders avatar first with circular avatar class", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-user",
          text: "hello",
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    const avatarIndex = html.indexOf('class="gui-row__avatar');
    const textIndex = html.indexOf('class="gui-row__text');
    expect(avatarIndex).toBeGreaterThan(-1);
    expect(textIndex).toBeGreaterThan(-1);
    expect(avatarIndex).toBeLessThan(textIndex);
    expect(html).toContain("gui-row__avatar--circle");
  });

  it("renders platform icon before username for known platforms", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "youtube",
          username: "test-youtube-user",
          text: "hello",
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    const platformIconIndex = html.indexOf('class="gui-row__platform-icon"');
    const usernameIndex = html.indexOf('class="gui-row__username"');
    expect(platformIconIndex).toBeGreaterThan(-1);
    expect(usernameIndex).toBeGreaterThan(-1);
    expect(platformIconIndex).toBeLessThan(usernameIndex);
    expect(html).toContain('src="/gui/assets/platform-icons/youtube-icon.png"');
  });

  it("renders platform icon for trimmed mixed-case platform identifiers", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "  YouTube  ",
          username: "test-youtube-user",
          text: "hello",
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain('class="gui-row__platform-icon"');
    expect(html).toContain('src="/gui/assets/platform-icons/youtube-icon.png"');
  });

  it("does not render platform icon for unknown platform ids", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "unknown-platform",
          username: "test-user",
          text: "hello",
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).not.toContain('class="gui-row__platform-icon"');
  });

  it("renders notification text with white text class", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "platform:follow",
          kind: "notification",
          platform: "twitch",
          username: "test-follower",
          text: "test-follower followed",
          avatarUrl: "https://example.invalid/test-follow-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain("gui-row__text--notification");
  });

  it("renders inline emotes in order with text parts when parts are provided", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "tiktok",
          username: "test-user",
          text: "",
          parts: [
            {
              type: "text",
              text: "hello ",
            },
            {
              type: "emote",
              platform: "tiktok",
              emoteId: "1234512345",
              imageUrl: "https://example.invalid/tiktok-emote.webp",
            },
            {
              type: "text",
              text: " world",
            },
          ],
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain("hello ");
    expect(html).toContain("world");
    expect(html).toContain('class="gui-row__emote"');
    expect(html).toContain('src="https://example.invalid/tiktok-emote.webp"');
  });

  it("adds paypiggy row class for chat rows with isPaypiggy true", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-paypiggy-user",
          text: "paypiggy chat",
          isPaypiggy: true,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain("gui-row--paypiggy");
  });

  it("renders member label after username for paypiggy chat rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-paypiggy-user",
          text: "paypiggy chat",
          isPaypiggy: true,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    const usernameIndex = html.indexOf('class="gui-row__username"');
    const memberLabelIndex = html.indexOf('class="gui-row__member-tag"');
    expect(memberLabelIndex).toBeGreaterThan(-1);
    expect(memberLabelIndex).toBeGreaterThan(usernameIndex);
    expect(html).toContain(">MEMBER<");
  });

  it("renders badges between username and member label for chat rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-paypiggy-user",
          text: "paypiggy chat",
          isPaypiggy: true,
          badgeImages: [
            {
              imageUrl: "https://example.invalid/badge-1.png",
              source: "twitch",
              label: "mod",
            },
            {
              imageUrl: "https://example.invalid/badge-2.png",
              source: "twitch",
              label: "founder",
            },
          ],
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    const usernameIndex = html.indexOf('class="gui-row__username"');
    const badgesIndex = html.indexOf('class="gui-row__badges"');
    const memberLabelIndex = html.indexOf('class="gui-row__member-tag"');
    expect(badgesIndex).toBeGreaterThan(usernameIndex);
    expect(memberLabelIndex).toBeGreaterThan(badgesIndex);
    expect(html).toContain('class="gui-row__badge"');
    expect(html).toContain('src="https://example.invalid/badge-1.png"');
    expect(html).toContain('src="https://example.invalid/badge-2.png"');
  });

  it("does not add paypiggy row class for chat rows with isPaypiggy false", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-non-paypiggy-user",
          text: "non paypiggy chat",
          isPaypiggy: false,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).not.toContain("gui-row--paypiggy");
  });

  it("does not render member label for non-paypiggy chat rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-non-paypiggy-user",
          text: "non paypiggy chat",
          isPaypiggy: false,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).not.toContain("gui-row__member-tag");
    expect(html).not.toContain(">MEMBER<");
  });

  it("does not add paypiggy row class when isPaypiggy is omitted", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-omitted-paypiggy-user",
          text: "omitted paypiggy chat",
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).not.toContain("gui-row--paypiggy");
  });

  it("does not add paypiggy row class for notification rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "platform:paypiggy",
          kind: "notification",
          platform: "twitch",
          username: "test-notification-user",
          text: "notification row",
          isPaypiggy: true,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).not.toContain("gui-row--paypiggy");
  });

  it("does not render member label for notification rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "platform:paypiggy",
          kind: "notification",
          platform: "twitch",
          username: "test-notification-user",
          text: "notification row",
          isPaypiggy: true,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).not.toContain("gui-row__member-tag");
    expect(html).not.toContain(">MEMBER<");
  });

  it("keeps paypiggy class on overlay chat rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "overlay",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-overlay-paypiggy-user",
          text: "overlay paypiggy chat",
          isPaypiggy: true,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain("gui-row--overlay-enter");
    expect(html).toContain("gui-row--paypiggy");
  });

  it("renders Rayquaza image for YouTube member chat rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "youtube",
          username: "test-youtube-member",
          text: "hello from member",
          isPaypiggy: true,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain('class="gui-row__member-image"');
    expect(html).toContain(
      'src="https://img.pokemondb.net/sprites/black-white/anim/normal/rayquaza.gif"',
    );
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain("gui-row__content--member-chat");
    expect(html).toContain("gui-row__header--member-chat");
    expect(html).toContain("gui-row__username--member-chat");
    expect(html).toContain("gui-row__text--member-chat");

    const imageIndex = html.indexOf('class="gui-row__member-image"');
    const textIndex = html.indexOf('class="gui-row__text');
    expect(imageIndex).toBeGreaterThan(-1);
    expect(textIndex).toBeGreaterThan(-1);
    expect(imageIndex).toBeLessThan(textIndex);
  });

  it("renders Rayquaza image for trimmed mixed-case YouTube member rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "  YouTube  ",
          username: "test-youtube-member",
          text: "hello from member",
          isPaypiggy: true,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain('class="gui-row__member-image"');
  });

  it("does not render Rayquaza image for non-member YouTube chat rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "youtube",
          username: "test-youtube-user",
          text: "hello from non-member",
          isPaypiggy: false,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).not.toContain("gui-row__member-image");
    expect(html).not.toContain("gui-row__content--member-chat");
  });

  it("renders Rayquaza image for non-YouTube paypiggy chat rows", () => {
    const twitchHtml = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-twitch-member",
          text: "hello from twitch member",
          isPaypiggy: true,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    const tiktokHtml = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "tiktok",
          username: "test-tiktok-member",
          text: "hello from tiktok member",
          isPaypiggy: true,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(twitchHtml).toContain("gui-row__member-image");
    expect(tiktokHtml).toContain("gui-row__member-image");
  });

  it("does not render Rayquaza image for notification rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "platform:paypiggy",
          kind: "notification",
          platform: "youtube",
          username: "test-youtube-member",
          text: "became a member",
          isPaypiggy: true,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).not.toContain("gui-row__member-image");
  });

  it("keeps overlay text clamp class for member rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "overlay",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-twitch-member",
          text: "hello from member",
          isPaypiggy: true,
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain("gui-row__text--overlay-clamp");
    expect(html).toContain("gui-row__text--member-chat");
  });

  it("renders baseline and experiment cards in dock compare mode for all row types", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        uiCompareMode: true,
        row: {
          type: "platform:follow",
          kind: "notification",
          platform: "youtube",
          username: "test-compare-user",
          text: "test-compare-user followed",
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain('class="gui-row-compare-shell"');
    expect(html).toContain('data-compare-label="baseline"');
    expect(html).toContain('data-compare-label="experiment"');
    expect(html).toContain("gui-row--compare-before");
    expect(html).toContain("gui-row--compare-after");
    expect(html.split("test-compare-user").length - 1).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("does not render compare shell in overlay mode when compare mode is enabled", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "overlay",
        uiCompareMode: true,
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-overlay-user",
          text: "test overlay",
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).not.toContain("gui-row-compare-shell");
    expect(html).toContain("gui-row--overlay-enter");
  });
});
