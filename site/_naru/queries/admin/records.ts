// Every admin section's plain list and entry (modules/admin-calls.ts's
// RECORD_CALLS): `{ section, ... }`, for the owner only.
import { getRecord, listRecords, recordSection } from "../../modules/admin.js";
import { ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = ownerOnly(
  (
    ctx: QueryCtx,
    {
      section,
      ...args
    }: { section?: string; after?: string | null; search?: string } = {},
  ) => listRecords(ctx, recordSection(ctx, section, "list"), args),
);

export const get = ownerOnly(
  (
    ctx: QueryCtx,
    { section, ...args }: { section?: string; id?: string } = {},
  ) => getRecord(ctx, recordSection(ctx, section, "get"), args),
);
