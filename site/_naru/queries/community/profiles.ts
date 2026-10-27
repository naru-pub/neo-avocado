// Members' nicknames, as posts and lists show who wrote them, and the
// member's own profile. Visitors read nicknames only while the site is open
// (사이트공개); a deleted profile shows none.
import {
  containing,
  invalid,
  signedIn,
  siteOpen,
} from "../../modules/access.js";
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
    invalid(ctx);
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
    invalid(ctx);
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

/**
 * Names that hold `text`, as a member types one (ajax/_search_member.php and
 * _search_character.php, members only): `member`, nicknames with their main
 * character; `character`, approved characters with their owner's nickname.
 * Twenty at most, by name.
 */
export async function suggest(
  ctx: QueryCtx,
  { kind, text }: { kind?: string; text?: string } = {},
) {
  signedIn(ctx);
  if (
    (kind !== "member" && kind !== "character") ||
    typeof text !== "string" ||
    text.length > 40
  )
    invalid(ctx);
  const term = text.trim();
  if (!term) return { names: [] };
  if (kind === "member") {
    const { rows } = await ctx.sql<{ nick: string; character: string | null }>(
      `SELECT profiles.nick, characters.name AS character
       FROM profiles LEFT JOIN characters
         ON characters.id = profiles.main_character
         AND characters.state = 'approved'
       WHERE profiles.deleted_at IS NULL AND profiles.nick LIKE ? ESCAPE '\\'
       ORDER BY profiles.nick LIMIT 20`,
      [containing(term)],
    );
    return {
      names: rows.map((row) => ({ name: row.nick, detail: row.character })),
    };
  }
  const { rows } = await ctx.sql<{ name: string; nick: string | null }>(
    `SELECT characters.name, profiles.nick
     FROM characters LEFT JOIN profiles ON profiles.member = characters.owner
     WHERE characters.state = 'approved' AND characters.name LIKE ? ESCAPE '\\'
     ORDER BY characters.name LIMIT 20`,
    [containing(term)],
  );
  return { names: rows.map((row) => ({ name: row.name, detail: row.nick })) };
}
