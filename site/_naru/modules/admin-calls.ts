// The owner's admin sections' calls, as the admin page (site/admin/) makes
// them and Naru answers them. A section's plain calls are admin/records' (_naru/queries/admin/
// records.ts, _naru/mutations/admin/records.ts), which take the section and
// do what modules/admin.ts does for every one; the rest are the section's
// own module's, admin/<module>:<call>, for what only it does.

export type AdminCall = "list" | "get" | "save" | "remove";

const ALL: AdminCall[] = ["list", "get", "save", "remove"];

/** The calls each section answers through admin/records, by section. */
export const RECORD_CALLS: Record<string, readonly AdminCall[]> = {
  content: ALL, // adm/contentlist.php
  menus: ALL, // adm/menu_list.php
  banners: ALL, // adm/banner_list.php, intro_list.php
  quests: ALL, // adm/quest_list.php
  emoticons: ALL, // adm/emoticon_list.php
  popups: ALL, // adm/newwinlist.php
  polls: ALL, // adm/poll_list.php
  shop_entries: ALL, // 상점 진열 (avo_shop)
  gacha: ALL, // 뽑기 표
  recipes: ALL, // adm/recipi_list.php
  explore: ALL, // 탐색 표 (avo_item_explorer)
  sides: ALL, // adm/side_list.php
  classes: ALL, // adm/class_list.php
  couples: ALL, // adm/couple_list.php
  character_fields: ALL, // adm/character_article_list.php
  stat_config: ALL, // adm/status_list.php
  levels: ALL, // adm/level_list.php
  board_groups: ALL, // adm/boardgroup_list.php
  boards: ["list", "get", "remove"], // adm/board_list.php: saving is its own
  titles: ["list", "get", "save"], // adm/title_list.php: deleting is its own
  items: ["get", "save", "remove"], // adm/item_list.php: its list is its own
  inventory: ["get", "save", "remove"], // adm/inventory_list.php
  wallets: ["get"], // 화폐: listing and saving are its own
};

/**
 * The calls of sections whose every call is their own module's (or a
 * settings form's), by section, beside those RECORD_CALLS covers in part.
 */
export const OWN_CALLS: Record<string, readonly AdminCall[]> = {
  boards: ["save"],
  titles: ["remove"],
  items: ["list"],
  inventory: ["list"],
  wallets: ["list", "save"],
  members: ALL,
  history: ["list", "remove"],
  character_state: ["list", "get", "save"],
  character_review: ["list", "get"],
  title_holdings: ["list"],
};

/** The settings sections: one form each, kept as the site's settings. */
export const SETTINGS_SECTIONS = ["settings", "design", "character_images"];

/** The call a section makes for `call`, or undefined when it has none. */
export function adminCall(
  section: string,
  call: AdminCall,
): string | undefined {
  if (SETTINGS_SECTIONS.includes(section))
    return call === "get" || call === "save"
      ? `admin/settings:${call}`
      : undefined;
  if (OWN_CALLS[section]?.includes(call)) return `admin/${section}:${call}`;
  if (RECORD_CALLS[section]?.includes(call)) return `admin/records:${call}`;
  return undefined;
}
