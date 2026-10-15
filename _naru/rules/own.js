// A member's own wallet and inventory, and nobody else's. Site functions
// change them; members only read.
import { PREFIX } from "../modules/shared.js";

export function readable(ctx, { collection }) {
  if (!ctx.member) return false;
  // A wallet's ID is its member's; an inventory row names its owner.
  return collection === `${PREFIX}wallets`
    ? { eq: [{ metadata: "id" }, ctx.member.id] }
    : { eq: ["owner", ctx.member.id] };
}

export function canWrite() {
  return false;
}

// Until Naru reads `readable`: rules exported `scope` before 1.1.0 named it so.
export const scope = readable;
