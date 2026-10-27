// 아이템·상점 (adm/item_list.php, shop_list.php): the owner's list, a page at
// a time, of one 아이템 분류 (it_category) or all, of one 아이템 기능
// (it_type: a use effect, or none) or all, its name or description holding
// a search (sfl, stx); one entry is admin/records'.

import { containing, ownerOnly } from "../../modules/access.js";
import {
  invalid,
  offsetOf,
  PAGE,
  pageOf,
  recordOf,
  selectOf,
  TABLES,
} from "../../modules/admin.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/** 아이템 분류: 일반, 개인, 출석 (adm/item_list.php's cate). */
const CATEGORIES = ["general", "personal", "attendance"];
/** 아이템 기능: the use effects, and "none" for items without one. */
const EFFECTS = ["restore", "draw", "create", "profile", "none"];

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  {
    after = null,
    category = "",
    effect = "",
    search = "",
  }: {
    after?: string | null;
    category?: string;
    effect?: string;
    search?: string;
  } = {},
) {
  if (
    (category !== "" && !CATEGORIES.includes(category)) ||
    (effect !== "" && !EFFECTS.includes(effect)) ||
    typeof search !== "string" ||
    search.length > 40
  )
    invalid(ctx);
  const t = TABLES.items;
  const offset = offsetOf(ctx, after);
  const term = search.trim();
  const { rows } = await ctx.sql(
    `${selectOf(t)} WHERE (? = '' OR category = ?)
       AND (? = '' OR coalesce(json_extract(effect, '$.type'), 'none') = ?)
       AND (? = '' OR name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR item_type LIKE ? ESCAPE '\\')
     ORDER BY id LIMIT ? OFFSET ?`,
    [
      category,
      category,
      effect,
      effect,
      term,
      containing(term),
      containing(term),
      containing(term),
      PAGE + 1,
      offset,
    ],
  );
  return pageOf(
    rows.map((row) => recordOf(t, row)),
    offset,
  );
});
