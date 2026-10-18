// The member's own wallet: their balance, which only the community's own
// code changes.
import { signedIn } from "../../modules/access.js";
import { walletOf } from "../../modules/members.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export async function wallet(ctx: QueryCtx) {
  return { balance: (await walletOf(ctx, signedIn(ctx))).balance };
}
