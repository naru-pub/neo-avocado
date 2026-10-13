import { MEDIA, mediaId, imageUrl, failure } from "../../modules/shared.js";

export function registerMedia(ctx, { id, url } = {}) {
  if (!mediaId(id)) return failure("invalid_input");
  id = id.toLowerCase();
  const previous = ctx.get(MEDIA, id);
  if (previous)
    return previous.data.owner === ctx.member.id && previous.data.url === url
      ? { ok: true }
      : failure("not_owned");
  ctx.set(MEDIA, id, {
    owner: ctx.member.id,
    url: imageUrl(url),
    refs: [],
    status: "pending",
    cleanup: true,
    cleanupAfter: ctx.now + 10 * 60_000,
  });
  return { ok: true };
}

export function mediaCleanup(ctx) {
  const page = ctx.list(MEDIA, {
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

export function claimMedia(ctx, { id } = {}) {
  if (mediaId(id)) id = id.toLowerCase();
  const asset = mediaId(id) ? ctx.get(MEDIA, id) : null;
  if (!asset || asset.data.owner !== ctx.member.id) return failure("not_owned");
  if (asset.data.refs.length || (asset.data.cleanupAfter ?? 0) > ctx.now)
    return failure("media_in_use");
  ctx.set(MEDIA, id, { ...asset.data, status: "deleting", cleanup: true });
  return { ok: true };
}

export function completeMedia(ctx, { id } = {}) {
  if (mediaId(id)) id = id.toLowerCase();
  const asset = mediaId(id) ? ctx.get(MEDIA, id) : null;
  if (!asset) return { ok: true };
  if (
    asset.data.owner !== ctx.member.id ||
    asset.data.status !== "deleting" ||
    asset.data.refs.length
  )
    return failure("not_owned");
  ctx.delete(MEDIA, id);
  return { ok: true };
}
