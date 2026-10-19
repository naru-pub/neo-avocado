// 임시 저장 (bbs/ajax.autosave.php and ajax.autosavedel.php): a member keeps
// drafts of a post as they write, and deletes them.
import { invalid, signedIn, text } from "../../modules/access.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/** How many drafts a member keeps: the oldest go past it. */
const DRAFT_LIMIT = 20;

/**
 * Saves a draft (ajax.autosave.php): a new one, or `id` again, the newest
 * first. A draft with nothing in it is not kept.
 */
export async function save(
  ctx: MutationCtx,
  args: { id?: string | null; title?: string; text?: string },
) {
  const member = signedIn(ctx);
  const { id = null, title: given = "", text: written = "" } = args ?? {};
  if (
    (id !== null && typeof id !== "string") ||
    typeof given !== "string" ||
    typeof written !== "string"
  )
    invalid(ctx);
  const title = text(given, 120);
  const body = text(written, 20000);
  if (!title.trim() && !body.trim()) invalid(ctx);
  if (id !== null) {
    const { rows } = await ctx.sql<{ id: number }>`UPDATE drafts
      SET title = ${title}, body = ${body}, saved_at = ${ctx.now}
      WHERE id = ${Number(id)} AND owner = ${member} RETURNING id`;
    if (rows.length) return { id: String(rows[0].id) };
  }
  const { rows } = await ctx.sql<{ id: number }>`INSERT INTO drafts
    (owner, title, body, saved_at) VALUES (${member}, ${title}, ${body}, ${ctx.now})
    RETURNING id`;
  await ctx.sql`DELETE FROM drafts WHERE owner = ${member} AND id NOT IN
    (SELECT id FROM drafts WHERE owner = ${member} ORDER BY id DESC LIMIT ${DRAFT_LIMIT})`;
  return { id: String(rows[0].id) };
}

/** Deletes one of the member's drafts (ajax.autosavedel.php). */
export async function remove(ctx: MutationCtx, args: { id?: string }) {
  const member = signedIn(ctx);
  if (typeof args?.id !== "string") invalid(ctx);
  await ctx.sql`DELETE FROM drafts WHERE id = ${Number(args.id)} AND owner = ${member}`;
  return null;
}
