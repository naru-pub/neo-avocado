// bbs/db_table.optimize.php: what the original does once a day as its
// super admin visits, here as the owner opens the admin. Each part runs only
// where the owner set its days in 커뮤니티 설정 (0, as here they start, keeps
// everything): 접속자로그 삭제 (cf_visit_del) deletes the visit days before
// then, 쪽지 삭제 (cf_memo_del) the 쪽지 sent before then, and 회원탈퇴후
// 삭제일 (cf_leave_day) deletes, as 회원 삭제 does, the members who left that
// long ago. Members go a few a call, a deletion being a dozen statements;
// the page calls again while some remain.
import {
  communitySettings,
  kstDay,
  one,
  ownerOnly,
} from "../../modules/access.js";
import type { MutationCtx } from "../../modules/naru-types.js";
import { deleteMember } from "./members.js";

/** Members one call deletes. */
const MEMBERS_A_CALL = 4;
const DAY = 86_400_000;

const daysOf = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : 0;

export const run = ownerOnly(async function run(ctx: MutationCtx) {
  const today = kstDay(ctx.now);
  const done = await one<{ value: string }>(
    ctx,
    "SELECT value FROM settings WHERE key = 'maintenance'",
  );
  // 실행일 비교: once a Korean day, but while members remain to delete.
  const state = done ? JSON.parse(done.value) : {};
  if (state.day === today && !state.pending)
    return { ran: false, visits: 0, messages: 0, members: 0, remaining: 0 };
  const settings = await communitySettings(ctx);
  const visitDays = daysOf(settings.visitDays);
  const memoDays = daysOf(settings.memoDays);
  const leaveDays = daysOf(settings.leaveDays);
  let visits = 0;
  let messages = 0;
  if (!state.pending) {
    if (visitDays)
      visits = (
        await ctx.sql`DELETE FROM visits WHERE day < ${kstDay(ctx.now - visitDays * DAY)}`
      ).changes;
    if (memoDays)
      messages = (
        await ctx.sql`DELETE FROM messages WHERE sent_at < ${Date.parse(`${kstDay(ctx.now - memoDays * DAY)}T00:00:00+09:00`)}`
      ).changes;
  }
  let members = 0;
  let remaining = 0;
  if (leaveDays) {
    // 탈퇴일 more than that many days ago, not deleted already.
    const before = kstDay(ctx.now - leaveDays * DAY);
    const { rows } = await ctx.sql<{ member: string }>`SELECT members.member
      FROM members
      WHERE members.left_on IS NOT NULL AND members.left_on < ${before}
        AND members.deleted_at IS NULL
      ORDER BY members.left_on LIMIT ${MEMBERS_A_CALL + 1}`;
    for (const row of rows.slice(0, MEMBERS_A_CALL)) {
      const result = await deleteMember(ctx, { id: row.member });
      if (result?.deleted) members += 1;
    }
    remaining = Math.max(0, rows.length - MEMBERS_A_CALL);
  }
  await ctx.sql`INSERT INTO settings (key, value) VALUES ('maintenance', ${JSON.stringify({ day: today, pending: remaining > 0 })})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
  return { ran: true, visits, messages, members, remaining };
});
