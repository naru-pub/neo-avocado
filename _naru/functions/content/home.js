// The first screen in one call: across the Pacific every request costs
// a round trip, so the site frame, the member's standing, the boards and the
// first page of logs (with authors and comment counts) come back together.
import { PREFIX, PROFILES, failure } from "../../modules/shared.js";
import { site } from "./site.js";
import { membership } from "../community/membership.js";
import { messageStatus } from "../community/messages.js";
import { communityRead } from "../community/data.js";
import { commentCounts } from "../community/boards.js";

export const readOnly = ["home"];
export const visitors = ["home"];

const LOG_SORT = [
  ["notice", "desc"],
  [{ metadata: "createdAt" }, "desc"],
];

const read = async (ctx, collection, options) => {
  const result = await communityRead(ctx, {
    collection: `${PREFIX}${collection}`,
    operation: "list",
    options,
  });
  if (!result.ok) throw Object.assign(new Error(result.reason), { result });
  return result;
};

export async function home(ctx, { board = null } = {}) {
  if (board !== null && (typeof board !== "string" || board.length > 64))
    return failure("invalid_input");
  try {
    const { ok, ...frame } = await site(ctx);
    const standing = ctx.member ? await membership(ctx) : null;
    const answer = {
      ok: true,
      site: frame,
      membership: standing && {
        role: standing.role,
        level: standing.level,
        profile: standing.profile,
      },
      notice: null,
      boards: [],
      logs: null,
      nicks: {},
      counts: {},
    };
    // A member without a profile sees the join form, not the boards.
    if (standing && !standing.profile) return answer;
    if (standing) {
      const { ok, ...notice } = await messageStatus(ctx);
      answer.notice = notice;
    }
    let after = null;
    do {
      const page = await read(ctx, "boards", { size: 100, after });
      answer.boards.push(...page.documents);
      after = page.nextCursor;
    } while (after);
    const selected =
      answer.boards.find((row) => row.id === board)?.id ??
      answer.boards[0]?.id ??
      (standing ? "default" : null);
    if (!selected) return answer;
    const page = await read(ctx, "logs", {
      filter: { board: selected },
      sort: LOG_SORT,
      size: 10,
    });
    answer.logs = {
      board: selected,
      documents: page.documents,
      nextCursor: page.nextCursor,
    };
    const authors = [
      ...new Set(page.documents.map((row) => row.createdBy ?? row.data.owner)),
    ].filter(Boolean);
    const profiles = authors.length ? await ctx.getMany(PROFILES, authors) : [];
    authors.forEach((id, index) => {
      const profile = profiles[index];
      answer.nicks[id] =
        profile && !profile.data.deleted ? profile.data.nick : "이름 없음";
    });
    const ids = page.documents.map((row) => row.id);
    if (ids.length)
      answer.counts = (await commentCounts(ctx, { ids })).counts ?? {};
    return answer;
  } catch (error) {
    if (error.result) return error.result;
    throw error;
  }
}
