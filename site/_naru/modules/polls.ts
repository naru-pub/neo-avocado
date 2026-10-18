// 설문조사 (poll.skin.php, poll_result.php): the newest poll in use, its
// answers and counts, whether the reader voted and may vote, and its
// 기타의견 with their writers' nicknames.
import { communityAccess, siteOpen } from "./access.js";
import type { QueryCtx } from "./naru-types.js";

export async function latestPoll(ctx: QueryCtx) {
  if (!ctx.member && !ctx.owner && !(await siteOpen(ctx)))
    return { poll: null };
  const { rows } = await ctx.sql<{
    id: string;
    subject: string;
    options: string;
    level: number;
    point: number;
    etc: string;
  }>`SELECT id, subject, options, level, point, etc FROM polls
    WHERE enabled != 0 ORDER BY created_at DESC, id DESC LIMIT 1`;
  const poll = rows[0];
  if (!poll) return { poll: null };
  const access = await communityAccess(ctx);
  const answers = poll.options.split("\n").filter(Boolean).slice(0, 9);
  const counts = answers.map(() => 0);
  for (const row of (
    await ctx.sql<{ choice: number; n: number }>`SELECT choice, count(*) AS n
      FROM poll_votes WHERE poll_id = ${poll.id} GROUP BY choice`
  ).rows)
    if (row.choice >= 1 && row.choice <= counts.length)
      counts[row.choice - 1] = row.n;
  const voted = ctx.member
    ? ((
        await ctx.sql<{ choice: number }>`SELECT choice FROM poll_votes
          WHERE poll_id = ${poll.id} AND member = ${ctx.member.id}`
      ).rows[0]?.choice ?? null)
    : null;
  const comments = poll.etc
    ? (
        await ctx.sql<{
          id: number;
          member: string;
          nick: string | null;
          idea: string;
          created_at: number;
        }>`SELECT poll_comments.id, poll_comments.member, profiles.nick,
            poll_comments.idea, poll_comments.created_at
          FROM poll_comments LEFT JOIN profiles ON profiles.member = poll_comments.member
          WHERE poll_comments.poll_id = ${poll.id}
          ORDER BY poll_comments.id DESC LIMIT 50`
      ).rows.map((row) => ({
        id: String(row.id),
        nick: row.nick ?? "",
        idea: row.idea,
        at: row.created_at,
        mine: row.member === ctx.member?.id,
      }))
    : [];
  return {
    poll: {
      id: poll.id,
      subject: poll.subject,
      answers,
      counts,
      level: poll.level,
      point: poll.point,
      etc: poll.etc,
      voted,
      // poll_update.php:8: members at po_level and above; a guest, never.
      canVote: Boolean(ctx.member) && access.level >= poll.level,
      comments,
    },
  };
}
