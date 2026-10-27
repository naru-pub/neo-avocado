// 타이틀 보유·착용 현황 (adm/title_has_list.php): every title a character
// holds, and whether it shows it, found by character or title name or ID, a
// page at a time; a deleted title's or character's ID stands for its name.

import { ownerOnly } from "../../modules/access.js";
import { invalid, offsetOf, PAGE, pageOf } from "../../modules/admin.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  {
    search = "",
    after = null,
  }: { search?: string; after?: string | null } = {},
) {
  if (typeof search !== "string" || search.length > 100) invalid(ctx);
  const offset = offsetOf(ctx, after);
  const needle = search.trim().toLocaleLowerCase();
  const { rows } = await ctx.sql(
    `SELECT held.character_id, held.title_id, characters.active_title,
       coalesce(characters.name, held.character_id || ' (삭제된 캐릭터)') AS character,
       coalesce(titles.name, held.title_id || ' (삭제된 타이틀)') AS title,
       titles.image
     FROM character_titles AS held
     LEFT JOIN characters ON characters.id = held.character_id
     LEFT JOIN titles ON titles.id = held.title_id
     WHERE ? = '' OR instr(lower(coalesce(characters.name, held.character_id || ' (삭제된 캐릭터)') || ' ' || coalesce(titles.name, held.title_id || ' (삭제된 타이틀)') || ' ' || held.character_id || ' ' || held.title_id), ?) > 0
     ORDER BY held.character_id, held.id
     LIMIT ? OFFSET ?`,
    [needle, needle, PAGE + 1, offset],
  );
  return pageOf(
    rows.map((row) => ({
      characterId: String(row.character_id),
      titleId: row.title_id,
      character: row.character,
      title: row.title,
      image: row.image,
      active: row.active_title === row.title_id,
    })),
    offset,
  );
});
