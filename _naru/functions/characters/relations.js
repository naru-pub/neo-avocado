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
export function relation(
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
  if (!ownCharacter(ctx, character)) return failure("not_owned");
  const targetCharacter =
    typeof target === "string" ? ctx.get(CHARACTERS, target) : null;
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
  const previous = id ? ctx.get(RELATIONS, id) : null;
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
      ? ctx.set(RELATIONS, id, data)
      : ctx.add(RELATIONS, data),
  };
}

export function removeRelation(ctx, { id } = {}) {
  const row = typeof id === "string" ? ctx.get(RELATIONS, id) : null;
  if (
    !row ||
    row.data.owner !== ctx.member.id ||
    !ownCharacter(ctx, row.data.character)
  )
    return failure("not_owned");
  ctx.delete(RELATIONS, row.id);
  return { ok: true };
}
