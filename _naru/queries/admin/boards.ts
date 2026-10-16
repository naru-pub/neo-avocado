// 게시판 (adm/board_list.php, board_form.php): the owner's list, a page at a time, and one entry.
import { getRecord, listRecords } from "../../modules/admin.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = (ctx: QueryCtx, args: { after?: string | null } = {}) =>
  listRecords(ctx, "boards", args ?? {});

export const get = (ctx: QueryCtx, args: { id?: string } = {}) =>
  getRecord(ctx, "boards", args ?? {});
