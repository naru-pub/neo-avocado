import { HISTORY } from "../../modules/shared.js";

export const readOnly = ["history"];

export async function history(ctx, { after = null, size = 20 } = {}) {
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 20 ||
    (after !== null && typeof after !== "string")
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  return {
    ...(await ctx.list(HISTORY, {
      filter: { owner: ctx.member.id },
      sort: [[{ metadata: "createdAt" }, "desc"]],
      size,
      after,
    })),
  };
}
