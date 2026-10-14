import {
  CHARACTERS,
  WARDROBE,
  ownCharacter,
  text,
  imageUrl,
  failure,
} from "../../modules/shared.js";
import { presentCharacter } from "../../modules/characters.js";

export async function outfit(ctx, { character, name, image } = {}) {
  if (!(await ownCharacter(ctx, character))) return failure("not_owned");
  const document = await ctx.add(WARDROBE, {
    owner: ctx.member.id,
    character,
    name: text(name, 80, true),
    image: imageUrl(image),
  });
  return { ok: true, document };
}

export async function wear(ctx, { character, outfit } = {}) {
  const owned = await ownCharacter(ctx, character);
  if (!owned) return failure("not_owned");
  const clothing =
    typeof outfit === "string" ? await ctx.get(WARDROBE, outfit) : null;
  if (
    outfit !== null &&
    (!clothing ||
      clothing.data.owner !== ctx.member.id ||
      clothing.data.character !== character)
  )
    return failure("not_owned");
  const document = await ctx.set(CHARACTERS, owned.id, {
    ...owned.data,
    outfit: clothing?.id ?? null,
  });
  return { ok: true, document: await presentCharacter(ctx, document) };
}

export async function removeOutfit(ctx, { id } = {}) {
  const clothing = typeof id === "string" ? await ctx.get(WARDROBE, id) : null;
  if (!clothing || clothing.data.owner !== ctx.member.id)
    return failure("not_owned");
  const character = await ownCharacter(ctx, clothing.data.character);
  if (!character) return failure("not_owned");
  if (character.data.outfit === clothing.id) return failure("outfit_in_use");
  await ctx.delete(WARDROBE, clothing.id);
  return { ok: true };
}
