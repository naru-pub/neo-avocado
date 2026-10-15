// Everyone may read nicknames, since posts show who wrote them; the rest of a
// profile (message and alert preferences) only members. Profiles are written
// by the community/membership site function.

/** What members may filter on: nothing a visitor cannot already see matters. */
export const queryable = ["nick", "acceptMessages", "owner"];

export function scope() {
  return { ne: ["deleted", true] };
}

export function present(ctx, { document }) {
  return ctx.member ? document.data : { nick: document.data.nick };
}

export function canWrite() {
  return false;
}
