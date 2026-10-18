// 현재접속자 (bbs/current_connect.php): who is here, and where. Members
// only: a place can name a members-only board.
import type { QueryCtx } from "../../modules/naru-types.js";

/** How long a member counts as here after their last page. */
const HERE_FOR = 10 * 60 * 1000;

/** The members seen in the last ten minutes, most recent first. */
export async function online(ctx: QueryCtx) {
  if (!ctx.member && !ctx.owner)
    ctx.fail("AUTH_REQUIRED", "로그인해 주세요.", { reason: "sign_in" });
  const { rows } = await ctx.sql<{ nick: string; place: string; at: number }>`
    SELECT profiles.nick, presence.place, presence.at
    FROM presence JOIN profiles ON profiles.member = presence.member
    WHERE presence.at >= ${ctx.now - HERE_FOR}
    ORDER BY presence.at DESC LIMIT 100`;
  return {
    members: rows.map((row) => ({
      nick: row.nick,
      where: row.place,
      at: row.at,
    })),
  };
}
