// 설문조사 (adm/poll_list.php): the owner's list, a page at a time, and one entry.
import { getRecord, listRecords } from "../../modules/admin.js";
import { ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = ownerOnly(
  (ctx: QueryCtx, args: { after?: string | null; search?: string }) =>
    listRecords(ctx, "polls", args),
);

export const get = ownerOnly((ctx: QueryCtx, args: { id?: string }) =>
  getRecord(ctx, "polls", args),
);
