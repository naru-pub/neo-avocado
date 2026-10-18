// 팝업레이어 (adm/newwinlist.php): the owner's list, a page at a time, and one entry.
import { getRecord, listRecords } from "../../modules/admin.js";
import { ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = ownerOnly(
  (ctx: QueryCtx, args: { after?: string | null; search?: string }) =>
    listRecords(ctx, "popups", args),
);

export const get = ownerOnly((ctx: QueryCtx, args: { id?: string }) =>
  getRecord(ctx, "popups", args),
);
