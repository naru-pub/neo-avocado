// 회원 관리 (adm/member_form.php): the owner sets a member's level (1–10),
// 성인, warnings, leaving and blocking days and note, and their community
// role and board groups, which are Naru roles (staff, group-<id>); 활동량
// 관리 saves the warnings alone. Deleting a member's record takes those
// roles too; deleting the member (member_delete.php) takes their data.
import {
  MEMBER_SELECT,
  TABLES,
  checked,
  conflict,
  invalid,
  memberData,
  rolesOfData,
  setRolesOf,
  writeRow,
} from "../../modules/admin.js";
import {
  amountOf,
  communitySettings,
  kstDay,
  one,
  ownerOnly,
} from "../../modules/access.js";
import {
  addHistory,
  nickTaken,
  nickValid,
  saveWallet,
  walletOf,
} from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export const save = ownerOnly(async function save(
  ctx: MutationCtx,
  {
    id,
    values,
    create = false,
  }: { id?: string; values?: Record<string, unknown>; create?: boolean } = {},
) {
  if (typeof id !== "string" || !id) invalid(ctx);
  const row = await one(ctx, `${MEMBER_SELECT} WHERE members.member = ?`, [id]);
  if (create ? row : !row) conflict(ctx);
  const roles = (await ctx.rolesOf([id]))[id] ?? [];
  // A new record starts from the role and groups the member already has.
  const record = await checked(ctx, "members", {
    id,
    values,
    current: { id, data: memberData(row, roles) },
  });
  await writeRow(ctx, TABLES.members, id, record.data);
  await setRolesOf(ctx, id, rolesOfData(record.data, roles));
  // 닉네임 and 출생년도 (member_form_update.php's mb_name, mb_birth): the
  // profile's, held to a member's own rules for a nickname; none before
  // the member joins.
  if (typeof row?.nick !== "string") {
    delete record.data.nick;
    delete record.data.birthYear;
  } else {
    const nick = String(record.data.nick ?? "").trim();
    if (nick !== row.nick) {
      if (!nickValid(nick))
        ctx.fail(
          "INVALID_REQUEST",
          "닉네임은 공백없이 한글, 영문, 숫자만 입력 가능합니다.",
          { reason: "invalid_nick" },
        );
      await nickTaken(ctx, nick, id);
      await ctx.sql`UPDATE profiles SET nick = ${nick} WHERE member = ${id}`;
    }
    await ctx.sql`UPDATE profiles SET birth_year = ${record.data.birthYear ?? null}
      WHERE member = ${id}`;
  }
  return { id, data: record.data };
});

export const remove = ownerOnly(async function remove(
  ctx: MutationCtx,
  { id }: { id?: string } = {},
) {
  if (typeof id !== "string" || !id) invalid(ctx);
  await ctx.sql`DELETE FROM members WHERE member = ${id}`;
  const roles = (await ctx.rolesOf([id]))[id] ?? [];
  await setRolesOf(ctx, id, rolesOfData({}, roles));
  return null;
});

/**
 * 회원 삭제 (adm/member_delete.php, lib/common.lib.php member_delete): the
 * member's nickname stays, kept so no one else takes it, and their record
 * says when they were deleted (mb_memo's "YYYYMMDD 삭제함") at level 1;
 * their 쪽지 either way, 관심로그, money history and balance, members-only
 * groups and staff role, and 게시판·그룹 관리자 go. Their posts, comments
 * and characters stay, as the original's do. Naru's account is the
 * member's own: the site cannot delete it, and from now on treats them as
 * a guest; banning them on Naru keeps them from signing in.
 */
export const deleteMember = ownerOnly(async function deleteMember(
  ctx: MutationCtx,
  { id }: { id?: string } = {},
) {
  if (typeof id !== "string" || !id) invalid(ctx);
  const profile = await one(ctx, "SELECT 1 FROM profiles WHERE member = ?", [
    id,
  ]);
  const record = await one<{ deleted_at: number | null }>(
    ctx,
    "SELECT deleted_at FROM members WHERE member = ?",
    [id],
  );
  if (!profile && !record)
    ctx.fail("NOT_FOUND", "회원자료가 존재하지 않습니다.", {
      reason: "document_not_found",
    });
  // 이미 삭제된 회원은 제외.
  if (record?.deleted_at) return { id, deleted: false };
  // The 추천인 포인트 their recommender got goes back, down to nothing.
  const recommended = await one<{
    recommender: string | null;
    nick: string | null;
  }>(
    ctx,
    `SELECT recommender, (SELECT nick FROM profiles WHERE profiles.member = members.member) AS nick
     FROM members WHERE member = ? AND recommender IS NOT NULL`,
    [id],
  );
  const points = recommended
    ? amountOf(await communitySettings(ctx), "recommendReward")
    : 0;
  if (points) {
    const before = (await walletOf(ctx, recommended.recommender)).balance;
    const taken = Math.min(points, before);
    if (taken) {
      await saveWallet(ctx, recommended.recommender, before - taken);
      await addHistory(ctx, {
        owner: recommended.recommender,
        kind: "recommend",
        at: ctx.now,
        delta: -taken,
        balance: before - taken,
        memo: `${recommended.nick ?? id}님의 회원자료 삭제로 인한 추천인 포인트 반환`,
      });
    }
  }
  const day = kstDay(ctx.now).replace(/-/g, "");
  await ctx.sql`INSERT INTO members (member, level, note, deleted_at) VALUES (${id}, 1, ${`${day} 삭제함`}, ${ctx.now})
    ON CONFLICT (member) DO UPDATE SET level = 1, deleted_at = excluded.deleted_at,
      note = ${`${day} 삭제함`} || CASE WHEN members.note = '' THEN '' ELSE char(10) || members.note END`;
  await ctx.sql`UPDATE profiles SET deleted_at = ${ctx.now}, main_character = NULL WHERE member = ${id}`;
  // Their money's history goes, as avo_point's rows do; what their
  // characters earned and bought stays with the characters.
  await ctx.sql`DELETE FROM history WHERE owner = ${id} AND delta IS NOT NULL AND character_id IS NULL`;
  await ctx.sql`DELETE FROM wallets WHERE member = ${id}`;
  await ctx.sql`DELETE FROM messages WHERE recipient = ${id}`;
  await ctx.sql`DELETE FROM messages WHERE sender = ${id}`;
  await ctx.sql`DELETE FROM favorites WHERE member = ${id}`;
  await ctx.sql`DELETE FROM drafts WHERE owner = ${id}`;
  await ctx.sql`UPDATE board_groups SET admin = NULL WHERE admin = ${id}`;
  await ctx.sql`UPDATE boards SET admin = NULL WHERE admin = ${id}`;
  const roles = (await ctx.rolesOf([id]))[id] ?? [];
  await setRolesOf(ctx, id, rolesOfData({}, roles));
  return { id, deleted: true };
});

/**
 * member_list_update.php's 선택수정 (`level`: the members' 권한) and
 * 선택탈퇴 (`leave`: their 탈퇴일, today, as member_leave.php writes it;
 * one who left already keeps their day), for up to 100 members at once.
 */
export const bulk = ownerOnly(async function bulk(
  ctx: MutationCtx,
  {
    ids,
    action,
    level,
  }: { ids?: string[]; action?: string; level?: number } = {},
) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== "string" || !id) ||
    !["level", "leave"].includes(action) ||
    (action === "level" &&
      (!Number.isInteger(level) || level < 1 || level > 10))
  )
    invalid(ctx);
  const list = JSON.stringify([...new Set(ids)]);
  const { changes } =
    action === "level"
      ? await ctx.sql`INSERT INTO members (member, level)
          SELECT value, ${level} FROM json_each(${list}) WHERE true
          ON CONFLICT (member) DO UPDATE SET level = excluded.level`
      : await ctx.sql`INSERT INTO members (member, left_on)
          SELECT value, ${kstDay(ctx.now)} FROM json_each(${list}) WHERE true
          ON CONFLICT (member) DO UPDATE SET left_on = coalesce(members.left_on, excluded.left_on)`;
  return { changed: changes };
});
