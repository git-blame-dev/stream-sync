import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

function readSharedStyles() {
  const filePath = path.resolve(
    process.cwd(),
    "gui/src/shared/styles.css",
  );
  return fs.readFileSync(filePath, "utf8");
}

function readCssBlock(cssText: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockPattern = new RegExp(
    `(?:^|\\n)\\s*${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`,
    "m",
  );
  const match = cssText.match(blockPattern);
  return match?.[1] ?? "";
}

describe("GUI shared styles behavior", () => {
  it("reuses canonical overlay presentation in the serialized top notification slot", () => {
    const cssText = readSharedStyles();
    const notificationShellBlock = readCssBlock(cssText, ".gui-shell--notifications");
    expect(cssText).toContain(".gui-shell--notifications {");
    expect(cssText).toContain("@keyframes gui-notification-row-enter");
    expect(cssText).toContain("@keyframes gui-notification-row-exit");
    expect(cssText).toContain(".gui-row--overlay-enter.gui-row--notification-enter {");
    expect(cssText).toContain(".gui-row--overlay-enter.gui-row--notification-exit {");
    expect(cssText).toContain("animation: gui-notification-row-enter var(--notification-transition-ms) ease-out both;");
    expect(cssText).toContain("animation: gui-notification-row-exit var(--notification-transition-ms) ease-out forwards;");
    expect(cssText).toContain("transform: translateY(-100%);");
    expect(notificationShellBlock).toContain("--gui-avatar-size-current: var(--gui-overlay-avatar-size);");
    expect(notificationShellBlock).toContain("--gui-platform-icon-size-current: var(--gui-overlay-platform-icon-size);");
    expect(notificationShellBlock).toContain("--gui-row-body-font-size-current: var(--gui-overlay-row-body-font-size);");
    expect(notificationShellBlock).toContain("justify-content: flex-start;");
    expect(cssText).not.toContain(".gui-shell--notifications .gui-row__monetization-image-clip");
    expect(cssText).not.toContain(".gui-shell--notifications .gui-row--monetization .gui-row__content");
    expect(cssText).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("scopes minimal compact and background-off presentation to the minimal shell", () => {
    const cssText = readSharedStyles();
    expect(cssText).toContain(".gui-shell--minimal .gui-row--minimal.gui-row--compact");
    expect(cssText).toContain("--gui-avatar-size-current: 30px;");
    expect(cssText).toContain("--gui-avatar-size-current: 24px;");
    expect(cssText).toContain(".gui-shell--minimal .gui-row--minimal.gui-row--background-off");
    expect(cssText).toContain("background: transparent;");
    expect(cssText).toContain("padding-right: 96px;");
    expect(cssText).toContain("prefers-reduced-motion: reduce");
  });
  it("uses mode-specific gui size tokens for row visuals and typography", () => {
    const cssText = readSharedStyles();
    const pageBlock = readCssBlock(cssText, "html, body");
    const rootBlock = readCssBlock(cssText, ":root");
    const overlayShellBlock = readCssBlock(cssText, ".gui-shell--overlay");
    const dockShellBlock = readCssBlock(cssText, ".gui-shell--dock");
    const overlayExitBlock = readCssBlock(cssText, ".gui-row--overlay-exit");
    const rowBlock = readCssBlock(cssText, ".gui-row");
    const contentBlock = readCssBlock(cssText, ".gui-row__content");
    const copyBlock = readCssBlock(cssText, ".gui-row__copy");
    const minimalAvatarWrapperBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row--minimal .gui-row__avatar-wrapper",
    );
    const minimalTextColorBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row--minimal .gui-row__username,\n.gui-shell--minimal .gui-row--minimal .gui-row__text",
    );
    const minimalUsernameBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row--minimal .gui-row__username",
    );
    const memberChatRowBlock = readCssBlock(cssText, ".gui-row--member-chat");
    const redMemberThemeBlock = readCssBlock(cssText, ".gui-row--member-theme-red");
    const overlayEnterBlock = readCssBlock(cssText, ".gui-row--overlay-enter");
    const effectLayerBlock = readCssBlock(cssText, ".gui-shell__effect-layer");
    const effectVideoBlock = readCssBlock(cssText, ".gui-shell__effect-video");
    const effectCanvasBlock = readCssBlock(
      cssText,
      ".gui-shell__gift-animation",
    );
    const avatarBlock = readCssBlock(cssText, ".gui-row__avatar");
    const avatarWrapperBlock = readCssBlock(
      cssText,
      ".gui-row__avatar-wrapper",
    );
    const platformIconBlock = readCssBlock(cssText, ".gui-row__platform-icon");
    const avatarPlatformIconBlock = readCssBlock(
      cssText,
      ".gui-row__avatar-wrapper .gui-row__platform-icon",
    );
    const usernameBlock = readCssBlock(cssText, ".gui-row__username");
    const sharedTextShadowBlock = readCssBlock(
      cssText,
      ".gui-row__username,\n.gui-row__text",
    );
    const memberTagBlock = readCssBlock(cssText, ".gui-row__member-tag");
    const badgesBlock = readCssBlock(cssText, ".gui-row__badges");
    const badgeBlock = readCssBlock(cssText, ".gui-row__badge");
    const textBlock = readCssBlock(cssText, ".gui-row__text");
    const memberContentBlock = readCssBlock(
      cssText,
      ".gui-row__content--member-chat",
    );
    const memberCopyBlock = readCssBlock(
      cssText,
      ".gui-row__content--member-chat .gui-row__copy",
    );
    const monetizationContentBlock = readCssBlock(
      cssText,
      ".gui-row__content--monetization",
    );
    const memberHeaderBlock = readCssBlock(
      cssText,
      ".gui-row__header--member-chat",
    );
    const memberUsernameBlock = readCssBlock(
      cssText,
      ".gui-row__username--member-chat",
    );
    const memberTextBlock = readCssBlock(
      cssText,
      ".gui-row__text--member-chat",
    );
    const memberImageClipBlock = readCssBlock(
      cssText,
      ".gui-row__member-image-clip",
    );
    const memberImageBlock = readCssBlock(cssText, ".gui-row__member-image");
    const minimalOverlayBlock = readCssBlock(
      cssText,
      ".gui-shell--overlay.gui-shell--minimal",
    );
    const minimalDockBlock = readCssBlock(
      cssText,
      ".gui-shell--dock.gui-shell--minimal",
    );
    const minimalNotificationsBlock = readCssBlock(
      cssText,
      ".gui-shell--notifications.gui-shell--minimal",
    );
    const minimalPlatformIconBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row__avatar-wrapper .gui-row__platform-icon",
    );
    const minimalMemberImageClipBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row__member-image-clip",
    );
    const minimalMemberImageBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row__member-image",
    );
    const minimalMemberContentBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row__content--member-chat",
    );
    const minimalMemberCopyBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row__content--member-chat .gui-row__copy",
    );
    const minimalOverlayEnterBlock = readCssBlock(
      cssText,
      ".gui-shell--overlay.gui-shell--minimal .gui-row--overlay-enter:not(.gui-row--overlay-exit)",
    );
    const minimalHeaderBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row--minimal.gui-row--compact .gui-row__header",
    );
    const minimalOverlayCopyBlock = readCssBlock(
      cssText,
      ".gui-shell--overlay.gui-shell--minimal .gui-row--minimal.gui-row--compact .gui-row__copy",
    );
    const minimalTextBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row--minimal .gui-row__text--minimal",
    );
    const minimalSeparatorBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row--minimal .gui-row__minimal-separator",
    );
    const minimalMemberTagBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row--minimal .gui-row__member-tag",
    );
    const minimalBadgesBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row--minimal .gui-row__badges",
    );
    const minimalBadgeBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row--minimal .gui-row__badge",
    );
    const minimalEmoteBlock = readCssBlock(
      cssText,
      ".gui-shell--minimal .gui-row--minimal .gui-row__emote",
    );
    const monetizationBlock = readCssBlock(
      cssText,
      ".gui-row--monetization",
    );
    const monetizationAvatarBlock = readCssBlock(
      cssText,
      ".gui-row--monetization .gui-row__avatar",
    );
    const monetizationImageClipBlock = readCssBlock(
      cssText,
      ".gui-row__monetization-image-clip",
    );
    const monetizationImageBlock = readCssBlock(cssText, ".gui-row__monetization-image");
    const emoteBlock = readCssBlock(cssText, ".gui-row__emote");

    expect(pageBlock).toContain("margin: 0;");
    expect(pageBlock).toContain("padding: 0;");
    expect(rootBlock).toContain("--gui-row-background-opacity: 0.95;");
    expect(rootBlock).toContain("--gui-row-content-gap: 2px;");
    expect(rootBlock).toContain(
      "--gui-row-text-shadow: 0 1px 2px rgba(0, 0, 0, 0.72);",
    );
    expect(rootBlock).toContain("--gui-overlay-avatar-size: 60px;");
    expect(rootBlock).toContain("--gui-overlay-platform-icon-size: 25.81px;");
    expect(rootBlock).toContain("--gui-overlay-badge-size: 27px;");
    expect(rootBlock).toContain("--gui-overlay-row-header-font-size: 20px;");
    expect(rootBlock).toContain("--gui-overlay-row-body-font-size: 23px;");
    expect(rootBlock).toContain("--gui-overlay-emote-size: 50px;");
    expect(rootBlock).toContain("--gui-dock-avatar-size: 48px;");
    expect(rootBlock).toContain("--gui-dock-platform-icon-size: 22.44px;");
    expect(rootBlock).toContain("--gui-dock-badge-size: 21px;");
    expect(rootBlock).toContain("--gui-dock-row-header-font-size: 16px;");
    expect(rootBlock).toContain("--gui-dock-row-body-font-size: 18px;");
    expect(rootBlock).toContain("--gui-dock-emote-size: 36px;");
    expect(rootBlock).toContain(
      "--gui-member-background-gradient-top: rgba(28, 138, 83, var(--gui-row-background-opacity));",
    );
    expect(rootBlock).toContain(
      "--gui-member-background-gradient-bottom: rgba(44, 197, 114, var(--gui-row-background-opacity));",
    );
    expect(rootBlock).toContain("--gui-member-pill-border: #ffc400;");
    expect(rootBlock).toContain("--gui-overlay-member-pill-font-size: 11.2px;");
    expect(rootBlock).toContain("--gui-dock-member-pill-font-size: 8.96px;");
    expect(rootBlock).toContain("--gui-member-sheen-peak-opacity: 0.46;");
    expect(rootBlock).toContain("--gui-member-sheen-cycle-duration: 5s;");
    expect(rootBlock).toContain("--gui-member-sheen-highlight: var(--gui-member-pill-top);");
    expect(overlayShellBlock).toContain("height: 100vh;");
    expect(overlayShellBlock).toContain("overflow: hidden;");
    expect(overlayShellBlock).toContain(
      "--gui-avatar-size-current: var(--gui-overlay-avatar-size);",
    );
    expect(overlayShellBlock).toContain(
      "--gui-platform-icon-size-current: var(--gui-overlay-platform-icon-size);",
    );
    expect(overlayShellBlock).toContain(
      "--gui-badge-size-current: var(--gui-overlay-badge-size);",
    );
    expect(overlayShellBlock).toContain(
      "--gui-row-header-font-size-current: var(--gui-overlay-row-header-font-size);",
    );
    expect(overlayShellBlock).toContain(
      "--gui-row-body-font-size-current: var(--gui-overlay-row-body-font-size);",
    );
    expect(overlayShellBlock).toContain(
      "--gui-member-pill-font-size-current: var(--gui-overlay-member-pill-font-size);",
    );
    expect(overlayShellBlock).toContain(
      "--gui-emote-size-current: var(--gui-overlay-emote-size);",
    );
    expect(dockShellBlock).toContain("min-height: 100vh;");
    expect(dockShellBlock).toContain("position: relative;");
    expect(dockShellBlock).toContain("background: transparent;");
    expect(dockShellBlock).toContain(
      "--gui-avatar-size-current: var(--gui-dock-avatar-size);",
    );
    expect(dockShellBlock).toContain(
      "--gui-platform-icon-size-current: var(--gui-dock-platform-icon-size);",
    );
    expect(dockShellBlock).toContain(
      "--gui-badge-size-current: var(--gui-dock-badge-size);",
    );
    expect(dockShellBlock).toContain(
      "--gui-row-header-font-size-current: var(--gui-dock-row-header-font-size);",
    );
    expect(dockShellBlock).toContain(
      "--gui-row-body-font-size-current: var(--gui-dock-row-body-font-size);",
    );
    expect(dockShellBlock).toContain(
      "--gui-member-pill-font-size-current: var(--gui-dock-member-pill-font-size);",
    );
    expect(dockShellBlock).toContain(
      "--gui-emote-size-current: var(--gui-dock-emote-size);",
    );
    expect(overlayExitBlock).toContain("position: absolute;");
    expect(overlayExitBlock).toContain(
      "animation: gui-overlay-row-exit 1000ms ease-out forwards;",
    );
    expect(effectLayerBlock).toContain("position: absolute;");
    expect(effectLayerBlock).toContain("inset: 0;");
    expect(effectLayerBlock).toContain("z-index: 3;");
    expect(effectLayerBlock).toContain("pointer-events: none;");
    expect(effectVideoBlock).toContain("opacity: 0;");
    expect(effectVideoBlock).toContain("width: 1px;");
    expect(effectCanvasBlock).toContain("position: absolute;");
    expect(effectCanvasBlock).toContain("width: 100%;");
    expect(effectCanvasBlock).toContain("height: 100%;");
    expect(cssText).toContain("@keyframes gui-overlay-row-exit");
    expect(cssText).toContain(
      "translateY(calc(-1 * var(--overlay-exit-travel, 0px)))",
    );
    expect(rowBlock).toContain("grid-template-columns: auto 1fr;");
    expect(rowBlock).toContain(
      "background: rgba(0, 0, 0, var(--gui-row-background-opacity));",
    );
    expect(minimalAvatarWrapperBlock).toContain("align-self: start;");
    expect(minimalAvatarWrapperBlock).toContain("margin-top: 1px;");
    expect(cssText).not.toContain(
      ".gui-shell--minimal .gui-row--member-chat .gui-row__avatar-wrapper",
    );
    expect(minimalTextColorBlock).toContain("color: #ffffff;");
    expect(minimalBadgesBlock).toContain("height: 1em;");
    expect(minimalBadgesBlock).toContain("transform: translateY(2px);");
    expect(minimalBadgeBlock).toContain("width: 1em;");
    expect(minimalBadgeBlock).toContain("height: 1em;");
    expect(minimalEmoteBlock).toContain("width: auto;");
    expect(minimalEmoteBlock).toContain("height: 1em;");
    expect(minimalEmoteBlock).toContain("vertical-align: text-bottom;");
    expect(minimalMemberTagBlock).toContain("transform: none;");
    expect(minimalHeaderBlock).toContain("display: inline-flex;");
    expect(minimalHeaderBlock).toContain("align-items: baseline;");
    expect(minimalHeaderBlock).toContain("max-width: 100%;");
    expect(minimalHeaderBlock).toContain("line-height: 1.08;");
    expect(minimalUsernameBlock).toContain("min-width: 0;");
    expect(minimalUsernameBlock).toContain("overflow: hidden;");
    expect(minimalUsernameBlock).toContain("text-overflow: ellipsis;");
    expect(minimalUsernameBlock).toContain("white-space: nowrap;");
    expect(minimalTextBlock).toContain(
      "font-size: var(--gui-row-header-font-size-current);",
    );
    expect(minimalTextBlock).toContain("line-height: 1.08;");
    expect(sharedTextShadowBlock).toContain(
      "text-shadow: var(--gui-row-text-shadow);",
    );
    expect(cssText).toContain(".gui-row--paypiggy {");
    expect(cssText).toContain(
      "border: 1px solid var(--gui-member-border-color);",
    );
    expect(cssText).toContain("linear-gradient(");
    expect(cssText).toContain("var(--gui-member-background-gradient-top) 0%");
    expect(cssText).toContain(
      "var(--gui-member-background-gradient-bottom) 100%",
    );
    expect(cssText).toContain(".gui-row--monetization {");
    expect(cssText).toContain("var(--gui-member-background-gradient-mid) 58%");
    expect(cssText).toContain(".gui-row--paypiggy .gui-row__username {");
    expect(cssText).toContain(".gui-row--paypiggy .gui-row__text {");
    expect(cssText).toContain("color: #ffffff;");
    expect(cssText).toContain(".gui-row--paypiggy .gui-row__avatar {");
    expect(redMemberThemeBlock).toContain("--gui-member-background-gradient-top:");
    expect(redMemberThemeBlock).toContain("--gui-member-background-gradient-mid:");
    expect(redMemberThemeBlock).toContain("--gui-member-background-gradient-bottom:");
    expect(redMemberThemeBlock).toContain("--gui-member-border-color:");
    expect(redMemberThemeBlock).toContain("--gui-member-glow-soft:");
    expect(redMemberThemeBlock).toContain("--gui-member-sheen-highlight:");
    expect(redMemberThemeBlock).toContain(
      "--gui-member-avatar-halo-glow: rgba(255, 104, 118, 0.98);",
    );
    expect(redMemberThemeBlock).not.toContain("--gui-member-pill-");
    expect(cssText).toContain(
      "outline: 1px solid color-mix(in srgb, var(--gui-member-avatar-halo-glow) 78%, transparent);",
    );
    expect(cssText).toContain(
      "0 0 14px 1px color-mix(in srgb, var(--gui-member-avatar-halo-glow) 74%, transparent)",
    );
    expect(cssText).toContain(
      "filter: drop-shadow(0 0 6px color-mix(in srgb, var(--gui-member-avatar-halo-glow) 74%, transparent));",
    );
    expect(memberChatRowBlock).not.toContain("padding-bottom: 0;");
    expect(overlayEnterBlock).toContain("animation: none;");
    expect(minimalOverlayEnterBlock).toContain(
      "animation: gui-minimal-overlay-row-enter 220ms ease-out both;",
    );
    expect(avatarBlock).toContain("width: var(--gui-avatar-size-current);");
    expect(avatarBlock).toContain("height: var(--gui-avatar-size-current);");
    expect(avatarWrapperBlock).toContain("position: relative;");
    expect(avatarWrapperBlock).toContain("width: var(--gui-avatar-size-current);");
    expect(avatarWrapperBlock).toContain("height: var(--gui-avatar-size-current);");
    expect(platformIconBlock).toContain(
      "width: var(--gui-platform-icon-size-current);",
    );
    expect(platformIconBlock).toContain(
      "height: var(--gui-platform-icon-size-current);",
    );
    expect(avatarPlatformIconBlock).toContain("position: absolute;");
    expect(avatarPlatformIconBlock).toContain("left: -9px;");
    expect(avatarPlatformIconBlock).toContain("bottom: -4px;");
    expect(avatarPlatformIconBlock).toContain("z-index: 2;");
    expect(minimalOverlayBlock).toContain(
      "--gui-avatar-size-current: 30px;",
    );
    expect(minimalOverlayBlock).toContain(
      "--gui-platform-icon-size-current: 12.905px;",
    );
    expect(minimalOverlayBlock).toContain(
      "--gui-badge-size-current: var(--gui-overlay-badge-size);",
    );
    expect(minimalDockBlock).toContain(
      "--gui-avatar-size-current: 24px;",
    );
    expect(minimalDockBlock).toContain(
      "--gui-platform-icon-size-current: 11.22px;",
    );
    expect(minimalDockBlock).toContain(
      "--gui-badge-size-current: var(--gui-dock-badge-size);",
    );
    expect(minimalNotificationsBlock).toContain(
      "--gui-avatar-size-current: 24px;",
    );
    expect(minimalNotificationsBlock).toContain(
      "--gui-platform-icon-size-current: 11.22px;",
    );
    expect(minimalNotificationsBlock).toContain(
      "--gui-badge-size-current: var(--gui-dock-badge-size);",
    );
    expect(minimalPlatformIconBlock).toContain("left: -4.5px;");
    expect(minimalPlatformIconBlock).toContain("bottom: -2px;");
    expect(usernameBlock).toContain(
      "font-size: var(--gui-row-header-font-size-current);",
    );
    expect(usernameBlock).toContain("line-height: 1;");
    expect(memberTagBlock).toContain("padding: 0 4.5px;");
    expect(memberTagBlock).toContain(
      "font-size: var(--gui-member-pill-font-size-current);",
    );
    expect(memberTagBlock).toContain("color: var(--gui-member-pill-text);");
    expect(memberTagBlock).toContain("font-weight: 800;");
    expect(memberTagBlock).toContain("letter-spacing: -0.03em;");
    expect(memberTagBlock).toContain("text-transform: uppercase;");
    expect(memberTagBlock).toContain("display: inline-flex;");
    expect(memberTagBlock).toContain("align-items: center;");
    expect(memberTagBlock).toContain("transform: translateY(1px);");
    expect(cssText).toContain(".gui-row--paypiggy::before {");
    expect(cssText).toContain(
      "animation: gui-member-sheen-sweep var(--gui-member-sheen-cycle-duration) ease-out infinite;",
    );
    expect(cssText).toContain("@media (prefers-reduced-motion: reduce)");
    expect(cssText).toContain(
      ".gui-row--overlay-enter.gui-row--overlay-exit {\n    animation: none;",
    );
    expect(cssText).toContain("opacity: 0;");
    expect(badgesBlock).toContain("display: inline-flex;");
    expect(badgesBlock).toContain("align-items: center;");
    expect(badgeBlock).toContain("width: var(--gui-badge-size-current);");
    expect(badgeBlock).toContain("height: var(--gui-badge-size-current);");
    expect(textBlock).toContain(
      "font-size: var(--gui-row-body-font-size-current);",
    );
    expect(textBlock).toContain("line-height: 1.08;");
    expect(textBlock).toContain("margin-top: 0;");
    expect(contentBlock).toContain("min-width: 0;");
    expect(copyBlock).toContain("display: flex;");
    expect(copyBlock).toContain("flex-direction: column;");
    expect(copyBlock).toContain("gap: var(--gui-row-content-gap);");
    expect(memberContentBlock).toContain("display: flow-root;");
    expect(memberCopyBlock).toContain("display: block;");
    expect(monetizationContentBlock).toContain("position: relative;");
    expect(memberHeaderBlock).toContain("min-width: 0;");
    expect(memberUsernameBlock).toContain("min-width: 0;");
    expect(memberUsernameBlock).toContain("overflow: hidden;");
    expect(memberUsernameBlock).toContain("text-overflow: ellipsis;");
    expect(memberUsernameBlock).toContain("white-space: nowrap;");
    expect(memberUsernameBlock).toContain("flex: 0 1 auto;");
    expect(memberUsernameBlock).not.toContain("line-height:");
    expect(memberTextBlock).toContain("display: block;");
    expect(memberTextBlock).toContain("margin-top: var(--gui-row-content-gap);");
    expect(memberTextBlock).toContain("overflow-wrap: anywhere;");
    expect(memberTextBlock).toContain("word-break: break-word;");
    expect(memberImageClipBlock).toContain("width: 120px;");
    expect(memberImageClipBlock).toContain("height: 110px;");
    expect(memberImageClipBlock).toContain("float: right;");
    expect(memberImageClipBlock).toContain("margin-left: 10px;");
    expect(memberImageClipBlock).toContain("margin-right: -80px;");
    expect(memberImageClipBlock).toContain("margin-top: -40px;");
    expect(memberImageClipBlock).toContain("margin-bottom: 0;");
    expect(memberImageClipBlock).toContain("overflow: hidden;");
    expect(memberImageBlock).toContain("width: 120px;");
    expect(memberImageBlock).toContain("height: 120px;");
    expect(memberImageBlock).toContain("object-fit: contain;");
    expect(minimalMemberImageClipBlock).toContain("width: 60px;");
    expect(minimalMemberImageClipBlock).toContain("height: 60px;");
    expect(minimalMemberImageClipBlock).toContain("float: none;");
    expect(minimalMemberImageClipBlock).toContain("position: absolute;");
    expect(minimalMemberImageClipBlock).toContain("top: -20px;");
    expect(minimalMemberImageClipBlock).toContain("right: -8px;");
    expect(minimalMemberImageClipBlock).toContain("margin: 0;");
    expect(minimalMemberImageClipBlock).toContain("overflow: visible;");
    expect(minimalMemberImageClipBlock).toContain("z-index: 1;");
    expect(minimalMemberImageClipBlock).toContain("pointer-events: none;");
    expect(minimalMemberImageBlock).toContain("width: 60px;");
    expect(minimalMemberImageBlock).toContain("height: 60px;");
    expect(minimalMemberContentBlock).toContain("position: relative;");
    expect(minimalMemberContentBlock).toContain("min-height: 60px;");
    expect(minimalMemberContentBlock).not.toContain("padding-right:");
    expect(minimalMemberCopyBlock).toContain("padding-right: 44px;");
    expect(minimalTextBlock).not.toContain("position:");
    expect(minimalTextBlock).not.toContain("\n  top:");
    expect(minimalSeparatorBlock).not.toContain("position:");
    expect(minimalSeparatorBlock).not.toContain("\n  top:");
    expect(minimalOverlayCopyBlock).toContain(
      "max-block-size: calc(var(--overlay-line-clamp, 3) * 1lh);",
    );
    expect(minimalOverlayCopyBlock).toContain("overflow: hidden;");
    expect(minimalOverlayCopyBlock).not.toContain("-webkit-");
    expect(minimalMemberTagBlock).toContain("border-radius: 999px;");
    expect(rootBlock).toContain("--gui-monetization-background-top:");
    expect(rootBlock).toContain("--gui-monetization-background-mid:");
    expect(rootBlock).toContain("--gui-monetization-background-bottom:");
    expect(rootBlock).toContain("--gui-monetization-sheen-cycle-duration: 5s;");
    expect(monetizationBlock).toContain("position: relative;");
    expect(monetizationBlock).toContain("overflow: visible;");
    expect(monetizationBlock).toContain("border: 1px solid var(--gui-monetization-border-color);");
    expect(monetizationBlock).toContain("var(--gui-monetization-background-top) 0%");
    expect(monetizationBlock).toContain("var(--gui-monetization-background-bottom) 100%");
    expect(monetizationBlock).toContain("var(--gui-monetization-glow-soft)");
    expect(monetizationAvatarBlock).toContain("var(--gui-monetization-avatar-halo-glow)");
    expect(monetizationImageClipBlock).toContain("width: 102px;");
    expect(monetizationImageClipBlock).toContain("height: 94px;");
    expect(monetizationImageClipBlock).toContain("position: absolute;");
    expect(monetizationImageClipBlock).toContain("top: -20px;");
    expect(monetizationImageClipBlock).toContain("right: -37px;");
    expect(monetizationImageClipBlock).toContain("pointer-events: none;");
    expect(monetizationImageBlock).toContain("width: 102px;");
    expect(monetizationImageBlock).toContain("height: 102px;");
    expect(monetizationImageBlock).toContain("object-fit: contain;");
    expect(cssText).toContain(".gui-row--monetization::before {");
    expect(cssText).toContain(
      "animation: gui-monetization-sheen-sweep var(--gui-monetization-sheen-cycle-duration) ease-out infinite;",
    );
    expect(cssText).toContain("@keyframes gui-monetization-sheen-sweep");
    expect(cssText).toContain(
      ".gui-row--monetization::before {\n    animation: none;",
    );
    expect(cssText).not.toContain("text-shadow: none;");
    expect(cssText).toContain(
      ".gui-row--monetization .gui-row__monetization-image-clip,\n  .gui-row--member-chat .gui-row__member-image-clip {\n    display: none;",
    );
    expect(cssText).toContain(
      ".gui-shell--overlay.gui-shell--minimal .gui-row--overlay-enter:not(.gui-row--overlay-exit) {\n    animation: none;",
    );
    expect(emoteBlock).toContain("width: var(--gui-emote-size-current);");
    expect(emoteBlock).toContain("height: var(--gui-emote-size-current);");
  });
});
