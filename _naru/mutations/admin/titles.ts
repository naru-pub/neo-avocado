// 타이틀 (adm/title_list.php): the owner deletes titles, and gives one to
// characters or takes it back (title_has_list.php), each in one call;
// saving one is admin/records'.
import { invalid } from "../../modules/admin.js";
import { one, ownerOnly } from "../../modules/access.js";
import { characterKey } from "../../modules/characters.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/** The characters holding or showing a title. */
const HOLDERS = `SELECT id FROM characters WHERE active_title = ?
  UNION SELECT character_id FROM character_titles WHERE title_id = ?`;

/**
 * Deletes a title: the characters holding or showing it lose it with it.
 * Answers how many did.
 */
export const remove = ownerOnly(async function remove(
  ctx: MutationCtx,
  { id }: { id?: string } = {},
) {
  if (typeof id !== "string" || !id) invalid(ctx);
  const { count } = await one<{ count: number }>(
    ctx,
    `SELECT count(*) AS count FROM (${HOLDERS})`,
    [id, id],
  );
  await ctx.sql`UPDATE characters SET version = version + 1 WHERE id IN (SELECT character_id FROM character_titles WHERE title_id = ${id})`;
  await ctx.sql`DELETE FROM character_titles WHERE title_id = ${id}`;
  await ctx.sql`UPDATE characters SET active_title = NULL, version = version + 1 WHERE active_title = ${id}`;
  await ctx.sql`DELETE FROM titles WHERE id = ${id}`;
  return { completed: count };
});

/** At most this many characters named at once. */
const MAX_TARGETS = 1000;
/** The named characters, bound as one JSON array. */
const NAMED = "SELECT value FROM json_each(?)";

/**
 * Gives a title to characters (`action` "grant") or takes it back
 * ("revoke"): those named, or every approved one (`allApproved`). Granting
 * again or revoking what was never given changes nothing; a revoked title a
 * character showed is no longer shown. Answers how many characters it was
 * for.
 */
export const grant = ownerOnly(async function grant(
  ctx: MutationCtx,
  {
    title,
    action,
    characters = [],
    allApproved = false,
  }: {
    title?: string;
    action?: string;
    characters?: string[];
    allApproved?: boolean;
  } = {},
) {
  if (!["grant", "revoke"].includes(action))
    ctx.fail("INVALID_REQUEST", "지급 또는 회수를 선택하세요.", {
      reason: "invalid_input",
    });
  if (
    typeof title !== "string" ||
    !Array.isArray(characters) ||
    characters.length > MAX_TARGETS
  )
    invalid(ctx);
  if (!(await one(ctx, "SELECT id FROM titles WHERE id = ?", [title])))
    ctx.fail("NOT_FOUND", "타이틀을 찾을 수 없습니다.", {
      reason: "no_title",
    });
  if (allApproved) {
    const { count } = await one<{ count: number }>(
      ctx,
      "SELECT count(*) AS count FROM characters WHERE state = 'approved'",
    );
    if (!count)
      ctx.fail("INVALID_REQUEST", "대상 캐릭터가 없습니다.", {
        reason: "no_targets",
      });
    const approved = "SELECT id FROM characters WHERE state = 'approved'";
    if (action === "grant") {
      await ctx.sql`INSERT INTO character_titles (character_id, title_id)
        SELECT id, ${title} FROM characters WHERE state = 'approved'
        ON CONFLICT (character_id, title_id) DO NOTHING`;
      await ctx.sql`UPDATE characters SET version = version + 1 WHERE state = 'approved'`;
    } else {
      await ctx.sql(
        `DELETE FROM character_titles WHERE title_id = ? AND character_id IN (${approved})`,
        [title],
      );
      await ctx.sql`UPDATE characters SET active_title = CASE WHEN active_title = ${title} THEN NULL ELSE active_title END, version = version + 1 WHERE state = 'approved'`;
    }
    return { completed: count };
  }
  const keys = [...new Set(characters.map(characterKey))];
  if (!keys.length)
    ctx.fail("INVALID_REQUEST", "대상 캐릭터가 없습니다.", {
      reason: "no_targets",
    });
  if (keys.includes(null))
    ctx.fail("INVALID_REQUEST", "대상 캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const named = JSON.stringify(keys);
  const { count } = await one<{ count: number }>(
    ctx,
    `SELECT count(*) AS count FROM characters WHERE id IN (${NAMED})`,
    [named],
  );
  if (count !== keys.length)
    ctx.fail("INVALID_REQUEST", "대상 캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  if (action === "grant") {
    await ctx.sql(
      `INSERT INTO character_titles (character_id, title_id)
       SELECT id, ? FROM characters WHERE id IN (${NAMED})
       ON CONFLICT (character_id, title_id) DO NOTHING`,
      [title, named],
    );
    await ctx.sql(
      `UPDATE characters SET version = version + 1 WHERE id IN (${NAMED})`,
      [named],
    );
  } else {
    await ctx.sql(
      `DELETE FROM character_titles WHERE title_id = ? AND character_id IN (${NAMED})`,
      [title, named],
    );
    await ctx.sql(
      `UPDATE characters SET active_title = CASE WHEN active_title = ? THEN NULL ELSE active_title END, version = version + 1 WHERE id IN (${NAMED})`,
      [title, named],
    );
  }
  return { completed: keys.length };
});
