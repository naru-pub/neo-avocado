// 옷장 (mypage/character/closet.php): a character's outfits, each a 전신,
// and the one it wears.
import { imageUrl, signedIn, text } from "../../modules/access.js";
import type { CharacterRow } from "../../modules/characters.js";
import {
  characterKey,
  ownCharacter,
  presentCharacter,
} from "../../modules/characters.js";
import type { MutationCtx } from "../../modules/naru-types.js";
import type { OutfitRow } from "../../modules/relations.js";
import { outfitOf } from "../../modules/relations.js";

function notOwned(ctx: MutationCtx): never {
  return ctx.fail("ACCESS_DENIED", "내 캐릭터만 바꿀 수 있습니다.", {
    reason: "not_owned",
  });
}

/** One of the caller's outfits, or null. */
async function ownOutfit(ctx: MutationCtx, id: unknown) {
  const key = characterKey(id);
  if (key === null || !ctx.member) return null;
  const row = (
    await ctx.sql<OutfitRow>`SELECT * FROM wardrobe WHERE id = ${key}`
  ).rows[0];
  return row?.owner === ctx.member.id ? row : null;
}

export async function outfit(
  ctx: MutationCtx,
  {
    character,
    name,
    image,
  }: { character?: string; name?: string; image?: string } = {},
) {
  const owned = await ownCharacter(ctx, character);
  if (!owned) notOwned(ctx);
  const { rows } = await ctx.sql<OutfitRow>`
    INSERT INTO wardrobe (owner, character_id, name, image)
    VALUES (${signedIn(ctx)}, ${owned.id}, ${text(name, 80, true)}, ${imageUrl(image)})
    RETURNING *`;
  return { document: outfitOf(rows[0]) };
}

/**
 * Renames an outfit or changes its picture's address, as the closet's
 * address update (mypage/character/cloest_path_update.php).
 */
export async function editOutfit(
  ctx: MutationCtx,
  { id, name, image }: { id?: string; name?: string; image?: string } = {},
) {
  const clothing = await ownOutfit(ctx, id);
  if (!clothing || !(await ownCharacter(ctx, clothing.character_id)))
    notOwned(ctx);
  const { rows } = await ctx.sql<OutfitRow>`
    UPDATE wardrobe SET name = ${text(name, 80, true)}, image = ${imageUrl(image)}
    WHERE id = ${clothing.id} RETURNING *`;
  return { document: outfitOf(rows[0]) };
}

export async function wear(
  ctx: MutationCtx,
  { character, outfit }: { character?: string; outfit?: string | null } = {},
) {
  const owned = await ownCharacter(ctx, character);
  if (!owned) notOwned(ctx);
  const clothing = outfit === null ? null : await ownOutfit(ctx, outfit);
  if (outfit !== null && clothing?.character_id !== owned.id) notOwned(ctx);
  const { rows } = await ctx.sql<CharacterRow>`
    UPDATE characters SET outfit = ${clothing?.id ?? null}, version = version + 1
    WHERE id = ${owned.id} RETURNING *`;
  return { document: await presentCharacter(ctx, rows[0]) };
}

export async function removeOutfit(
  ctx: MutationCtx,
  { id }: { id?: string } = {},
) {
  const clothing = await ownOutfit(ctx, id);
  if (!clothing) notOwned(ctx);
  const character = await ownCharacter(ctx, clothing.character_id);
  if (!character) notOwned(ctx);
  if (character.outfit === clothing.id)
    ctx.fail("CONFLICT", "사용 중인 의상은 먼저 기본 전신으로 바꿔 주세요.", {
      reason: "outfit_in_use",
    });
  await ctx.sql`DELETE FROM wardrobe WHERE id = ${clothing.id}`;
  return null;
}
