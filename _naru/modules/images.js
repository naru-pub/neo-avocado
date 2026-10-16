// The character pictures, shared by the site functions and the pages,
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
export function imageSlotsOf(profile = {}) {
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
