import { describe, expect, it } from "bun:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";

import { GuiRow, GUI_AVATAR_FALLBACK_URL } from "../../../gui/src/shared/components/GuiRow";
import type { GuiRowDto } from "../../../gui/src/shared/types";
import { getPlatformIconUrl } from "../../../gui/src/shared/platform-icon-map";
import { createGuiFeedStore } from "../../../gui/src/shared/feed-store";
import { createEventToGuiContractMapper } from "../../../src/services/gui/event-to-gui-contract-mapper";

describe("GuiRow rendering behavior", () => {
  it("preserves the wire row through mapping, frontend parsing, and member rendering", async () => {
    const mapper = createEventToGuiContractMapper();
    const mapped = await mapper.mapDisplayRow({
      eventId: "test-contract-event",
      type: "platform:chat-message",
      platform: "twitch",
      timestamp: "2024-01-01T00:00:00.000Z",
      data: {
        username: "test-contract-member",
        avatarUrl: "https://example.invalid/contract-avatar.png",
        message: {
          text: "test rich message",
          parts: [
            { type: "text", text: "test rich message " },
            { type: "emote", platform: "twitch", emoteId: "test-emote", imageUrl: "https://example.invalid/contract-emote.png" },
          ],
        },
        badgeImages: [{ imageUrl: "https://example.invalid/contract-badge.png", source: "twitch", label: "Test badge" }],
        isPaypiggy: true,
        isStreamSupporter: true,
        presentationOverride: { theme: "red", effects: ["particles"], spriteUrl: "https://example.invalid/contract-sprite.gif" },
      },
    });
    const store = createGuiFeedStore();
    const parsed = store.pushEvent(JSON.parse(JSON.stringify(mapped)));
    expect(parsed).toEqual(mapped);
    expect(parsed?.eventId).toBe("test-contract-event");
    expect(parsed?.presentationRole).toBe("member");
    if (!parsed) throw new Error("Expected the mapped contract row to be admitted");
    const html = renderToStaticMarkup(React.createElement(GuiRow, { mode: "dock", row: parsed }));
    expect(html).toContain("gui-row--theme-red");
    expect(html).toContain("gui-row__member-particles");
    expect(html).toContain("https://example.invalid/contract-sprite.gif");
    expect(html).toContain("https://example.invalid/contract-emote.png");
    expect(html).toContain("https://example.invalid/contract-badge.png");
    expect(html).toContain("https://example.invalid/contract-avatar.png");
    expect(html).toContain("test-contract-member");
    expect(html).toContain("test rich message");
  });

  it("replaces a failed avatar with the local neutral fallback without retrying the remote URL", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(GuiRow, {
        mode: "dock",
        row: { type: "chat", kind: "chat", platform: "twitch", username: "user", text: "hello", avatarUrl: "https://example.invalid/avatar.png", timestamp: null },
      }));
    });
    const avatar = renderer.root.findByProps({ className: "gui-row__avatar gui-row__avatar--circle" });

    act(() => avatar.props.onError());
    expect(renderer.root.findByProps({ className: "gui-row__avatar gui-row__avatar--circle" }).props.src).toBe(GUI_AVATAR_FALLBACK_URL);
    expect(renderer.root.findByProps({ className: "gui-row__avatar gui-row__avatar--circle" }).props.onError).toBeDefined();
  });
  it("uses the next row avatar after a previous avatar has failed", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    const row = (avatarUrl: string, username: string) => ({
      type: "chat" as const,
      kind: "chat" as const,
      platform: "twitch",
      username,
      text: "hello",
      avatarUrl,
      timestamp: null,
    });

    act(() => {
      renderer = TestRenderer.create(React.createElement(GuiRow, {
        mode: "dock",
        row: row("https://example.invalid/avatar-a.png", "user-a"),
      }));
    });
    const avatar = renderer.root.findByProps({ className: "gui-row__avatar gui-row__avatar--circle" });
    act(() => avatar.props.onError());
    expect(avatar.props.src).toBe(GUI_AVATAR_FALLBACK_URL);

    act(() => renderer.update(React.createElement(GuiRow, {
      mode: "dock",
      row: row("https://example.invalid/avatar-b.png", "user-b"),
    })));

    expect(renderer.root.findByProps({ className: "gui-row__avatar gui-row__avatar--circle" }).props.src)
      .toBe("https://example.invalid/avatar-b.png");
  });
  it("renders the avatar and platform icon together before row content", () => {
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

    const avatarWrapperIndex = html.indexOf('class="gui-row__avatar-wrapper"');
    const avatarIndex = html.indexOf('class="gui-row__avatar gui-row__avatar--circle"');
    const platformIconIndex = html.indexOf('class="gui-row__platform-icon"');
    const copyIndex = html.indexOf('class="gui-row__copy"');
    const textIndex = html.indexOf('class="gui-row__text');
    expect(avatarWrapperIndex).toBeGreaterThan(-1);
    expect(avatarIndex).toBeGreaterThan(-1);
    expect(platformIconIndex).toBeGreaterThan(avatarIndex);
    expect(copyIndex).toBeGreaterThan(platformIconIndex);
    expect(textIndex).toBeGreaterThan(-1);
    expect(avatarWrapperIndex).toBeLessThan(avatarIndex);
    expect(platformIconIndex).toBeLessThan(textIndex);
    expect(html).toContain("gui-row__avatar--circle");
    expect(html).toContain(`src="${getPlatformIconUrl("twitch")}"`);
    expect(html).toContain('role="article"');
  });

  it("renders minimal rows in member, username, badges, separator, message order", () => {
    const html = renderToStaticMarkup(React.createElement(GuiRow, {
      mode: "dock",
      appearance: { profile: "minimal", revision: 0, settings: { compactRows: true, rowBackgroundsEnabled: true, maxDisplayableBadges: 1 } },
      row: { type: "chat", kind: "chat", platform: "twitch", username: "user", text: "hello", isPaypiggy: true, presentationRole: "member",
        badgeImages: [{ imageUrl: "badge-1", source: "twitch", label: "mod" }, { imageUrl: "badge-2", source: "twitch", label: "vip" }],
        avatarUrl: "avatar", timestamp: null },
    }));
    expect(html).toContain("gui-row--minimal");
    expect(html).toContain("gui-row--compact");
    expect(html.indexOf("gui-row__member-image-clip")).toBeLessThan(html.indexOf("gui-row__copy"));
    expect(html.indexOf("gui-row__copy")).toBeLessThan(html.indexOf("MEMBER"));
    expect(html.indexOf("MEMBER")).toBeLessThan(html.indexOf("gui-row__username"));
    expect(html.indexOf("gui-row__username")).toBeLessThan(html.indexOf("gui-row__badges"));
    expect(html.indexOf("gui-row__badges")).toBeLessThan(html.indexOf("gui-row__minimal-separator"));
    const headerIndex = html.indexOf('class="gui-row__header');
    const headerEndIndex = html.indexOf("</div>", headerIndex);
    expect(html.indexOf("gui-row__minimal-separator")).toBeLessThan(headerEndIndex);
    expect(html).toContain("gui-row__minimal-separator");
    expect(html.split('class="gui-row__badge"').length - 1).toBe(1);
  });

  it("renders no more than the configured number of minimal row badges", () => {
    const html = renderToStaticMarkup(React.createElement(GuiRow, {
      mode: "dock",
      appearance: { profile: "minimal", revision: 0, settings: { compactRows: true, rowBackgroundsEnabled: true, maxDisplayableBadges: 3 } },
      row: {
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "test-badge-user",
        text: "test badge message",
        badgeImages: [
          { imageUrl: "https://example.invalid/test-badge-1.png", source: "twitch", label: "test-badge-1" },
          { imageUrl: "https://example.invalid/test-badge-2.png", source: "twitch", label: "test-badge-2" },
          { imageUrl: "https://example.invalid/test-badge-3.png", source: "twitch", label: "test-badge-3" },
          { imageUrl: "https://example.invalid/test-badge-4.png", source: "twitch", label: "test-badge-4" },
        ],
        avatarUrl: "https://example.invalid/test-badge-avatar.png",
        timestamp: null,
      },
    }));

    expect(html.split('class="gui-row__badge"').length - 1).toBe(3);
    expect(html).toContain("https://example.invalid/test-badge-1.png");
    expect(html).toContain("https://example.invalid/test-badge-2.png");
    expect(html).toContain("https://example.invalid/test-badge-3.png");
    expect(html).not.toContain("https://example.invalid/test-badge-4.png");
    expect(html).not.toContain("test-badge-4");
  });

  it("renders minimal command rows with the ordinary compact row contract", () => {
    const html = renderToStaticMarkup(React.createElement(GuiRow, {
      mode: "overlay",
      appearance: { profile: "minimal", revision: 0, settings: { compactRows: true, rowBackgroundsEnabled: false, maxDisplayableBadges: 1 } },
      row: {
        type: "command",
        kind: "command",
        platform: "youtube",
        username: "test-youtube-account-8",
        text: "!preview",
        avatarUrl: "https://example.invalid/command-avatar.png",
        timestamp: null,
      },
    }));

    expect(html).toContain("gui-row--command");
    expect(html).toContain("gui-row--minimal");
    expect(html).toContain("gui-row--compact");
    expect(html).not.toContain("gui-row--paypiggy");
    expect(html).not.toContain("gui-row__member-tag");
    expect(html.indexOf("test-youtube-account-8")).toBeLessThan(html.indexOf("gui-row__minimal-separator"));
    expect(html.indexOf("gui-row__minimal-separator")).toBeLessThan(html.indexOf("!preview"));
  });

  it("renders notification badges after username and the platform icon on the avatar", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "platform:follow",
          kind: "notification",
          platform: "youtube",
          username: "test-follower",
          text: "followed",
          badgeImages: [{ imageUrl: "https://example.invalid/badge.png", source: "youtube", label: "member" }],
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    const badgeIndex = html.indexOf('class="gui-row__badges"');
    const usernameIndex = html.indexOf("gui-row__username");
    const avatarWrapperIndex = html.indexOf('class="gui-row__avatar-wrapper"');
    const avatarWrapperEndIndex = html.indexOf("</span>", avatarWrapperIndex);
    const iconIndex = html.indexOf('class="gui-row__platform-icon"');
    const messageIndex = html.indexOf('gui-row__text--notification');
    expect(usernameIndex).toBeLessThan(badgeIndex);
    expect(iconIndex).toBeGreaterThan(avatarWrapperIndex);
    expect(iconIndex).toBeLessThan(avatarWrapperEndIndex);
    expect(iconIndex).toBeLessThan(messageIndex);
    expect(html.slice(messageIndex)).not.toContain('class="gui-row__platform-icon"');
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
    expect(html).toContain(`src="${getPlatformIconUrl("youtube")}"`);
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

  it("adds the member row class for a member presentation role", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-paypiggy-user",
          text: "paypiggy chat",
          presentationRole: "member",
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain("gui-row--paypiggy");
    const usernameIndex = html.indexOf("gui-row__username");
    const memberLabelIndex = html.indexOf('class="gui-row__member-tag"');
    expect(memberLabelIndex).toBeGreaterThan(-1);
    expect(memberLabelIndex).toBeLessThan(usernameIndex);
    expect(html).toContain(">MEMBER<");
  });

  it("renders the member label before badges and username for chat rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-paypiggy-user",
          text: "paypiggy chat",
          presentationRole: "member",
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

    const usernameIndex = html.indexOf("gui-row__username");
    const badgesIndex = html.indexOf('class="gui-row__badges"');
    const memberLabelIndex = html.indexOf('class="gui-row__member-tag"');
    expect(memberLabelIndex).toBeLessThan(usernameIndex);
    expect(usernameIndex).toBeLessThan(badgesIndex);
    expect(html).toContain('class="gui-row__badge"');
    expect(html).toContain('src="https://example.invalid/badge-1.png"');
    expect(html).toContain('src="https://example.invalid/badge-2.png"');
  });

  it("does not add member presentation for an ordinary chat role", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-non-paypiggy-user",
          text: "non paypiggy chat",
          isPaypiggy: true,
          presentationRole: "ordinary",
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).not.toContain("gui-row--paypiggy");
    expect(html).not.toContain("gui-row__member-tag");
  });

  it("does not derive member presentation from notification membership metadata", () => {
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
    expect(html).not.toContain("gui-row__member-tag");
    expect(html).not.toContain(">MEMBER<");
  });

  it("keeps the member row class on overlay chat rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "overlay",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-overlay-paypiggy-user",
          text: "overlay paypiggy chat",
          presentationRole: "member",
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
          presentationRole: "member",
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

  it("renders a valid member sprite for member chat rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "youtube",
          username: "member",
          text: "hello",
          isPaypiggy: true,
          presentationRole: "member",
          presentationOverride: { spriteUrl: "https://cdn.example/member.gif" },
          avatarUrl: "https://example.invalid/avatar.png",
          timestamp: null,
        },
      }),
    );
    expect(html).toContain('class="gui-row__member-image"');
    expect(html).toContain('src="https://cdn.example/member.gif"');
    expect(html).not.toContain("rayquaza.gif");
  });

  it("adds the red theme class only to themed member chat rows", () => {
    const themedHtml = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "youtube",
          username: "themed-member",
          text: "hello",
          isPaypiggy: true,
          presentationRole: "member",
          presentationOverride: { theme: "red" },
          avatarUrl: "https://example.invalid/avatar.png",
          timestamp: null,
        },
      }),
    );
    const defaultHtml = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "youtube",
          username: "default-member",
          text: "hello",
          isPaypiggy: true,
          presentationRole: "member",
          avatarUrl: "https://example.invalid/avatar.png",
          timestamp: null,
        },
      }),
    );

    expect(themedHtml).toContain("gui-row--theme-red");
    expect(defaultHtml).toContain("gui-row--theme-green");
  });

  it("keeps gold profile presentation within member semantics", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "youtube",
          username: "test-gold-member",
          text: "gold member chat",
          isPaypiggy: true,
          presentationRole: "member",
          presentationOverride: {
            theme: "gold",
            effects: ["particles"],
            spriteUrl: "https://example.invalid/gold-member.gif",
          },
          avatarUrl: "https://example.invalid/avatar.png",
          timestamp: null,
        },
      }),
    );

    expect(html).toContain("gui-row--theme-gold");
    expect(html).toContain("gui-row--paypiggy");
    expect(html).toContain(">MEMBER<");
    expect(html).toContain("https://example.invalid/gold-member.gif");
    expect(html).toContain("gui-row__member-particles");
    expect(html).not.toContain("gui-row--monetization");
    expect(html).not.toContain("arceus.gif");
  });

  it("renders particles only for red member rows with an event-stable seed", () => {
    const row = (overrides: Partial<GuiRowDto> = {}, redTheme = true): GuiRowDto => ({
      type: "chat", kind: "chat", platform: "youtube",
      username: "fixture-member-particles", text: "test-only member row",
       isPaypiggy: true, presentationRole: "member", ...(redTheme ? { presentationOverride: { theme: "red" as const, effects: ["particles"] as const } } : {}), avatarUrl: "fixture-avatar", timestamp: null,
      ...overrides,
    });
    const redHtml = renderToStaticMarkup(React.createElement(GuiRow, { mode: "dock", row: row() }));
    const defaultHtml = renderToStaticMarkup(React.createElement(GuiRow, { mode: "dock", row: row({}, false) }));
    const nonMemberHtml = renderToStaticMarkup(React.createElement(GuiRow, { mode: "dock", row: row({ isPaypiggy: false, presentationRole: "ordinary" }, false) }));

    expect(redHtml).toContain("gui-row--paypiggy");
    expect(redHtml).toContain("gui-row--theme-red");
    expect(redHtml).toMatch(/<canvas[^>]*class="gui-row__member-particles"[^>]*aria-hidden="true"/);
    expect(redHtml).toMatch(/data-member-particles-seed="[^"]+"/);
    expect(defaultHtml).toContain("gui-row--paypiggy");
    expect(defaultHtml).not.toContain("gui-row__member-particles");
    expect(nonMemberHtml).not.toContain("gui-row__member-particles");
  });

  it("renders enabled stream supporter chats with gold Arceus particles but no member semantics", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-stream-supporter",
          text: "supporter chat",
          isPaypiggy: false,
          isStreamSupporter: true,
          presentationRole: "supporter",
          avatarUrl: "https://example.invalid/avatar.png",
          timestamp: null,
        },
      }),
    );

    expect(html).toContain("gui-row--theme-gold");
    expect(html).toContain("arceus.gif");
    expect(html).toContain("gui-row__member-particles");
    expect(html).not.toContain("gui-row__member-tag");
    expect(html).not.toContain("gui-row__member-image");
  });

  it("removes only stream supporter effects when the appearance toggle is disabled", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        appearance: {
          profile: "standard",
          revision: 1,
          settings: {
            compactRows: false,
            rowBackgroundsEnabled: true,
            maxDisplayableBadges: 3,
            streamSupporterChatEffectsEnabled: false,
          },
        },
        row: {
          type: "chat",
          kind: "chat",
          platform: "twitch",
          username: "test-stream-supporter",
          text: "supporter chat",
          isPaypiggy: false,
          isStreamSupporter: true,
          presentationRole: "supporter",
          avatarUrl: "https://example.invalid/avatar.png",
          timestamp: null,
        },
      }),
    );

    expect(html).not.toContain("gui-row--monetization");
    expect(html).not.toContain("arceus.gif");
    expect(html).not.toContain("gui-row__member-particles");
  });

  it("keeps the MEMBER label when an ordinary member receives supporter effects", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "youtube",
          username: "test-member-supporter",
          text: "member supporter chat",
          isPaypiggy: true,
          isStreamSupporter: true,
          presentationRole: "member",
          avatarUrl: "https://example.invalid/avatar.png",
          timestamp: null,
        },
      }),
    );

    expect(html).toContain("gui-row--theme-green");
    expect(html).toContain("rayquaza.gif");
    expect(html).toContain(">MEMBER<");
    expect(html).toContain("gui-row__member-image");
  });

  it("keeps red member presentation ahead of supporter gold", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "chat",
          kind: "chat",
          platform: "youtube",
          username: "test-red-member-supporter",
          text: "red member supporter chat",
          isPaypiggy: true,
          isStreamSupporter: true,
          presentationRole: "member",
          presentationOverride: { theme: "red", effects: ["particles"], spriteUrl: "https://example.invalid/red-member.gif" },
          avatarUrl: "https://example.invalid/avatar.png",
          timestamp: null,
        },
      }),
    );

    expect(html).toContain("gui-row--theme-red");
    expect(html).toContain("gui-row__member-image");
    expect(html).toContain("gui-row__member-particles");
    expect(html).not.toContain("gui-row--monetization");
    expect(html).not.toContain("arceus.gif");
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
          presentationRole: "member",
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
          presentationRole: "member",
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
          presentationRole: "member",
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
          presentationRole: "member",
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain("gui-row__text--overlay-clamp");
    expect(html).toContain("gui-row__text--member-chat");
  });

  it.each([
    "platform:gift",
    "platform:paypiggy",
    "platform:giftpaypiggy",
    "platform:envelope",
  ])("renders one permanent monetization row for %s in dock and overlay", (type) => {
    for (const mode of ["dock", "overlay"] as const) {
      const html = renderToStaticMarkup(
        React.createElement(GuiRow, {
          mode,
          row: {
            type,
            kind: "notification",
            platform: "youtube",
            username: "test-monetization-user",
            text: "sent a test monetization event",
            presentationRole: "monetization",
            avatarUrl: "https://example.invalid/test-avatar.png",
            timestamp: "2024-01-01T00:00:00.000Z",
          },
        }),
      );

      expect(html).toContain("gui-row--monetization");
      expect(html.split('class="gui-row__monetization-image"').length - 1).toBe(1);
      expect(html.split('class="gui-row__avatar-wrapper"').length - 1).toBe(1);
      expect(html.split('class="gui-row__platform-icon"').length - 1).toBe(1);
      expect(html).toContain(
        'src="https://img.pokemondb.net/sprites/black-white/anim/normal/arceus.gif"',
      );
    }
  });

  it.each([
    { kind: "notification" as const, type: "platform:follow" },
    { kind: "chat" as const, type: "chat" },
  ])(
    "does not render monetization styling for $kind/$type",
    ({ kind, type }) => {
      const html = renderToStaticMarkup(
        React.createElement(GuiRow, {
          mode: "dock",
          row: {
            type,
            kind,
            platform: "youtube",
            username: "test-notification-user",
            text: "test notification",
            avatarUrl: "https://example.invalid/test-avatar.png",
            timestamp: "2024-01-01T00:00:00.000Z",
          },
        }),
      );

      expect(html).not.toContain("gui-row--monetization");
      expect(html).not.toContain("gui-row__monetization-image");
      expect(html).not.toContain("arceus.gif");
    },
  );

  it("removes a failed configured member sprite and renders a later URL", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    const row = (spriteUrl: string): GuiRowDto => ({
      type: "chat",
      kind: "chat",
      platform: "youtube",
      username: "member",
      text: "hello",
      presentationRole: "member",
      presentationOverride: { spriteUrl },
      avatarUrl: "avatar",
      timestamp: null,
    });
    act(() => {
      renderer = TestRenderer.create(React.createElement(GuiRow, {
        mode: "dock",
        row: row("https://example.invalid/member-a.gif"),
      }));
    });
    const image = renderer.root.findByProps({ className: "gui-row__member-image" });

    act(() => image.props.onError());

    expect(renderer.root.findAllByProps({ className: "gui-row__member-image" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: "gui-row__member-image-clip" })).toHaveLength(0);
    expect(renderer.root.findByProps({ role: "article" }).props.className).toContain("gui-row--member-chat");
    expect(renderer.root.findByProps({ className: "gui-row__member-tag" })).toBeDefined();
    expect(renderer.root.findByProps({ className: "gui-row__text gui-row__text--member-chat" })).toBeDefined();
    expect(renderer.root.findByProps({ className: "gui-row__effect gui-row__effect--sheen" })).toBeDefined();
    act(() => {
      renderer.update(React.createElement(GuiRow, {
        mode: "dock",
        row: row("https://example.invalid/member-b.gif"),
      }));
    });
    expect(renderer.root.findByProps({ className: "gui-row__member-image" }).props.src)
      .toBe("https://example.invalid/member-b.gif");
  });

  it("removes a failed monetization sprite while preserving notification content", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(GuiRow, {
        mode: "dock",
        row: {
          type: "platform:gift",
          kind: "notification",
          platform: "youtube",
          username: "sender",
          text: "sent",
          presentationRole: "monetization",
          avatarUrl: "avatar",
          timestamp: null,
        },
      }));
    });
    const image = renderer.root.findByProps({ className: "gui-row__monetization-image" });

    act(() => image.props.onError());

    expect(renderer.root.findAllByProps({ className: "gui-row__monetization-image" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: "gui-row__monetization-image-clip" })).toHaveLength(0);
    expect(renderer.root.findByProps({ role: "article" }).props.className).toContain("gui-row--monetization");
    expect(renderer.root.findByProps({ className: "gui-row__username" })).toBeDefined();
    expect(renderer.root.findByProps({ className: "gui-row__text gui-row__text--notification" })).toBeDefined();
    expect(renderer.root.findByProps({ className: "gui-row__effect gui-row__effect--sheen" })).toBeDefined();
  });
});
