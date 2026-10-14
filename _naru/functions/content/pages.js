import { PREFIX, failure, contentReadable } from "../../modules/shared.js";

export const readOnly = ["contentPages", "contentPage"];
// Pages whose read level is 1 are public, as GnuBoard's guest level.
export const visitors = ["contentPages", "contentPage"];

export async function contentPages(ctx, { after = null } = {}) {
  const page = await ctx.list(`${PREFIX}content`, { size: 10, after });
  const readable = await Promise.all(
    page.documents.map((row) => contentReadable(ctx, row)),
  );
  return {
    ok: true,
    ...page,
    documents: page.documents
      .filter((row, index) => readable[index])
      .map((row) => ({ id: row.id, data: { name: row.data.name } })),
  };
}

export async function contentPage(ctx, { id, mobile = false } = {}) {
  if (typeof id !== "string") return failure("invalid_input");
  const row = await ctx.get(`${PREFIX}content`, id);
  if (!(await contentReadable(ctx, row))) return failure("document_not_found");
  return {
    ok: true,
    page: {
      name: row.data.name,
      format: row.data.format,
      body: mobile && row.data.mobileBody ? row.data.mobileBody : row.data.body,
      headerImage: row.data.headerImage,
      footerImage: row.data.footerImage,
    },
  };
}
