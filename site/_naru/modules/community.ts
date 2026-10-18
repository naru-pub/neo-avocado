// What every post and comment write shares: who is writing (a member, the
// site's owner, or a guest with a name and password), the row they are
// changing, and whether they may. The community/posts and
// community/comments mutations start from here.
import type { Access } from "./access.js";
import { accessOf, boardOf, commentRow, isStaff, postRow } from "./boards.js";
import type { CommentRow, PostRow } from "./boards.js";
import type { GuestCredentials, MutationCtx } from "./naru-types.js";
import { invalid } from "./access.js";

/** A guest writer: the name they post under and their password's hash. */
export interface GuestWriter {
  name: string;
  /** A new post's or comment's: the hash its row keeps. */
  hash: string | null;
}

/** What the writer asks to change, and how they prove it theirs. */
export interface StartWriteOptions {
  id?: unknown;
  guest?: GuestCredentials | null;
  revision?: string | null;
}

const guestPassword = (ctx: MutationCtx) =>
  ctx.fail("ACCESS_DENIED", "비밀번호를 확인해 주세요. (4~64자)", {
    reason: "guest_password",
  });

/** The board a post or comment is on. */
async function boardIdOf(
  ctx: MutationCtx,
  kind: "post" | "comment",
  row: PostRow | CommentRow,
): Promise<string | null> {
  if (kind === "post") return (row as PostRow).board;
  return (await postRow(ctx, (row as CommentRow).post_id))?.board ?? null;
}

/**
 * Checks a write to a post or comment and returns the writer's access, the
 * row as it is now (null for a new one) and, for a guest, their name. A
 * member changes their own, and a moderator anyone's; the site's owner
 * changes any without a password. A board's 게시판 관리자 and its group's
 * 그룹 관리자 are its moderators. A guest proves a post is theirs with its
 * password (bbs/password_check.php), checked against the hash its row keeps
 * (ten wrong tries an hour for each, by `post:<id>` or `comment:<id>`).
 */
export async function startWrite<T extends "post" | "comment">(
  ctx: MutationCtx,
  kind: T,
  { id = null, guest: given = null, revision = null }: StartWriteOptions,
): Promise<{
  access: Access;
  previous: (T extends "post" ? PostRow : CommentRow) | null;
  guest: GuestWriter | null;
}> {
  if (id !== null && typeof id !== "string" && typeof id !== "number")
    invalid(ctx);
  const access = await accessOf(ctx);
  const previous = (
    id === null
      ? null
      : kind === "post"
        ? await postRow(ctx, id)
        : await commentRow(ctx, id)
  ) as (T extends "post" ? PostRow : CommentRow) | null;
  if (id !== null && !previous)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  let guest: GuestWriter | null = null;
  if (ctx.owner) {
    // The site owner needs no password or authorship.
  } else if (!ctx.member) {
    const password = given?.password;
    if (
      typeof password !== "string" ||
      password.length < 4 ||
      password.length > 64
    )
      guestPassword(ctx);
    if (previous) {
      if (
        !previous.guest_hash ||
        !(await ctx.passwords.verify(
          password,
          previous.guest_hash,
          `${kind}:${previous.id}`,
        ))
      )
        guestPassword(ctx);
      guest = { name: previous.guest_name ?? "", hash: null };
    } else {
      const name = given?.name;
      if (typeof name !== "string" || !name.trim() || name.length > 20)
        invalid(ctx);
      guest = { name: name.trim(), hash: await ctx.passwords.hash(password) };
    }
  } else if (
    previous &&
    previous.owner !== ctx.member.id &&
    !isStaff(access, await boardOf(ctx, await boardIdOf(ctx, kind, previous)))
  )
    ctx.fail("ACCESS_DENIED", "직접 쓴 것만 고치거나 지울 수 있습니다.", {
      reason: "not_owned",
    });
  if (revision && previous && String(previous.version) !== revision)
    ctx.fail(
      "CONFLICT",
      "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
      { reason: "conflict" },
    );
  return { access, previous, guest };
}
