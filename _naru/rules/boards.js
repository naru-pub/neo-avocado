// The boards a member's level (or a visitor's, level 1) lets them list, by
// the same check the site functions use. Boards are written by the admin.
import { BOARDS, boardAllowed, communityAccess } from "../modules/shared.js";

export async function scope(ctx) {
  const access = await communityAccess(ctx);
  const { documents } = await ctx.list(BOARDS, { size: 100 });
  const ids = documents
    .filter((board) => boardAllowed(board, access, "list"))
    .map((board) => board.id);
  return ids.length ? { in: [{ metadata: "id" }, ids] } : false;
}

export function canWrite() {
  return false;
}
