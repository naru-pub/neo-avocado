// 설문조사 (adm/poll_list.php): the owner saves an entry, checked as its form checks it
// (modules/admin-model.ts), and deletes one.
import { removeRecord, saveRecord } from "../../modules/admin.js";
import { ownerOnly } from "../../modules/access.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export const save = ownerOnly(
  (
    ctx: MutationCtx,
    args: {
      id?: string;
      values?: Record<string, unknown>;
      create?: boolean;
    },
  ) => saveRecord(ctx, "polls", args),
);

export const remove = ownerOnly(
  async (ctx: MutationCtx, args: { id?: string }) => {
    const result = await removeRecord(ctx, "polls", args);
    // poll_delete.php: its votes and 기타의견 go with it.
    await ctx.sql`DELETE FROM poll_votes WHERE poll_id = ${args?.id ?? ""}`;
    await ctx.sql`DELETE FROM poll_comments WHERE poll_id = ${args?.id ?? ""}`;
    return result;
  },
);
