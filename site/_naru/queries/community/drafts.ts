// 임시 저장 (bbs/ajax.autosavelist.php): a member's drafts, newest first.
import { signedIn } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/** The member's drafts, each whole, as ajax.autosaveload.php opens one. */
export async function list(ctx: QueryCtx) {
  const member = signedIn(ctx);
  const { rows } = await ctx.sql<{
    id: number;
    title: string;
    body: string;
    saved_at: number;
  }>`SELECT id, title, body, saved_at FROM drafts WHERE owner = ${member}
    ORDER BY id DESC LIMIT 20`;
  return {
    drafts: rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      text: row.body,
      savedAt: row.saved_at,
    })),
  };
}
