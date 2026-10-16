import { siteOpen } from "../modules/shared.js";
import type { ReadCtx, Where } from "../modules/naru-types.js";

// Catalogue rows (emoticons, board groups) the admin has not marked
// deleted. (Items and recipes are the economy's tables, read through its
// queries.)
//
// Visitors read them only while the site is open (사이트공개, cf_open).
export async function readable(ctx: ReadCtx): Promise<Where> {
  if (!ctx.member && !(await siteOpen(ctx))) return false;
  return { ne: ["deleted", true] };
}

export function canWrite(): boolean {
  return false;
}
