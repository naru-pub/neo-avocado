// Members' nicknames, as posts and lists show who wrote them, and the
// member's own profile. Visitors read nicknames only while the site is open
// (사이트공개); a deleted profile shows none.
import { siteOpen, signedIn } from "../../modules/access.js";
import { profileOf } from "../../modules/members.js";
import type { QueryCtx } from "../../modules/naru-types.js";

const MAX_IDS = 100;

/** Whether the caller may read nicknames at all. */
const readable = async (ctx: QueryCtx) =>
  Boolean(ctx.member) || ctx.owner || (await siteOpen(ctx));

/** The nicknames of up to 100 members, by member ID; the unknown are left out. */
export async function nicks(ctx: QueryCtx, { ids }: { ids?: string[] } = {}) {
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_IDS ||
    ids.some((id) => typeof id !== "string")
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const wanted = [...new Set(ids)];
  if (!wanted.length || !(await readable(ctx))) return { nicks: {} };
  const { rows } = await ctx.sql<{ member: string; nick: string }>(
    `SELECT member, nick FROM profiles WHERE deleted_at IS NULL AND member IN (${wanted.map(() => "?").join(", ")})`,
    wanted,
  );
  return {
    nicks: Object.fromEntries(rows.map((row) => [row.member, row.nick])),
  };
}

/** The members with these nicknames (up to 20), and whether they take 쪽지. */
export async function find(
  ctx: QueryCtx,
  { nicks }: { nicks?: string[] } = {},
) {
  if (
    !Array.isArray(nicks) ||
    nicks.length > 20 ||
    nicks.some((nick) => typeof nick !== "string" || nick.length > 20)
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const wanted = [...new Set(nicks)];
  if (!wanted.length || !(await readable(ctx))) return { profiles: [] };
  const { rows } = await ctx.sql<{
    member: string;
    nick: string;
    accept_messages: number;
  }>(
    `SELECT member, nick, accept_messages FROM profiles WHERE deleted_at IS NULL AND nick IN (${wanted.map(() => "?").join(", ")})`,
    wanted,
  );
  return {
    profiles: rows.map((row) => ({
      id: row.member,
      nick: row.nick,
      acceptMessages: row.accept_messages !== 0,
    })),
  };
}

/** The caller's own profile, with their 관심 posts; null before they join. */
export async function own(ctx: QueryCtx) {
  return {
    profile: await profileOf(ctx, signedIn(ctx), { favorites: true }),
  };
}
