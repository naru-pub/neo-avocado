// 전체 활동·구매 기록: every member's history, newest first, a page at a
// time; with `actor`, the entries one kind of actor made (the grants'
// log, adm/point_list.php).
import { invalid } from "../../modules/admin.js";
import { historyPage } from "../../modules/members.js";
import { ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  {
    actor = null,
    size = 50,
    after = null,
  }: { actor?: string | null; size?: number; after?: string | null } = {},
) {
  if (
    (actor !== null && typeof actor !== "string") ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 100
  )
    invalid(ctx);
  return await historyPage(ctx, actor === null ? {} : { actor }, {
    size,
    after,
  });
});
