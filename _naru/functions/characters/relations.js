import {
  CHARACTERS,
  RELATIONS,
  ownCharacter,
  text,
  imageUrl,
  failure,
  amount,
} from "../../modules/shared.js";

/** A relation belongs to the source character; the target's owner cannot edit it. */
export async function relation(
  ctx,
  {
    id,
    character,
    target,
    affinity = 0,
    memo = "",
    link = "",
    order = 0,
    revision,
  } = {},
) {
  if (!(await ownCharacter(ctx, character))) return failure("not_owned");
  const targetCharacter =
    typeof target === "string" ? await ctx.get(CHARACTERS, target) : null;
  if (
    typeof target !== "string" ||
    target === character ||
    !targetCharacter ||
    targetCharacter.data.deleted
  )
    return failure("no_character");
  if (!Number.isInteger(affinity) || affinity < -100 || affinity > 100)
    return failure("invalid_input");
  amount(order, "Relation order");
  const previous = id ? await ctx.get(RELATIONS, id) : null;
  if (
    id &&
    (!previous ||
      previous.data.owner !== ctx.member.id ||
      previous.data.character !== character)
  )
    return failure("not_owned");
  if (previous && previous.revision !== revision) return failure("conflict");
  const data = {
    owner: ctx.member.id,
    character,
    target,
    affinity,
    memo: text(memo, 2000),
    link: link ? imageUrl(link) : "",
    order,
  };
  return {
    ok: true,
    document: previous
      ? await ctx.set(RELATIONS, id, data)
      : await ctx.add(RELATIONS, data),
  };
}

export async function removeRelation(ctx, { id } = {}) {
  const row = typeof id === "string" ? await ctx.get(RELATIONS, id) : null;
  if (
    !row ||
    row.data.owner !== ctx.member.id ||
    !(await ownCharacter(ctx, row.data.character))
  )
    return failure("not_owned");
  await ctx.delete(RELATIONS, row.id);
  return { ok: true };
}
