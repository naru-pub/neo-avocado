// 전체 활동·구매 기록: every member's history, newest first, a page at a
// time; with `actor`, the entries one kind of actor made (the grants'
// log). Searched as adm/point_list.php, exp_list.php and order_list.php
// search theirs: `kind` (money, exp, or buy for 구매기록) and `field`
// (nick, character, item or memo) holding `text`. Each entry names its
// member and character.
import { invalid } from "../../modules/admin.js";
import { historyOfRow, type HistoryRow } from "../../modules/members.js";
import { containing, ownerOnly } from "../../modules/access.js";
import type { QueryCtx, SqlValue } from "../../modules/naru-types.js";

const KINDS = {
  money: "history.delta IS NOT NULL",
  exp: "history.exp_delta IS NOT NULL",
  buy: "history.kind = 'buy'",
};
const FIELDS = {
  nick: "history.owner IN (SELECT member FROM profiles WHERE nick LIKE ? ESCAPE '\\' LIMIT 100)",
  character:
    "history.character_id IN (SELECT id FROM characters WHERE name LIKE ? ESCAPE '\\' LIMIT 100)",
  item: "history.item_id IN (SELECT id FROM items WHERE name LIKE ? ESCAPE '\\' LIMIT 100)",
  memo: "history.memo LIKE ? ESCAPE '\\'",
};

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  {
    actor = null,
    kind = "",
    field = "nick",
    text = "",
    size = 50,
    after = null,
  }: {
    actor?: string | null;
    kind?: string;
    field?: string;
    text?: string;
    size?: number;
    after?: string | null;
  } = {},
) {
  if (
    (actor !== null && typeof actor !== "string") ||
    (kind !== "" && !Object.hasOwn(KINDS, kind)) ||
    !Object.hasOwn(FIELDS, field) ||
    typeof text !== "string" ||
    text.length > 40 ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 100 ||
    (after !== null && typeof after !== "string")
  )
    invalid(ctx);
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  if (actor !== null) {
    clauses.push("history.actor = ?");
    values.push(actor);
  }
  if (kind) clauses.push(KINDS[kind]);
  if (text.trim()) {
    clauses.push(FIELDS[field]);
    values.push(containing(text.trim()));
  }
  if (after !== null) {
    const cursor = Number(after);
    clauses.push("history.id < ?");
    values.push(Number.isSafeInteger(cursor) ? cursor : 0);
  }
  const { rows } = await ctx.sql<
    HistoryRow & { owner_nick: string | null; character_name: string | null }
  >(
    `SELECT history.*, profiles.nick AS owner_nick,
       coalesce(characters.name, history.character_name) AS character_name
     FROM history
     LEFT JOIN profiles ON profiles.member = history.owner
     LEFT JOIN characters ON characters.id = history.character_id
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY history.id DESC LIMIT ?`,
    [...values, size + 1],
  );
  const documents = rows.slice(0, size).map((row) => ({
    ...historyOfRow(row),
    ownerNick: row.owner_nick,
    characterName: row.character_name,
  }));
  return {
    documents,
    nextCursor: rows.length > size ? documents.at(-1).id : null,
  };
});
