import {
  CHARACTERS,
  WARDROBE,
  releaseMedia,
  saveImage,
  ownCharacter,
  text,
  imageUrl,
  failure,
} from "../../modules/shared.js";

export function outfit(ctx, { character, name, image, imageId } = {}) {
  if (!ownCharacter(ctx, character)) return failure("not_owned");
  const document = saveImage(
    ctx,
    WARDROBE,
    null,
    {
      owner: ctx.member.id,
      character,
      name: text(name, 80, true),
      image: imageUrl(image),
    },
    { imageId },
  );
  return { ok: true, document };
}

export function wear(ctx, { character, outfit } = {}) {
  const owned = ownCharacter(ctx, character);
  if (!owned) return failure("not_owned");
  const clothing =
    typeof outfit === "string" ? ctx.get(WARDROBE, outfit) : null;
  if (
    outfit !== null &&
    (!clothing ||
      clothing.data.owner !== ctx.member.id ||
      clothing.data.character !== character)
  )
    return failure("not_owned");
  const document = ctx.set(CHARACTERS, owned.id, {
    ...owned.data,
    outfit: clothing?.id ?? null,
  });
  return { ok: true, document };
}

export function removeOutfit(ctx, { id } = {}) {
  const clothing = typeof id === "string" ? ctx.get(WARDROBE, id) : null;
  if (!clothing || clothing.data.owner !== ctx.member.id)
    return failure("not_owned");
  const character = ownCharacter(ctx, clothing.data.character);
  if (!character) return failure("not_owned");
  if (character.data.outfit === clothing.id) return failure("outfit_in_use");
  releaseMedia(ctx, WARDROBE, clothing);
  ctx.delete(WARDROBE, clothing.id);
  return { ok: true, mediaCleanup: Boolean(clothing.data.imageId) };
}
