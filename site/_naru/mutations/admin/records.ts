// Every admin section's plain save and delete (modules/admin-calls.ts's
// RECORD_CALLS): `{ section, ... }`, checked as its form checks it
// (modules/admin-model.ts), for the owner only.
import {
  recordSection,
  removeRecord,
  saveRecord,
} from "../../modules/admin.js";
import { ownerOnly } from "../../modules/access.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export const save = ownerOnly(
  (
    ctx: MutationCtx,
    {
      section,
      ...args
    }: {
      section?: string;
      id?: string;
      values?: Record<string, unknown>;
      create?: boolean;
    } = {},
  ) => saveRecord(ctx, recordSection(ctx, section, "save"), args),
);

export const remove = ownerOnly(
  (
    ctx: MutationCtx,
    { section, ...args }: { section?: string; id?: string } = {},
  ) => removeRecord(ctx, recordSection(ctx, section, "remove"), args),
);
