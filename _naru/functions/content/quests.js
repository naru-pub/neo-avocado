import { PREFIX, failure, scheduled } from "../../modules/shared.js";

export const readOnly = ["quests"];

/** Scheduled image quests; the reference defines no claim/reward endpoint. */
export async function quests(ctx, { type = "", after = null } = {}) {
  if (!["", "daily", "weekly"].includes(type)) return failure("invalid_input");
  const page = await ctx.list(`${PREFIX}quests`, {
    size: 50,
    after,
    ...(type ? { filter: { type } } : {}),
  });
  return {
    ok: true,
    ...page,
    documents: page.documents.filter(
      (row) => !row.data.deleted && scheduled(row.data, ctx.now),
    ),
  };
}
