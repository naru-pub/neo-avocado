import { PREFIX, failure } from "../../modules/shared.js";

/** Scheduled image quests; the reference defines no claim/reward endpoint. */
export async function quests(ctx, { type = "", after = null } = {}) {
  if (!["", "daily", "weekly"].includes(type)) return failure("invalid_input");
  const page = await ctx.list(`${PREFIX}quests`, {
    size: 50,
    after,
    ...(type ? { filter: { type } } : {}),
  });
  const date = (value) => {
    if (!value) return null;
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)
    )
      return NaN;
    const stamp = Date.parse(`${value}+09:00`);
    return Number.isFinite(stamp) &&
      new Date(stamp + 9 * 3600000).toISOString().slice(0, value.length) ===
        value
      ? stamp
      : NaN;
  };
  return {
    ok: true,
    ...page,
    documents: page.documents.filter((row) => {
      const start = date(row.data.startsAt),
        end = date(row.data.endsAt);
      return (
        !row.data.deleted &&
        (!row.data.startsAt || (Number.isFinite(start) && ctx.now >= start)) &&
        (!row.data.endsAt || (Number.isFinite(end) && ctx.now < end))
      );
    }),
  };
}
