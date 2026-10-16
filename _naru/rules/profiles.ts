// Everyone may read nicknames, since posts show who wrote them; the rest of a
// profile (message and alert preferences) only members. A member edits their
// own nickname and preferences directly; joining, which makes the profile, is
// the community/membership site function's.
import { siteOpen } from "../modules/shared.js";
import type {
  Data,
  PresentArgs,
  ReadCtx,
  Where,
  WriteArgs,
} from "../modules/naru-types.js";

/** What members may filter on: nothing a visitor cannot already see matters. */
export const queryable = ["nick", "acceptMessages", "owner"];

export async function readable(ctx: ReadCtx): Promise<Where> {
  // A closed site (사이트공개 off) shows visitors nothing, nicknames included.
  if (!ctx.member && !(await siteOpen(ctx))) return false;
  return { ne: ["deleted", true] };
}

export function present(ctx: ReadCtx, { document }: PresentArgs): Data {
  if (!ctx.member) return { nick: document.data.nick };
  // 관심로그 is the member's own.
  if (ctx.member.id === document.id) return document.data;
  const { favorites, ...shown } = document.data;
  void favorites;
  return shown;
}

/** What a member may change on their own profile. */
const EDITABLE = ["nick", "acceptMessages", "commentAlerts"];

export function canWrite(
  ctx: ReadCtx,
  { operation, before, after }: WriteArgs,
): boolean {
  if (!ctx.member || operation !== "update") return false;
  if (before.id !== ctx.member.id || before.data.deleted) return false;
  const { nick, acceptMessages, commentAlerts } = after.data;
  if (
    typeof nick !== "string" ||
    !nick ||
    nick !== nick.trim() ||
    nick.length > 20 ||
    typeof acceptMessages !== "boolean" ||
    typeof commentAlerts !== "boolean"
  )
    return false;
  // Everything else (kept by site functions) stays as it was.
  const keys = new Set([
    ...Object.keys(before.data),
    ...Object.keys(after.data),
  ]);
  return [...keys].every(
    (key) =>
      EDITABLE.includes(key) ||
      JSON.stringify(before.data[key]) === JSON.stringify(after.data[key]),
  );
}
