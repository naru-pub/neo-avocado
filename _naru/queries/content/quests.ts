// 퀘스트 (quest/index.php): the owner's image quests while they run; the
// reference defines no claim or reward.
import { parsed, scheduled } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

interface QuestRow {
  id: string;
  name: string;
  type: string;
  side: string;
  starts_at: string | null;
  ends_at: string | null;
  images: string;
}

const PAGE = 50;

/** Members' (and the owner's): 50 quests a page, daily, weekly or both. */
export async function quests(
  ctx: QueryCtx,
  {
    type = "",
    after = null,
  }: { type?: "" | "daily" | "weekly"; after?: string | null } = {},
) {
  if (!ctx.member && !ctx.owner)
    ctx.fail("AUTH_REQUIRED", "로그인해 주세요.", { reason: "sign_in" });
  if (
    !["", "daily", "weekly"].includes(type) ||
    (after !== null && typeof after !== "string")
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const { rows } = await ctx.sql<QuestRow>`
    SELECT * FROM quests
    WHERE (${type} = '' OR type = ${type}) AND id > ${after ?? ""}
    ORDER BY id LIMIT ${PAGE + 1}`;
  const page = rows.slice(0, PAGE);
  return {
    quests: page
      .map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        side: row.side,
        startsAt: row.starts_at ?? "",
        endsAt: row.ends_at ?? "",
        images: parsed<unknown[]>(row.images, []).filter(
          (url) => typeof url === "string",
        ),
      }))
      .filter((quest) => scheduled(quest, ctx.now)),
    nextCursor: rows.length > PAGE ? page.at(-1).id : null,
  };
}
