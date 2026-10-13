import { MEDIA, mediaId, imageUrl, failure } from "../../modules/shared.js";

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

export async function mediaCleanup(ctx) {
  const page = await ctx.list(MEDIA, {
    filter: { owner: ctx.member.id, cleanup: true },
    size: 5,
  });
  return {
    ok: true,
    files: page.documents.filter(
      (file) => (file.data.cleanupAfter ?? 0) <= ctx.now,
    ),
    nextCursor: page.nextCursor,
  };
}

export async function claimMedia(ctx, { id } = {}) {
  if (mediaId(id)) id = id.toLowerCase();
  const asset = mediaId(id) ? await ctx.get(MEDIA, id) : null;
  if (!asset || asset.data.owner !== ctx.member.id) return failure("not_owned");
  if (asset.data.refs.length || (asset.data.cleanupAfter ?? 0) > ctx.now)
    return failure("media_in_use");
  await ctx.set(MEDIA, id, {
    ...asset.data,
    status: "deleting",
    cleanup: true,
  });
  return { ok: true };
}

export async function completeMedia(ctx, { id } = {}) {
  if (mediaId(id)) id = id.toLowerCase();
  const asset = mediaId(id) ? await ctx.get(MEDIA, id) : null;
  if (!asset) return { ok: true };
  if (
    asset.data.owner !== ctx.member.id ||
    asset.data.status !== "deleting" ||
    asset.data.refs.length
  )
    return failure("not_owned");
  await ctx.delete(MEDIA, id);
  return { ok: true };
}
