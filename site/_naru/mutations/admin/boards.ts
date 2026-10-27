// 게시판 (adm/board_list.php, board_form.php): the owner saves an entry,
// checked as its form checks it (modules/admin-model.ts), with 그룹적용 and
// 전체적용, and copies one (board_copy.php); deleting is admin/records'.

import { ownerOnly, text } from "../../modules/access.js";
import {
  conflict,
  dataOf,
  invalid,
  recordOf,
  rowById,
  saveRecord,
  TABLES,
  writeRow,
} from "../../modules/admin.js";
import { models } from "../../modules/admin-model.js";
import {
  COMMENT_COPY_COLUMNS,
  POST_COPY_COLUMNS,
} from "../../modules/boards.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/** Boards 그룹적용 and 전체적용 reach in one call: one write each. */
const APPLY_LIMIT = 90;

/**
 * Saves a board; with `applyTo` (board_form.php's 그룹적용 or 전체적용), the
 * settings `applyFields` names go to every other board of its group, or to
 * every other board, in the same call (board_form_update.php:245-).
 */
export const save = ownerOnly(async function save(
  ctx: MutationCtx,
  args: {
    id?: string;
    values?: Record<string, unknown>;
    create?: boolean;
    applyTo?: string;
    applyFields?: string[];
  },
) {
  const { applyTo = "", applyFields = [], ...rest } = args ?? {};
  const keys = new Set(
    (models.boards.fields ?? [])
      .map((field) => field.key)
      .filter((key) => key && !["name", "group"].includes(key)),
  );
  if (
    !["", "group", "all"].includes(applyTo) ||
    !Array.isArray(applyFields) ||
    applyFields.some((key) => !keys.has(key))
  )
    invalid(ctx);
  const saved = await saveRecord(ctx, "boards", rest);
  if (!applyTo || !applyFields.length) return saved;
  if (applyTo === "group" && !saved.data.group)
    ctx.fail(
      "INVALID_REQUEST",
      "그룹이 없는 게시판은 그룹적용할 수 없습니다.",
      {
        reason: "no_group",
      },
    );
  const t = TABLES.boards;
  const others = (
    applyTo === "group"
      ? await ctx.sql`SELECT * FROM boards WHERE group_id = ${saved.data.group} AND id != ${saved.id} LIMIT ${APPLY_LIMIT + 1}`
      : await ctx.sql`SELECT * FROM boards WHERE id != ${saved.id} LIMIT ${APPLY_LIMIT + 1}`
  ).rows;
  if (others.length > APPLY_LIMIT)
    ctx.fail(
      "INVALID_REQUEST",
      `한 번에 ${APPLY_LIMIT}개 게시판까지 적용할 수 있습니다.`,
      { reason: "too_many_boards" },
    );
  for (const row of others) {
    const record = recordOf(t, row);
    for (const key of applyFields) record.data[key] = saved.data[key];
    await writeRow(ctx, t, record.id, record.data);
  }
  return { ...saved, applied: others.length };
});

/**
 * 게시판 복사 (adm/board_copy_update.php): a new board `target` named `name`
 * with every setting of `id`, and with `data` (구조와 데이터) its posts,
 * their comments and tags too, numbered as they were. The copies pay and
 * take back nothing: their rewards are 0. Calls and 관심 stay with the
 * originals, as the original copies only the board's own table.
 */
export const copy = ownerOnly(async function copy(
  ctx: MutationCtx,
  {
    id,
    target,
    name,
    data = false,
  }: { id?: string; target?: string; name?: string; data?: boolean } = {},
) {
  const t = TABLES.boards;
  const source = await rowById(ctx, t, id);
  if (!source)
    ctx.fail("NOT_FOUND", "복사할 게시판이 없습니다.", {
      reason: "document_not_found",
    });
  // 영문자, 숫자, _ 만 가능 (board_copy.php), 20자 이내.
  if (typeof target !== "string" || !/^[A-Za-z0-9_]{1,20}$/.test(target))
    ctx.fail(
      "INVALID_REQUEST",
      "복사할 게시판 ID는 공백 없이 영문자, 숫자, _ 20자 이내로 적어 주세요.",
      { reason: "invalid_input" },
    );
  if (target === source.id)
    ctx.fail(
      "INVALID_REQUEST",
      "원본 게시판 ID와 복사할 게시판 ID가 달라야 합니다.",
      { reason: "invalid_input" },
    );
  if (await rowById(ctx, t, target)) conflict(ctx);
  if (typeof data !== "boolean") invalid(ctx);
  let title = "";
  try {
    title = text(name, 120, true);
  } catch {
    invalid(ctx);
  }
  await writeRow(ctx, t, target, { ...dataOf(t, source), name: title });
  if (!data) return { id: target, posts: 0 };
  const { changes } = await ctx.sql(
    `INSERT INTO posts (board, ${POST_COPY_COLUMNS.join(", ")}, reward)
     SELECT ?, ${POST_COPY_COLUMNS.join(", ")}, 0 FROM posts WHERE board = ?`,
    [target, source.id],
  );
  // Each copy is its original's number on the new board.
  const pairs = `FROM posts AS old JOIN posts AS copied
    ON copied.board = ? AND copied.number = old.number WHERE old.board = ?`;
  // A copied reply's thread is its first post's copy (wr_num, wr_reply).
  await ctx.sql(
    `WITH roots AS MATERIALIZED (
       SELECT old.number AS number, root_copy.id AS thread
       FROM posts AS old
       JOIN posts AS root_old ON root_old.id = old.thread
       JOIN posts AS root_copy ON root_copy.board = ? AND root_copy.number = root_old.number
       WHERE old.board = ? AND old.thread IS NOT NULL)
     UPDATE posts SET thread = (SELECT thread FROM roots WHERE roots.number = posts.number)
     WHERE board = ? AND reply_path != ''`,
    [target, source.id, target],
  );
  await ctx.sql(
    `INSERT INTO post_tags (post_id, tag)
     SELECT copied.id, post_tags.tag ${pairs.replace("WHERE", "JOIN post_tags ON post_tags.post_id = old.id WHERE")}`,
    [target, source.id],
  );
  await ctx.sql(
    `INSERT INTO posts_search (rowid, title, body)
     SELECT copied.id, posts_search.title, posts_search.body ${pairs.replace("WHERE", "JOIN posts_search ON posts_search.rowid = old.id WHERE")}`,
    [target, source.id],
  );
  await ctx.sql(
    `INSERT INTO comments (post_id, ${COMMENT_COPY_COLUMNS.join(", ")}, reward)
     SELECT copied.id, ${COMMENT_COPY_COLUMNS.map((column) => `comments.${column}`).join(", ")}, 0
     ${pairs.replace("WHERE", "JOIN comments ON comments.post_id = old.id WHERE")}
     ORDER BY comments.id`,
    [target, source.id],
  );
  await ctx.sql`INSERT INTO comments_search (rowid, body)
    SELECT comments.id, comments.body FROM posts JOIN comments ON comments.post_id = posts.id
    WHERE posts.board = ${target}`;
  return { id: target, posts: changes };
});

/**
 * Deletes a board's posts with what hangs off them (comments, tags, 조회수,
 * downloads, votes, calls, 관심), as board_delete.inc.php drops a board's
 * write table, before the board itself is deleted. Its 글쓰기 rewards are
 * not taken back, as the original's are not.
 */
export const clear = ownerOnly(async function clear(
  ctx: MutationCtx,
  { id }: { id?: string } = {},
) {
  if (typeof id !== "string" || !id) invalid(ctx);
  const posts = "SELECT id FROM posts WHERE board = ?";
  await ctx.sql(
    `DELETE FROM comments_search WHERE rowid IN
     (SELECT id FROM comments WHERE post_id IN (${posts}))`,
    [id],
  );
  for (const [table, column] of [
    ["comments", "post_id"],
    ["post_tags", "post_id"],
    ["post_hits", "post_id"],
    ["attachment_downloads", "post_id"],
    ["link_hits", "post_id"],
    ["post_votes", "post_id"],
    ["calls", "post_id"],
    ["favorites", "post"],
    ["posts_search", "rowid"],
  ])
    await ctx.sql(`DELETE FROM ${table} WHERE ${column} IN (${posts})`, [id]);
  const { changes } = await ctx.sql`DELETE FROM posts WHERE board = ${id}`;
  return { posts: changes };
});
