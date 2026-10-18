// The boards a reader may use, with the owner's board groups and the
// emoticons comments show: what a page reads once to show its boards.
import { siteOpen } from "../../modules/access.js";
import { accessOf, boardAllowed, boardsOf } from "../../modules/boards.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/**
 * The boards the reader's level lets them list (a visitor's is level 1,
 * nothing while the site is closed), in ID order; the board groups in their
 * order; and the emoticons. Visitors of a closed site (사이트공개 off) read
 * none of them.
 */
export async function boards(ctx: QueryCtx) {
  if (!ctx.member && !ctx.owner && !(await siteOpen(ctx)))
    return { boards: [], groups: [], emoticons: [] };
  const access = await accessOf(ctx);
  const [groups, emoticons] = await Promise.all([
    ctx.sql<{
      id: string;
      name: string;
      members_only: number;
      sort_order: number;
    }>`SELECT * FROM board_groups ORDER BY sort_order, id`,
    ctx.sql<{
      id: string;
      name: string;
      image: string;
    }>`SELECT * FROM emoticons ORDER BY created_at, id`,
  ]);
  return {
    boards: (await boardsOf(ctx)).filter((board) =>
      boardAllowed(board, access, "list"),
    ),
    groups: groups.rows.map((row) => ({
      id: row.id,
      data: {
        name: row.name,
        membersOnly: row.members_only !== 0,
        order: row.sort_order,
      },
    })),
    emoticons: emoticons.rows.map((row) => ({
      id: row.id,
      data: { name: row.name, image: row.image },
    })),
  };
}
