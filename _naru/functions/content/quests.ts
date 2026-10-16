import { PREFIX, scheduled } from "../../modules/shared.js";
import type { Ctx } from "../../modules/naru-types.js";

export const readOnly = ["quests"];

/** Scheduled image quests; the reference defines no claim/reward endpoint. */
export async function quests(
  ctx: Ctx,
  {
    type = "",
    after = null,
  }: { type?: "" | "daily" | "weekly"; after?: string | null } = {},
) {
  if (!["", "daily", "weekly"].includes(type))
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const page = await ctx.list(`${PREFIX}quests`, {
    size: 50,
    after,
    ...(type ? { filter: { type } } : {}),
  });
  return {
    ...page,
    documents: page.documents.filter(
      (row) => !row.data.deleted && scheduled(row.data, ctx.now),
    ),
  };
}
