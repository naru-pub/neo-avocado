// 게시판 그룹 (adm/boardgroup_list.php): the owner's list, a page at a time, and one entry.
import { getRecord, listRecords } from "../../modules/admin.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = (ctx: QueryCtx, args: { after?: string | null } = {}) =>
  listRecords(ctx, "board_groups", args ?? {});

export const get = (ctx: QueryCtx, args: { id?: string } = {}) =>
  getRecord(ctx, "board_groups", args ?? {});
