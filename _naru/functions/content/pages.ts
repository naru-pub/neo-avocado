import { PREFIX, contentReadable } from "../../modules/shared.js";
import type { Ctx } from "../../modules/naru-types.js";

export const readOnly = ["contentPages", "contentPage"];
// Pages whose read level is 1 are public, as GnuBoard's guest level.
export const visitors = ["contentPages", "contentPage"];

/** The page the home shows in place of its own (main.php's site_main). */
const MAIN_PAGE = "site_main";

export async function contentPages(
  ctx: Ctx,
  { after = null }: { after?: string | null } = {},
) {
  const page = await ctx.list(`${PREFIX}content`, { size: 10, after });
  const readable = await Promise.all(
    page.documents.map((row) => contentReadable(ctx, row)),
  );
  return {
    ...page,
    documents: page.documents
      .filter((row, index) => readable[index] && row.id !== MAIN_PAGE)
      .map((row) => ({ id: row.id, data: { name: row.data.name } })),
  };
}

export async function contentPage(
  ctx: Ctx,
  { id, mobile = false }: { id?: string; mobile?: boolean } = {},
) {
  if (typeof id !== "string")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const row = await ctx.get(`${PREFIX}content`, id);
  if (!(await contentReadable(ctx, row)))
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  return {
    page: {
      name: row.data.name,
      format: row.data.format,
      body: mobile && row.data.mobileBody ? row.data.mobileBody : row.data.body,
      headerImage: row.data.headerImage,
      footerImage: row.data.footerImage,
    },
  };
}
