// What the old site functions (mail) import: the one collection left, and
// helpers that moved to the site's tables, re-exported by name.
export { IMAGE_SLOTS, imageSlotsOf, viewerOf } from "./images.js";
// What moved to the site's tables (access.js, members.js), for the code
// that still imports it from here.
export {
  CLOSED_ACCESS,
  GUEST_ACCESS,
  NAME_DEFAULTS,
  RESERVED_NICKS,
  communityAccess,
  communityAmount,
  kstDay,
  kstStamp,
  names,
  namesOf,
  reservedNick,
  scheduled,
  siteOpen,
  text,
  imageUrl,
  amount,
  subject,
  lacking,
  restrictedFor,
} from "./access.js";
export type { Access, Names } from "./access.js";
export { loginReward } from "./members.js";
// The economy's helpers (economy.js), for the old code that imports them
// from here.
export { pay, record, wallet } from "./economy.js";
export const PREFIX = "neo_avocado_";

export const MESSAGES = `${PREFIX}messages`;
