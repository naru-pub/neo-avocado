// 팝업레이어 (adm/newwinlist.php): the owner saves an entry, checked as its form checks it
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
  ) => saveRecord(ctx, "popups", args),
);

export const remove = ownerOnly(
  async (ctx: MutationCtx, args: { id?: string }) => {
    const result = await removeRecord(ctx, "popups", args);
    return result;
  },
);
