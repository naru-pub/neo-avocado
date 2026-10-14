// Shared registry for client routing and self-contained server builds.
export const FUNCTION_MODULES = Object.freeze({
  membership: "community/membership",
  join: "community/membership",
  communityData: "community/data",
  communityRead: "community/data",
  sendMessage: "community/messages",
  mailbox: "community/messages",
  readMessage: "community/messages",
  removeMessage: "community/messages",
  messageStatus: "community/messages",
  commentCounts: "community/boards",
  moderatePost: "community/boards",
  callHistory: "community/calls",
  seeCalls: "community/calls",
  daily: "economy/shop",
  buy: "economy/shop",
  gacha: "economy/shop",
  sell: "economy/inventory",
  gift: "economy/inventory",
  craft: "economy/inventory",
  assignInventory: "economy/inventory",
  useItem: "economy/inventory",
  history: "economy/history",
  characterStatus: "characters/progression",
  allocateStats: "characters/progression",
  equipTitle: "characters/progression",
  relation: "characters/relations",
  removeRelation: "characters/relations",
  outfit: "characters/wardrobe",
  wear: "characters/wardrobe",
  removeOutfit: "characters/wardrobe",
  mainCharacter: "characters/profile",
  reviewCharacter: "characters/review",
  quests: "content/quests",
  contentPages: "content/pages",
  contentPage: "content/pages",
  site: "content/site",
  home: "content/home",
});
export function functionReference(name) {
  const module = Object.hasOwn(FUNCTION_MODULES, name)
    ? FUNCTION_MODULES[name]
    : null;
  if (!module) throw new TypeError("Unknown site function: " + name);
  return module + ":" + name;
}
