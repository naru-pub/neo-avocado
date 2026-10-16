// 내용 페이지 (bbs/content.php): the owner's pages the reader's level may
// see. Pages whose read level is 1 are public, as GnuBoard's guest level.
import { communityAccess } from "../../modules/access.js";
import { MAIN_PAGE, readablePage } from "../../modules/content.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/** The pages the reader may see, by ID, without the home's own (site_main). */
export async function contentPages(ctx: QueryCtx) {
  const access = await communityAccess(ctx);
  const { rows } = await ctx.sql<{ id: string; name: string }>`
    SELECT id, name FROM content
    WHERE enabled != 0 AND read_level <= ${access.level} AND id != ${MAIN_PAGE}
    ORDER BY id LIMIT 1000`;
  return { pages: rows.map((row) => ({ id: row.id, name: row.name })) };
}

/** One page, its mobile body on a phone when it has one. */
export async function contentPage(
  ctx: QueryCtx,
  { id, mobile = false }: { id?: string; mobile?: boolean } = {},
) {
  if (typeof id !== "string")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const row = await readablePage(ctx, id);
  if (!row)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  return {
    page: {
      name: row.name,
      format: row.format,
      body: mobile && row.mobile_body ? row.mobile_body : row.body,
      headerImage: row.header_image,
      footerImage: row.footer_image,
    },
  };
}
