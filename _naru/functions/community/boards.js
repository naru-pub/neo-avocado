// Board tools beyond posting: comment counts for a page of logs, and the
// moderator's notices and moves (GnuBoard's bo_notice and bbs/move.php).
import {
  PREFIX,
  communityAccess,
  boardOf,
  boardAllowed,
  logReadable,
  nextNumber,
} from "../../modules/shared.js";

export const readOnly = ["commentCounts"];
export const visitors = ["commentCounts"];

const LOGS = `${PREFIX}logs`;
const COMMENTS = `${PREFIX}comments`;
const ID = /^[a-zA-Z0-9_-]{1,64}$/;

/** How many comments each readable log has; unreadable logs are left out. */
export async function commentCounts(ctx, { ids } = {}) {
  if (
    !Array.isArray(ids) ||
    ids.length > 20 ||
    ids.some((id) => typeof id !== "string" || !ID.test(id))
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const access = await communityAccess(ctx);
  const logs = await ctx.getMany(LOGS, ids);
  const counts = {};
  for (const log of logs)
    if (log && (await logReadable(ctx, log, access)))
      counts[log.id] = await ctx.count(COMMENTS, { filter: { logId: log.id } });
  return { counts };
}

/**
 * Pins a log as a notice or moves it to another board. Moderators may move
 * only to boards they could post on; the owner (admin.call) may do either.
 */
export async function moderatePost(ctx, { id, notice, board } = {}) {
  const access = ctx.owner ? null : await communityAccess(ctx);
  if (!ctx.owner && access.role !== "moderator")
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  const log = typeof id === "string" ? await ctx.get(LOGS, id) : null;
  if (!log || log.data.deleted)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  const data = { ...log.data };
  if (notice !== undefined) {
    if (typeof notice !== "boolean")
      ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
        reason: "invalid_input",
      });
    data.notice = notice;
  }
  if (board !== undefined && board !== (log.data.board ?? "default")) {
    const target = typeof board === "string" ? await boardOf(ctx, board) : null;
    if (!target || (access && !boardAllowed(target, access, "write")))
      ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
        reason: "access_denied",
      });
    if (target.data.kind === "image" && !data.image)
      ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
        reason: "invalid_input",
      });
    if (
      data.category &&
      !(target.data.categories ?? []).includes(data.category)
    )
      data.category = "";
    data.board = board;
    data.number = await nextNumber(ctx, board);
  }
  const saved = await ctx.set(LOGS, id, data, {
    condition: { revision: log.revision },
  });
  return { document: saved };
}
