import { HISTORY, failure } from "../../modules/shared.js";

export function history(ctx, { after = null, size = 20 } = {}) {
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 20 ||
    (after !== null && typeof after !== "string")
  )
    return failure("invalid_input");
  return {
    ok: true,
    ...ctx.list(HISTORY, {
      filter: { owner: ctx.member.id },
      sort: [[{ metadata: "createdAt" }, "desc"]],
      size,
      after,
    }),
  };
}
