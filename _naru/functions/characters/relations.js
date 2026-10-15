import {
  CHARACTERS,
  RELATIONS,
  ownCharacter,
  text,
  imageUrl,
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
  if (!(await ownCharacter(ctx, character)))
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const targetCharacter =
    typeof target === "string" ? await ctx.get(CHARACTERS, target) : null;
  if (
    typeof target !== "string" ||
    target === character ||
    !targetCharacter ||
    targetCharacter.data.deleted
  )
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  if (!Number.isInteger(affinity) || affinity < -100 || affinity > 100)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  amount(order, "Relation order");
  const previous = id ? await ctx.get(RELATIONS, id) : null;
  if (
    id &&
    (!previous ||
      previous.data.owner !== ctx.member.id ||
      previous.data.character !== character)
  )
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  if (previous && previous.revision !== revision)
    ctx.fail(
      "CONFLICT",
      "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
      { reason: "conflict" },
    );
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
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  await ctx.delete(RELATIONS, row.id);
  return null;
}
