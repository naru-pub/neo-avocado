import {
  CHARACTERS,
  WARDROBE,
  ownCharacter,
  text,
  imageUrl,
} from "../../modules/shared.js";
import { presentCharacter } from "../../modules/characters.js";

export async function outfit(ctx, { character, name, image } = {}) {
  if (!(await ownCharacter(ctx, character)))
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const document = await ctx.add(WARDROBE, {
    owner: ctx.member.id,
    character,
    name: text(name, 80, true),
    image: imageUrl(image),
  });
  return { document };
}

export async function wear(ctx, { character, outfit } = {}) {
  const owned = await ownCharacter(ctx, character);
  if (!owned)
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const clothing =
    typeof outfit === "string" ? await ctx.get(WARDROBE, outfit) : null;
  if (
    outfit !== null &&
    (!clothing ||
      clothing.data.owner !== ctx.member.id ||
      clothing.data.character !== character)
  )
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const document = await ctx.set(CHARACTERS, owned.id, {
    ...owned.data,
    outfit: clothing?.id ?? null,
  });
  return { document: await presentCharacter(ctx, document) };
}

export async function removeOutfit(ctx, { id } = {}) {
  const clothing = typeof id === "string" ? await ctx.get(WARDROBE, id) : null;
  if (!clothing || clothing.data.owner !== ctx.member.id)
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const character = await ownCharacter(ctx, clothing.data.character);
  if (!character)
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  if (character.data.outfit === clothing.id)
    ctx.fail("CONFLICT", "사용 중인 의상은 먼저 기본 두상으로 바꿔 주세요.", {
      reason: "outfit_in_use",
    });
  await ctx.delete(WARDROBE, clothing.id);
  return null;
}
