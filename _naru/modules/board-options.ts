// A board's own settings for what is written on it (adm/board_form.php):
// lengths, the site's banned words, and when a post may no longer be edited.
import { PREFIX, SETTINGS } from "./shared.js";
import type { Access } from "./shared.js";
import type { Ctx, Data, NaruDocument, Where } from "./naru-types.js";

const COMMENTS = `${PREFIX}comments`;

/**
 * A board's settings where the owner has not saved one: 15 posts a page
 * (bo_page_rows from cf_page_rows, install_db.php:157), pictures folded from
 * 600px (bo_gallery_height, board_form.php:95), and no edits once another
 * member has commented (bo_count_modify, board_form.php:89).
 */
export const BOARD_DEFAULTS = Object.freeze({
  pageRows: 15,
  foldHeight: 600,
  editLock: 1,
});

/** A board's number setting, or its default when unset or malformed. */
export function boardNumber(
  board: NaruDocument | null,
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
  ctx: Ctx,
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
export function bannedWords(settings: Data | undefined): string[] {
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
export async function checkBannedWords(ctx: Ctx, ...texts: string[]) {
  const words = bannedWords(
    (await ctx.get(SETTINGS, "community"))?.data ?? undefined,
  );
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
 * then. Comments by its own writer do not count.
 */
export async function checkEditable(
  ctx: Ctx,
  log: NaruDocument,
  board: NaruDocument,
  access: Access,
) {
  const lock = boardNumber(board, "editLock");
  if (!lock || access.role === "moderator") return;
  const me = ctx.member?.id ?? null;
  const others: Where = me
    ? {
        all: [{ ne: ["owner", me] }, { ne: [{ metadata: "createdBy" }, me] }],
      }
    : // A guest's comments carry no member: only members' count.
      { ne: ["owner", null] };
  const count = await ctx.count(COMMENTS, {
    filter: { logId: log.id },
    where: others,
  });
  if (count >= lock)
    ctx.fail(
      "CONFLICT",
      `댓글이 ${lock}건 이상 달린 글은 수정할 수 없습니다.`,
      { reason: "commented" },
    );
}
