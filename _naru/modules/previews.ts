// Link previews (head.sub.php's title, description and share tags): what
// the site's routes (_naru/routes/) add to index.html's <head> for each
// address the pages know (app/router.ts), so a shared /logs/free/12 shows the
// post and a direct visit or reload serves the page there. A route runs as
// a visitor's query, so a preview shows only what a visitor may read, by
// the same checks the queries make; anything else (a secret, 멤버공개 or
// 19금 post, a members-only board) shows the site's own preview, which tells
// nothing of it. A closed site's pages show no preview at all, not even the
// site's own name, description or picture.
import { communityAccess, imageUrl, one, settingsOf } from "./access.js";
import type { Access } from "./access.js";
import {
  POST_SELECT,
  boardAllowed,
  boardOf,
  plainText,
  postOf,
  postReadable,
  postRow,
  presentPost,
  readerOf,
  rowKey,
} from "./boards.js";
import type { Board, PostRow } from "./boards.js";
import { characterKey, characterRow } from "./characters.js";
import { MAIN_PAGE, readablePage } from "./content.js";
import type { QueryCtx } from "./naru-types.js";

/** What Naru hands a route: the path asked, its parameters and query. */
export interface RouteInput {
  path?: string;
  /** The address the page was asked on (Naru's), such as https://x.naru.pub. */
  origin?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

/** What a page's preview shows; what it leaves out is the site's own. */
export interface Preview {
  title?: string;
  description?: string;
  image?: string | null;
  type?: "website" | "article" | "profile";
  /** The page's own path, when another names it too. */
  canonical?: string;
}

/**
 * A page an address names: its preview, null for the site's own, or false
 * when the address is no page at all (Naru answers 404).
 */
export type Page = (
  ctx: QueryCtx,
  params: Record<string, string>,
  access: Access,
) => Promise<Preview | null | false>;

/** How long Naru's edge may keep a page, in seconds. */
export const CACHE = 60;
/** The template's own name and description, until the owner sets theirs. */
export const SITE_NAME = "네오 아보카도";
export const SITE_DESCRIPTION = "자캐 커뮤니티입니다.";
/** The most of a page's text a description shows. */
const DESCRIPTION = 150;

/** An HTTPS address, or null (what pages show as pictures). */
function https(value: unknown): string | null {
  try {
    return imageUrl(value);
  } catch {
    return null;
  }
}

/** Text as HTML text and attribute values carry it. */
export const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (match) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        match
      ],
  );

/** The opening of a text, plain and on one line, at most 150 characters. */
export function opening(text: unknown, html = false): string {
  let plain = String(text ?? "");
  if (html)
    plain = plainText(plain).replace(
      /&(amp|lt|gt|quot|#39);/g,
      (_, name) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name],
    );
  plain = plain.replace(/\s+/g, " ").trim();
  return plain.length > DESCRIPTION
    ? `${plain.slice(0, DESCRIPTION - 1).trimEnd()}…`
    : plain;
}

/** The site's name, description, picture and address (디자인). */
export async function siteOf(ctx: QueryCtx) {
  const design = await settingsOf(ctx, "design");
  const text = (value: unknown, max: number) =>
    typeof value === "string" ? value.trim().slice(0, max) : "";
  return {
    name: text(design.title, 60) || SITE_NAME,
    description: text(design.description, 300) || SITE_DESCRIPTION,
    // cf_site_img, else the logo.
    image: https(design.shareImage) ?? https(design.logo),
    // The owner's address, when set, is the one canonical address of
    // the site's pages; else the address the page was asked on (route).
    address: (https(design.address) ?? "").replace(/\/+$/, ""),
  };
}

/** A path as the pages write it: each part encoded, no trailing slash. */
export function pathOf(path: unknown): string {
  return `/${String(path ?? "")
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return encodeURIComponent(decodeURIComponent(part));
      } catch {
        return encodeURIComponent(part);
      }
    })
    .join("/")}`;
}

/** The tags a page's preview adds to index.html's <head>. */
export function headOf(
  site: Awaited<ReturnType<typeof siteOf>>,
  page: Preview | null,
  path: string,
): string {
  const title = page?.title?.trim() || "";
  const description = page?.description?.trim() || site.description;
  const image = page?.image || site.image;
  const url = `${site.address}${page?.canonical ?? pathOf(path)}`;
  const meta = (attribute: string, name: string, content: string) =>
    `<meta ${attribute}="${name}" content="${escape(content)}" />`;
  return [
    `<title>${escape(title ? `${title} - ${site.name}` : site.name)}</title>`,
    meta("name", "description", description),
    `<link rel="canonical" href="${escape(url)}" />`,
    meta("property", "og:site_name", site.name),
    meta("property", "og:type", page?.type ?? "website"),
    meta("property", "og:title", title || site.name),
    meta("property", "og:description", description),
    meta("property", "og:url", url),
    ...(image ? [meta("property", "og:image", image)] : []),
    meta("name", "twitter:card", image ? "summary_large_image" : "summary"),
  ].join("\n");
}

/** What a route answers for an address that is no page. */
export const NOT_FOUND = Object.freeze({
  body: "Not Found",
  type: "text/plain",
  status: 404,
});

/**
 * What a closed site's pages add to index.html's <head>: no preview, not even
 * the site's own, so a shared link shows nothing of the community, and it is
 * kept out of search results. The page sets its title once it loads.
 */
export const CLOSED_HEAD = '<meta name="robots" content="noindex, nofollow" />';

/**
 * A route: index.html with `page`'s preview (the site's own without one),
 * kept at the edge for CACHE seconds. A closed site's pages show none
 * (CLOSED_HEAD).
 */
export function route(page?: Page) {
  return async (ctx: QueryCtx, input: RouteInput) => {
    const access = await communityAccess(ctx);
    const shown = page ? await page(ctx, input?.params ?? {}, access) : null;
    if (shown === false) return NOT_FOUND;
    if (access.closed)
      return { file: "index.html", head: CLOSED_HEAD, cache: CACHE };
    const site = await siteOf(ctx);
    const origin =
      typeof input?.origin === "string" &&
      /^https?:\/\/[^/]+$/.test(input.origin)
        ? input.origin
        : "";
    return {
      file: "index.html",
      head: headOf(
        { ...site, address: site.address || origin },
        shown,
        input?.path ?? "/",
      ),
      cache: CACHE,
    };
  };
}

/** A page whose preview is its name only: 멤버목록, 상점, 마이페이지… */
export const named =
  (title: string): Page =>
  async () => ({ title });

/** A whole positive number, as an address writes one. */
const whole = (value: unknown) =>
  typeof value === "string" && /^[1-9]\d{0,14}$/.test(value);

/**
 * A post's preview, if a visitor may read it whole (posts:post): its board's
 * read level, not secret nor 멤버공개, and not 19금 either, whose picture is
 * hidden until asked for. Its title (else its board and number), opening
 * text and picture, else its speaker's; 익명 hides the speaker.
 */
async function postPreview(
  ctx: QueryCtx,
  row: PostRow | null,
  access: Access,
  board?: Board | null,
): Promise<Preview | null> {
  if (!row || row.adult) return null;
  const on = board === undefined ? await boardOf(ctx, row.board) : board;
  if (!(await postReadable(ctx, row, access, null, on))) return null;
  const { data } = presentPost(postOf(row), readerOf(ctx, access));
  return {
    title:
      String(data.title ?? "").trim() || `${on.data.name} No. ${data.number}`,
    description: opening(data.text, data.format === "html"),
    image: https(data.image) ?? https(data.speaker?.portrait),
    type: "article",
    canonical: `/post/${row.id}`,
  };
}

/** /post/<id> and /post/<id>/comment/<id>: the post. */
export const post: Page = async (ctx, { id, comment }, access) => {
  if (
    rowKey(id) === null ||
    (comment !== undefined && rowKey(comment) === null)
  )
    return false;
  return await postPreview(ctx, await postRow(ctx, id), access);
};

/**
 * /logs/<board>/<number>: the post by its board's number, which asks for
 * the board's list level too (posts:post by number).
 */
export const numbered: Page = async (ctx, { board: id, number }, access) => {
  if (!whole(number)) return false;
  const board = await boardOf(ctx, id);
  if (!boardAllowed(board, access, "list")) return null;
  const row = await one<PostRow>(
    ctx,
    `${POST_SELECT} WHERE board = ? AND number = ?`,
    [board.id, Number(number)],
  );
  return await postPreview(ctx, row, access, board);
};

/**
 * /logs/<board> and its pages, tags, searches and 분류: the board, if a
 * visitor may list and read it (posts:page), by its name and description;
 * a 분류 of its own is named too.
 */
export const board: Page = async (
  ctx,
  { board: id, page, category },
  access,
) => {
  if (page !== undefined && !whole(page)) return false;
  const found = await boardOf(ctx, id);
  if (
    !boardAllowed(found, access, "list") ||
    !boardAllowed(found, access, "read")
  )
    return null;
  const known = category && (found.data.categories ?? []).includes(category);
  return {
    title: known ? `${found.data.name} · ${category}` : found.data.name,
    description: opening(found.data.description, true),
  };
};

/**
 * /character/<id>: a character, while visitors may see characters
 * (characters/sheet:sheet's viewable, 사이트공개), by its name, profile and
 * picture (두상, else 흉상 or 전신).
 */
export const character: Page = async (ctx, { id }, access) => {
  if (characterKey(id) === null) return false;
  if (access.closed) return null;
  const row = await characterRow(ctx, id);
  if (!row) return null;
  return {
    title: row.name,
    description: opening(row.profile),
    image: https(row.image) ?? https(row.head) ?? https(row.body),
    type: "profile",
    canonical: `/character/${row.id}`,
  };
};

/**
 * /content/<id>: a content page a visitor's level may read
 * (content/pages:contentPage), by its title; the home's own (site_main) is
 * no page of the list.
 */
export const content: Page = async (ctx, { id }, access) => {
  if (id === MAIN_PAGE) return null;
  const row = await readablePage(ctx, id, access);
  if (!row) return null;
  return { title: row.name, image: https(row.header_image) };
};
