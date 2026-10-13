import {
  MEDIA,
  mediaId,
  imageUrl,
  failure,
  dropMedia,
} from "../../modules/shared.js";

export const readOnly = ["mediaCleanup"];

export async function registerMedia(ctx, { id, url } = {}) {
  if (!mediaId(id)) return failure("invalid_input");
  id = id.toLowerCase();
  const previous = await ctx.get(MEDIA, id);
  if (previous)
    return previous.data.owner === ctx.member.id && previous.data.url === url
      ? { ok: true }
      : failure("not_owned");
  await ctx.set(MEDIA, id, {
    owner: ctx.member.id,
    url: imageUrl(url),
    refs: [],
    status: "pending",
    cleanup: true,
    cleanupAfter: ctx.now + 10 * 60_000,
  });
  return { ok: true };
}

/**
 * The caller's uploads that nothing references and whose grace period has
 * passed: uploads never attached to a post, and rows left by the old
 * claim/complete flow. Released references are deleted when they are released.
 * (A `where` on cleanupAfter would miss legacy rows without the field.)
 */
async function cleanable(ctx, size) {
  const page = await ctx.list(MEDIA, {
    filter: { owner: ctx.member.id, cleanup: true },
    size,
  });
  return {
    files: page.documents.filter(
      (file) =>
        !file.data.refs.length && (file.data.cleanupAfter ?? 0) <= ctx.now,
    ),
    nextCursor: page.nextCursor,
  };
}

export async function mediaCleanup(ctx) {
  return { ok: true, ...(await cleanable(ctx, 5)) };
}

/** Deletes those uploads with their ledger rows, in one transaction. */
export async function cleanupMedia(ctx) {
  const { files, nextCursor } = await cleanable(ctx, 10);
  for (const file of files) await dropMedia(ctx, file.id);
  return { ok: true, completed: files.length, remaining: Boolean(nextCursor) };
}
