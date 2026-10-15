// The boards a member's level (or a visitor's, level 1) lets them list, by
// the same check the site functions use. Boards are written by the admin.
import {
  BOARDS,
  BOARD_GROUPS,
  boardAllowed,
  communityAccess,
  withGroup,
} from "../modules/shared.js";

export async function readable(ctx) {
  const access = await communityAccess(ctx);
  const [{ documents }, groups] = await Promise.all([
    ctx.list(BOARDS, { size: 100 }),
    ctx.list(BOARD_GROUPS, { size: 100 }),
  ]);
  const boards = await Promise.all(
    documents.map((board) => withGroup(ctx, board, groups.documents)),
  );
  const ids = boards
    .filter((board) => boardAllowed(board, access, "list"))
    .map((board) => board.id);
  return ids.length ? { in: [{ metadata: "id" }, ids] } : false;
}

export function canWrite() {
  return false;
}

// Until Naru reads `readable`: rules exported `scope` before 1.1.0 named it so.
export const scope = readable;
