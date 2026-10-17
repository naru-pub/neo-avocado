// 캐릭터 경험치·능력치·타이틀: each character's official record, a page at a
// time in the order characters were made, and one.
import {
  PAGE,
  STATE_SELECT,
  offsetOf,
  pageOf,
  stateOf,
} from "../../modules/admin.js";
import { one, ownerOnly } from "../../modules/access.js";
import { characterKey } from "../../modules/characters.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  { after = null }: { after?: string | null } = {},
) {
  const offset = offsetOf(ctx, after);
  const { rows } = await ctx.sql(
    `${STATE_SELECT} ORDER BY characters.id LIMIT ? OFFSET ?`,
    [PAGE + 1, offset],
  );
  return pageOf(rows.map(stateOf), offset);
});

export const get = ownerOnly(async function get(
  ctx: QueryCtx,
  { id }: { id?: string } = {},
) {
  const key = characterKey(id);
  if (key === null) return null;
  const row = await one(ctx, `${STATE_SELECT} WHERE characters.id = ?`, [key]);
  return row ? stateOf(row) : null;
});
