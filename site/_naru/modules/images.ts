import type { Data } from "./json.js";
// The character pictures, shared by the queries and mutations and the pages,
// which read this file as it is published.

/**
 * The character pictures the owner uses (adm/character_article_list.php's
 * 두상, 흉상, 전신: ad_use_*, ad_url_*, ad_text_*, ad_help_*), from the
 * settings row "profile". The 두상 is the character's `image`, on from the
 * start as this template has always had it; 흉상 and 전신 start off, as in
 * the original. `url` asks for an address instead of an upload.
 */
export const IMAGE_SLOTS = Object.freeze([
  { slot: "thumb", key: "image", label: "두상", use: true },
  { slot: "head", key: "head", label: "흉상", use: false },
  { slot: "body", key: "body", label: "전신", use: false },
]);
export function imageSlotsOf(profile: Data | null = {}) {
  return IMAGE_SLOTS.map(({ slot, key, label, use }) => ({
    slot,
    key,
    use:
      typeof profile?.[`${slot}Use`] === "boolean"
        ? profile[`${slot}Use`]
        : use,
    url: profile?.[`${slot}Url`] === true,
    label:
      (typeof profile?.[`${slot}Label`] === "string" &&
        profile[`${slot}Label`].trim().slice(0, 20)) ||
      label,
    help:
      typeof profile?.[`${slot}Help`] === "string"
        ? profile[`${slot}Help`].slice(0, 200)
        : "",
  }));
}

/**
 * The character's name on the sheet (ad_text_name, ad_help_name): always
 * asked for (ad_use_name is a hidden 1), named and explained as the owner
 * says, "이름" until then.
 */
export function nameFieldOf(profile: Data | null = {}) {
  return {
    label:
      (typeof profile?.nameLabel === "string" &&
        profile.nameLabel.trim().slice(0, 20)) ||
      "이름",
    help:
      typeof profile?.nameHelp === "string"
        ? profile.nameHelp.slice(0, 200)
        : "",
  };
}

/**
 * What a character's page shows (adm/character_article_list.php's ad_use_exp,
 * ad_use_rank, ad_use_status, ad_use_title, ad_use_closet), from the same
 * settings row. On from the start, as this template has always shown them.
 */
export const VIEWER_SWITCHES = Object.freeze([
  "exp",
  "rank",
  "stats",
  "titles",
  "closet",
]);
export function viewerOf(profile: Data | null = {}) {
  return Object.fromEntries(
    VIEWER_SWITCHES.map((key) => [
      key,
      profile?.[`show${key[0].toUpperCase()}${key.slice(1)}`] !== false,
    ]),
  );
}
