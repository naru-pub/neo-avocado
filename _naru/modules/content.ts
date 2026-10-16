// The owner's pages (내용 페이지) and the site's background music.
import { communityAccess, levelAllows, one } from "./access.js";
import type { Access, SqlCtx } from "./access.js";

export interface ContentRow {
  id: string;
  name: string;
  enabled: number;
  read_level: number;
  format: string;
  body: string;
  mobile_body: string;
  header_image: string | null;
  footer_image: string | null;
}

/** The page the home shows in place of its own (main.php's site_main). */
export const MAIN_PAGE = "site_main";

/**
 * Whether the reader may see a content page. The original's pages have no
 * read level (bbs/content.php, main.php), so a page without one is everyone's.
 */
export const pageReadable = (row: ContentRow | null, access: Access) =>
  Boolean(row) && row.enabled !== 0 && levelAllows(access, row.read_level);

/** A content page by ID, if the reader may see it. */
export async function readablePage(
  ctx: SqlCtx,
  id: string,
  access?: Access,
): Promise<ContentRow | null> {
  const row = await one<ContentRow>(ctx, "SELECT * FROM content WHERE id = ?", [
    id,
  ]);
  return pageReadable(row, access ?? (await communityAccess(ctx))) ? row : null;
}

/**
 * The background music the owner set: a YouTube playlist (`list=…`, or the
 * bare ID) or a single video (`v=…`, youtu.be/…), else null. Only the ID
 * reaches pages, which embed it themselves.
 */
export function backgroundMusic(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const id = /^[\w-]{10,64}$/;
  const list = text.match(/[?&]list=([\w-]{10,64})/)?.[1];
  if (list) return { list };
  const video =
    text.match(/[?&]v=([\w-]{11})/)?.[1] ??
    text.match(/youtu\.be\/([\w-]{11})/)?.[1];
  if (video) return { video };
  if (!id.test(text)) return null;
  return text.length === 11 ? { video: text } : { list: text };
}
