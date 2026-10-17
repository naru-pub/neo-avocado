// 아이템·상점 (adm/item_list.php, shop_list.php): the owner's list, a page at
// a time, of one 아이템 분류 (it_category) or all, and one entry.
import {
  PAGE,
  TABLES,
  getRecord,
  invalid,
  offsetOf,
  pageOf,
  recordOf,
  selectOf,
} from "../../modules/admin.js";
import { ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/** 아이템 분류: 일반, 개인, 출석 (adm/item_list.php's cate). */
const CATEGORIES = ["general", "personal", "attendance"];

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  {
    after = null,
    category = "",
  }: { after?: string | null; category?: string } = {},
) {
  if (category !== "" && !CATEGORIES.includes(category)) invalid(ctx);
  const t = TABLES.items;
  const offset = offsetOf(ctx, after);
  const { rows } = await ctx.sql(
    `${selectOf(t)} WHERE ? = '' OR category = ? ORDER BY id LIMIT ? OFFSET ?`,
    [category, category, PAGE + 1, offset],
  );
  return pageOf(
    rows.map((row) => recordOf(t, row)),
    offset,
  );
});

export const get = ownerOnly((ctx: QueryCtx, args: { id?: string }) =>
  getRecord(ctx, "items", args),
);
