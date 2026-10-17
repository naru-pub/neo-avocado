// A board's own settings for what is written on it (adm/board_form.php):
// lengths, the site's banned words, and when a post may no longer be edited.
import { communitySettings, one } from "./access.js";
import type { Access, SqlCtx } from "./access.js";
import { isStaff } from "./boards.js";
import type { Board, PostRow } from "./boards.js";
import type { QueryCtx } from "./naru-types.js";

type FailCtx = SqlCtx & Pick<QueryCtx, "fail">;

/**
 * A board's settings where the owner has not saved one: 15 posts a page
 * (bo_page_rows from cf_page_rows, install_db.php:157), pictures folded from
 * 600px (bo_gallery_height, board_form.php:95), and no edits once another
 * member has commented (bo_count_modify, board_form.php:89). The boards
 * table starts its columns at these.
 */
export const BOARD_DEFAULTS = Object.freeze({
  pageRows: 15,
  foldHeight: 600,
  editLock: 1,
  // bo_upload_count 1, bo_new 24, bo_image_width 600 (board_form.php:102-105).
  uploadCount: 1,
  newHours: 24,
  imageWidth: 600,
});

/**
 * 리스트 정렬 필드 (bo_sort_field, board_form.php:697): the list's order
 * after its notices, by the SQL each sorts by. 조회수 and 추천수 have no
 * counts here.
 */
export const SORTS: Record<string, string> = {
  "": "posts.id DESC",
  "datetime asc": "posts.id ASC",
  "datetime desc": "posts.created_at DESC, posts.id DESC",
  // wr_last: the post's or its newest comment's time.
  "last asc":
    "max(posts.created_at, coalesce((SELECT max(created_at) FROM comments WHERE comments.post_id = posts.id), 0)) ASC, posts.id ASC",
  "last desc":
    "max(posts.created_at, coalesce((SELECT max(created_at) FROM comments WHERE comments.post_id = posts.id), 0)) DESC, posts.id DESC",
  "comment asc":
    "(SELECT count(*) FROM comments WHERE comments.post_id = posts.id) ASC, posts.id DESC",
  "comment desc":
    "(SELECT count(*) FROM comments WHERE comments.post_id = posts.id) DESC, posts.id DESC",
};
/** A board's list order, its notices first. */
export const sortOf = (board: Board | null) =>
  `posts.notice DESC, ${SORTS[board?.data.sortField] ?? SORTS[""]}`;

/**
 * 목록에서 내용 사용 (bo_use_list_content): whether a plain board's list
 * carries its posts' text. The mmb skin's always does (lib/common.lib.php:357),
 * and the qna and caculate skins' lists show it whole; a board saved before
 * the setting carries it, as it did.
 */
export const listsContent = (board: Board | null) =>
  board?.data.kind !== "text" || board?.data.listContent !== false;

/** A board's number setting, or its default when unset or malformed. */
export function boardNumber(
  board: Board | null,
  key: keyof typeof BOARD_DEFAULTS,
): number {
  const value = board?.data[key];
  return Number.isSafeInteger(value) && value >= 0
    ? value
    : BOARD_DEFAULTS[key];
}

/**
 * Fails when `value` is shorter or longer than the board allows
 * (bo_write_min/max, bo_comment_min/max; bbs/write.php:207-216,
 * view_comment.php:111-119): 0 is no limit, and the staff are not held to it.
 */
export function checkLength(
  ctx: Pick<QueryCtx, "fail">,
  value: string,
  { min, max }: { min: unknown; max: unknown },
  staff: boolean,
) {
  if (staff) return;
  const least = Number.isSafeInteger(min) ? (min as number) : 0;
  const most = Number.isSafeInteger(max) ? (max as number) : 0;
  if ((least > 0 && value.length < least) || (most > 0 && value.length > most))
    ctx.fail(
      "INVALID_REQUEST",
      most > 0
        ? `내용은 ${least}~${most}자로 써 주세요.`
        : `내용은 ${least}자 이상 써 주세요.`,
      { reason: "length", min: least, max: most },
    );
}

/** The site's banned words (cf_filter), comma-separated in the settings. */
export function bannedWords(settings: Record<string, any> | undefined) {
  const list = settings?.bannedWords;
  return typeof list === "string"
    ? list
        .split(",")
        .map((word) => word.trim())
        .filter(Boolean)
    : [];
}

/**
 * Fails when a title or text holds one of the site's banned words, ignoring
 * case, as bbs/ajax.filter.php checks the subject and content before a post
 * or comment is saved.
 */
export async function checkBannedWords(ctx: FailCtx, ...texts: string[]) {
  const words = bannedWords(await communitySettings(ctx));
  for (const text of texts) {
    const lower = text.toLowerCase();
    const found = words.find((word) => lower.includes(word.toLowerCase()));
    if (found)
      ctx.fail(
        "INVALID_REQUEST",
        `금지된 단어(${found})가 들어 있어 올릴 수 없습니다.`,
        { reason: "banned_word", word: found },
      );
  }
}

/**
 * Fails when others have commented on a post as many times as the board's
 * editLock (bo_count_modify, bbs/write.php:84-91): only the staff edit it
 * then. Comments by its own writer do not count, nor guests'.
 */
export async function checkEditable(
  ctx: FailCtx,
  post: PostRow,
  board: Board,
  access: Access,
) {
  const lock = boardNumber(board, "editLock");
  if (!lock || isStaff(access, board)) return;
  const me = ctx.member?.id ?? null;
  const { count } = await one<{ count: number }>(
    ctx,
    "SELECT count(*) AS count FROM comments WHERE post_id = ? AND owner IS NOT NULL AND owner IS NOT ?",
    [post.id, me],
  );
  if (count >= lock)
    ctx.fail(
      "CONFLICT",
      `댓글이 ${lock}건 이상 달린 글은 수정할 수 없습니다.`,
      { reason: "commented" },
    );
}
