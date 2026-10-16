// A member's own inventory, and nobody else's. Site functions change it;
// members only read.
import type { ReadCtx, Where } from "../modules/naru-types.js";

export function readable(ctx: ReadCtx): Where {
  if (!ctx.member) return false;
  return { eq: ["owner", ctx.member.id] };
}

export function canWrite(): boolean {
  return false;
}
