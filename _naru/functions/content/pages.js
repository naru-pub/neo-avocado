import { PREFIX, failure, contentReadable } from "../../modules/shared.js";

export function contentPages(ctx, { after = null } = {}) {
  const page = ctx.list(`${PREFIX}content`, { size: 10, after });
  return {
    ok: true,
    ...page,
    documents: page.documents
      .filter((row) => contentReadable(ctx, row))
      .map((row) => ({ id: row.id, data: { name: row.data.name } })),
  };
}

export function contentPage(ctx, { id, mobile = false } = {}) {
  if (typeof id !== "string") return failure("invalid_input");
  const row = ctx.get(`${PREFIX}content`, id);
  if (!contentReadable(ctx, row)) return failure("document_not_found");
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
