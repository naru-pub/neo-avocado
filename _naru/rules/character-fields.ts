// Profile field definitions, without the admin-only ones, whose values
// members never see; visitors read them only while the site is open.
import { siteOpen } from "../modules/shared.js";
import type { ReadCtx, Where } from "../modules/naru-types.js";

export async function readable(ctx: ReadCtx): Promise<Where> {
  if (!ctx.member && !(await siteOpen(ctx))) return false;
  return {
    all: [{ ne: ["deleted", true] }, { ne: ["visibility", "admin"] }],
  };
}

export function canWrite(): boolean {
  return false;
}
