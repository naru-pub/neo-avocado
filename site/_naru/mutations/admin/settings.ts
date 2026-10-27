// The owner's settings, one form each: 커뮤니티 설정, 디자인 and 프로필 기본
// 항목, checked as their forms check them (modules/admin-model.ts). A save
// that sends only some fields keeps the others.

import { invalid, ownerOnly } from "../../modules/access.js";
import { checked, settingsKeyOf, settingsRecord } from "../../modules/admin.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export const save = ownerOnly(async function save(
  ctx: MutationCtx,
  {
    section,
    values,
  }: { section?: string; values?: Record<string, unknown> } = {},
) {
  const key = settingsKeyOf(ctx, section);
  if (typeof section !== "string") return invalid(ctx);
  const current = await settingsRecord(ctx, section);
  const { id, data } = await checked(ctx, section, {
    id: current?.id ?? "",
    values,
    current,
  });
  await ctx.sql`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(data)})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
  return { id, data };
});
