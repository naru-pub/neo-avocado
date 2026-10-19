// 캐릭터 신청 심사 (adm/character_list.php:107-140): characters whose name or
// owner's nickname has `text`, of a 소속 and 종족, then of a state, newest
// first, a page at a time, with how many of each state the search leaves
// (character_list.php:285-288), the 소속 and 종족 characters have to filter
// by, and the profile fields every sheet is shown with. A character's sheet
// with all its fields, for the owner's form.
import { PAGE, invalid, offsetOf, pageOf } from "../../modules/admin.js";
import { REVIEW_STATES } from "../../shared/admin-model.js";
import {
  characterRow,
  definitionDocument,
  fieldCatalogue,
  fieldsOf,
  sheetOf,
} from "../../modules/characters.js";
import type { CharacterRow } from "../../modules/characters.js";
import { ownerOnly } from "../../modules/access.js";
import type { QueryCtx, SqlValue } from "../../modules/naru-types.js";

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  {
    field = "name",
    text = "",
    state = "",
    side = "",
    kind = "",
    after = null,
  }: {
    field?: string;
    text?: string;
    state?: string;
    side?: string;
    kind?: string;
    after?: string | null;
  } = {},
) {
  if (
    !["name", "nick"].includes(field) ||
    ![text, side, kind].every(
      (value) => typeof value === "string" && value.length <= 100,
    ) ||
    !["", ...REVIEW_STATES].includes(state)
  )
    invalid(ctx);
  const offset = offsetOf(ctx, after);
  const needle = text.trim().toLocaleLowerCase();
  const searched = `FROM characters LEFT JOIN profiles ON profiles.member = characters.owner
    WHERE (? = '' OR instr(lower(${field === "nick" ? "coalesce(profiles.nick, '')" : "characters.name"}), ?) > 0)
      AND (? = '' OR characters.side = ?) AND (? = '' OR characters.class = ?)`;
  const values: SqlValue[] = [needle, needle, side, side, kind, kind];
  // 전체 leaves out the deleted (삭제), which have a count of their own
  // (character_list.php:20-21, 58-59).
  const counts = { all: 0, editing: 0, submitted: 0, approved: 0, deleted: 0 };
  for (const row of (
    await ctx.sql(
      `SELECT characters.state, count(*) AS count ${searched} GROUP BY characters.state`,
      values,
    )
  ).rows) {
    if (row.state !== "deleted") counts.all += Number(row.count);
    if (Object.hasOwn(counts, String(row.state)) && row.state !== "all")
      counts[String(row.state)] = Number(row.count);
  }
  const { rows } = await ctx.sql<CharacterRow & { nick: string | null }>(
    `SELECT characters.*, profiles.nick ${searched}
       AND (? = '' AND characters.state != 'deleted' OR characters.state = ?)
     ORDER BY characters.created_at DESC, characters.id DESC LIMIT ? OFFSET ?`,
    [...values, state, state, PAGE + 1, offset],
  );
  const distinct = async (column: string) =>
    (
      await ctx.sql(
        `SELECT DISTINCT ${column} AS value FROM characters WHERE ${column} != '' ORDER BY ${column} LIMIT 1000`,
      )
    ).rows.map((row) => String(row.value));
  return {
    ...pageOf(
      rows.map((row) => ({
        ...sheetOf(row, fieldsOf(row)),
        nick: row.nick ?? "알 수 없는 회원",
      })),
      offset,
    ),
    counts,
    sides: await distinct("side"),
    classes: await distinct("class"),
    fields: (await fieldCatalogue(ctx)).map(definitionDocument),
  };
});

export const get = ownerOnly(async function get(
  ctx: QueryCtx,
  { id }: { id?: string } = {},
) {
  const row = await characterRow(ctx, id);
  return row ? sheetOf(row, fieldsOf(row)) : null;
});
