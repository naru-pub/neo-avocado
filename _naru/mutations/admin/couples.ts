// 커플 (adm/couple_list.php): the owner saves an entry, checked as its form checks it
// (modules/admin-model.ts), and deletes one.
import { removeRecord, saveRecord } from "../../modules/admin.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export const save = (
  ctx: MutationCtx,
  args: {
    id?: string;
    values?: Record<string, unknown>;
    create?: boolean;
  } = {},
) => saveRecord(ctx, "couples", args ?? {});

export const remove = (ctx: MutationCtx, args: { id?: string } = {}) =>
  removeRecord(ctx, "couples", args ?? {});
