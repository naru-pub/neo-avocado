// A board's RSS feed (bbs/rss.php) at /rss/<board>: its newest posts, as a
// visitor reads them, for a board visitors may list and read whose owner
// turned on RSS 보이기 (bo_use_rss_view). Naru's routes answer it as
// application/rss+xml.
import { GUEST_ACCESS, siteOpen } from "./access.js";
import type { PostRow } from "./boards.js";
import { boardAllowed, boardOf, POST_SELECT, plainText } from "./boards.js";
import type { QueryCtx } from "./naru-types.js";
import type { RouteInput } from "./previews.js";
import { escapeHtml, NOT_FOUND, siteOf } from "./previews.js";

/** How long Naru's edge keeps a feed, in seconds. */
const CACHE = 300;
/** The most of a post's text a feed item carries. */
const TEXT = 2000;

/** An HTTPS picture's address, or null. */
const https = (value: unknown): string | null =>
  typeof value === "string" &&
  /^https:\/\/[^\s/@?#:]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/.test(value)
    ? value
    : null;

export async function feed(ctx: QueryCtx, input: RouteInput) {
  const id = input?.params?.board;
  // A closed site (사이트공개 off) shows visitors nothing.
  if (!(await siteOpen(ctx))) return NOT_FOUND;
  const board = await boardOf(ctx, id);
  // 비회원 읽기가 가능한 게시판만 RSS 지원, and only with RSS 보이기 on.
  if (
    !board ||
    board.data.rss !== true ||
    !boardAllowed(board, GUEST_ACCESS, "list") ||
    !boardAllowed(board, GUEST_ACCESS, "read")
  )
    return NOT_FOUND;
  const site = await siteOf(ctx);
  const origin =
    site.address ||
    (typeof input?.origin === "string" &&
    /^https?:\/\/[^/]+$/.test(input.origin)
      ? input.origin
      : "");
  const group = board.data.group
    ? (
        await ctx.sql<{
          name: string;
        }>`SELECT name FROM board_groups WHERE id = ${board.data.group}`
      ).rows[0]?.name
    : null;
  // bo_page_rows of its newest, not secret; nor 멤버공개 or 19금, which a
  // visitor does not read whole here.
  const rows = Math.min(
    100,
    Math.max(
      1,
      Number.isSafeInteger(board.data.pageRows) ? board.data.pageRows : 15,
    ),
  );
  const { rows: posts } = await ctx.sql<PostRow>(
    `${POST_SELECT} WHERE board = ? AND secret = 0 AND members_only = 0 AND adult = 0
     ORDER BY id DESC LIMIT ?`,
    [board.id, rows],
  );
  const owners = [
    ...new Set(
      posts
        .filter((post) => post.owner && !post.anonymous)
        .map((post) => post.owner),
    ),
  ];
  const nicks = new Map(
    owners.length
      ? (
          await ctx.sql<{ member: string; nick: string }>(
            "SELECT member, nick FROM profiles WHERE deleted_at IS NULL AND member IN (SELECT value FROM json_each(?))",
            [JSON.stringify(owners)],
          )
        ).rows.map((row): [string, string] => [row.member, row.nick])
      : [],
  );
  const creator = (post: PostRow) =>
    post.anonymous
      ? "익명의 누군가"
      : post.guest_name !== null
        ? `${post.guest_name} (손님)`
        : (nicks.get(post.owner) ?? "");
  const items = posts.map((post) => {
    const link = `${origin}/post/${post.id}`;
    const text = (
      post.format === "html" ? plainText(post.body) : post.body
    ).slice(0, TEXT);
    const picture = https(post.image);
    // The description is HTML, escaped into the XML: the picture, the text.
    const description = `${picture ? `<p><img src="${escapeHtml(picture)}" alt=""></p>` : ""}<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
    return [
      "<item>",
      `<title>${escapeHtml(post.title || `${board.data.name} No. ${post.number}`)}</title>`,
      `<link>${escapeHtml(link)}</link>`,
      `<guid isPermaLink="true">${escapeHtml(link)}</guid>`,
      `<description>${escapeHtml(description)}</description>`,
      `<dc:creator>${escapeHtml(creator(post))}</dc:creator>`,
      `<dc:date>${new Date(post.created_at).toUTCString()}</dc:date>`,
      "</item>",
    ].join("\n");
  });
  const title = [site.name, group, board.data.name].filter(Boolean).join(" > ");
  const body = [
    '<?xml version="1.0" encoding="utf-8" ?>',
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "<channel>",
    `<title>${escapeHtml(title)}</title>`,
    `<link>${escapeHtml(`${origin}/logs/${encodeURIComponent(board.id)}`)}</link>`,
    `<description>${escapeHtml(site.description)}</description>`,
    "<language>ko</language>",
    ...items,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
  return { body, type: "application/rss+xml", cache: CACHE };
}
