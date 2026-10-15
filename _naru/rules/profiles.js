// Everyone may read nicknames, since posts show who wrote them; the rest of a
// profile (message and alert preferences) only members. A member edits their
// own nickname and preferences directly; joining, which makes the profile, is
// the community/membership site function's.

/** What members may filter on: nothing a visitor cannot already see matters. */
export const queryable = ["nick", "acceptMessages", "owner"];

export function readable() {
  return { ne: ["deleted", true] };
}

export function present(ctx, { document }) {
  return ctx.member ? document.data : { nick: document.data.nick };
}

/** What a member may change on their own profile. */
const EDITABLE = ["nick", "acceptMessages", "commentAlerts"];

export function canWrite(ctx, { operation, before, after }) {
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

// Until Naru reads `readable`: rules exported `scope` before 1.1.0 named it so.
export const scope = readable;
