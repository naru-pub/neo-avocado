import { HISTORY } from "../../modules/shared.js";

export const readOnly = ["history"];

/**
 * The member's own history, newest first: purchases, gifts, crafting and the
 * owner's adjustments, or only one `kind` of it (`exp`: experience changes).
 */
export async function history(
  ctx,
  { after = null, size = 20, kind = null } = {},
) {
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 20 ||
    (after !== null && typeof after !== "string") ||
    (kind !== null && (typeof kind !== "string" || kind.length > 20))
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  return {
    ...(await ctx.list(HISTORY, {
      filter: { owner: ctx.member.id, ...(kind ? { kind } : {}) },
      sort: [[{ metadata: "createdAt" }, "desc"]],
      size,
      after,
    })),
  };
}
