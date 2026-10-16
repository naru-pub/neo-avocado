// Publish as _naru/rules/community-board.js and enable it on logs/comments.
// Member levels, roles, boards and secret visibility come from the helpers the
// site functions use, so native reads and the posting function cannot drift.
import {
  PREFIX,
  author,
  boardOf,
  boardAllowed,
  communityAccess,
  logReadable,
  presentPost,
} from "../modules/shared.js";
import type {
  Data,
  PresentArgs,
  ReadArgs,
  ReadCtx,
  Where,
  WriteArgs,
} from "../modules/naru-types.js";
const LOGS = `${PREFIX}logs`;
const COMMENTS = `${PREFIX}comments`;
export async function readable(
  ctx: ReadCtx,
  { collection, operation, id, filter }: ReadArgs,
): Promise<Where> {
  // Visitors (ctx.member null, with world read) have the guest level 1.
  const actor = await communityAccess(ctx);
  if (collection === COMMENTS) {
    const logId =
      operation === "get"
        ? (await ctx.get(COMMENTS, id))?.data.logId
        : filter.logId;
    if (
      typeof logId !== "string" ||
      !(await logReadable(ctx, await ctx.get(LOGS, logId), actor))
    )
      return false;
    return { eq: ["logId", logId] };
  }
  if (collection !== LOGS) return false;
  const boardId =
    operation === "get"
      ? ((await ctx.get(LOGS, id))?.data.board ?? "default")
      : (filter.board ?? "default");
  if (typeof boardId !== "string") return false;
  const target = await boardOf(ctx, boardId);
  // Lists return complete documents, so listing must also permit body reads.
  if (
    !boardAllowed(target, actor, "read") ||
    (operation === "list" && !boardAllowed(target, actor, "list"))
  )
    return false;
  return {
    all: [
      { eq: ["board", boardId] },
      { ne: ["deleted", true] },
      actor.role === "moderator"
        ? true
        : ctx.member
          ? {
              any: [
                { ne: ["secret", true] },
                { eq: ["owner", ctx.member.id] },
                { eq: [{ metadata: "createdBy" }, ctx.member.id] },
              ],
            }
          : { ne: ["secret", true] },
    ],
  };
}
// What a reader may filter and sort on. Not `owner`: asking which posts a
// member wrote would find their 익명 ones; 로그내역 reads through posts:mine.
// `category` lists a board by 분류 (bbs/list.mmb.php:4-25's sca).
export const queryable = [
  "board",
  "number",
  "notice",
  "tags",
  "logId",
  "category",
];

/** 멤버공개 locked for visitors, 익명 without its author (presentPost). */
export async function present(
  ctx: ReadCtx,
  { document }: PresentArgs,
): Promise<Data> {
  const actor = await communityAccess(ctx);
  return presentPost(document, {
    member: ctx.member?.id ?? null,
    staff: actor.role === "moderator",
  });
}
const text = (value: unknown, max: number): boolean =>
  typeof value === "string" && value.length <= max;
const image = (value: unknown) =>
  value === null ||
  (typeof value === "string" &&
    value.length <= 2048 &&
    /^https?:\/\/[^\s]+$/i.test(value));
export async function canWrite(
  ctx: ReadCtx,
  { collection, before, after, operation }: WriteArgs,
): Promise<boolean> {
  if (!ctx.member || ![LOGS, COMMENTS].includes(collection)) return false;
  const actor = await communityAccess(ctx);
  const moderator = actor.role === "moderator";
  if (
    before &&
    (before.data.deleted || (author(before) !== ctx.member.id && !moderator))
  )
    return false;
  if (
    after &&
    (after.data.owner !== (before ? author(before) : ctx.member.id) ||
      (before && after.id !== before.id))
  )
    return false;
  if (collection === COMMENTS) {
    const logId = before?.data.logId ?? after?.data.logId;
    if (typeof logId !== "string" || (after && after.data.logId !== logId))
      return false;
    const log = await ctx.get(LOGS, logId);
    if (
      !(await logReadable(ctx, log, actor)) ||
      !boardAllowed(
        await boardOf(ctx, log.data.board ?? "default"),
        actor,
        "comment",
      )
    )
      return false;
    if (!after) return operation === "delete";
    return (
      // As the comments function's limit (mmb/write_comment.php's textarea).
      text(after.data.text, 2000) &&
      typeof after.data.dice === "boolean" &&
      (Boolean(after.data.text.trim()) || after.data.dice)
    );
  }
  const boardId = before?.data.board ?? after?.data.board;
  if (typeof boardId !== "string" || (after && after.data.board !== boardId))
    return false;
  const target = await boardOf(ctx, boardId);
  if (!boardAllowed(target, actor, "write")) return false;
  // Log deletion stays in a transactional function because it has child cleanup.
  if (!after) return false;
  const data = after.data;
  if (data.deleted !== undefined && data.deleted !== before?.data.deleted)
    return false;
  if (
    typeof data.secret !== "boolean" ||
    (target.data.secret === "required" && !data.secret) ||
    (target.data.secret === "off" && data.secret && !before?.data.secret)
  )
    return false;
  if (
    !text(data.title, 120) ||
    !text(data.category, 40) ||
    (data.category && !(target.data.categories ?? []).includes(data.category))
  )
    return false;
  if (!text(data.text, 2000) || !image(data.image)) return false;
  return (
    (target.data.kind !== "image" || Boolean(data.image)) &&
    (Boolean(data.image) || Boolean(data.text.trim()))
  );
}
