import {
  CHARACTERS,
  RELATIONS,
  ownCharacter,
  text,
  imageUrl,
  amount,
} from "../../modules/shared.js";
import { currentState } from "../../modules/characters.js";
import type { Ctx } from "../../modules/naru-types.js";

/** Links a relation may list, one per line (rm_link). */
const MAX_LINKS = 10;

/**
 * A relation belongs to the source character; the target's owner cannot
 * edit it. Only an approved character has relations, its affinity is 0 to 5
 * hearts and its links are addresses one per line
 * (mypage/character/viewer.php:157-196, relation_list.php:31-58).
 */
export async function relation(
  ctx: Ctx,
  {
    id,
    character,
    target,
    affinity = 0,
    memo = "",
    link = "",
    order = 0,
    revision,
  }: {
    id?: string;
    character?: string;
    target?: string;
    affinity?: number;
    memo?: string;
    link?: string;
    order?: number;
    revision?: string;
  } = {},
) {
  const source = await ownCharacter(ctx, character);
  if (!source)
    ctx.fail("ACCESS_DENIED", "내 캐릭터만 바꿀 수 있습니다.", {
      reason: "not_owned",
    });
  if ((await currentState(ctx, source)) !== "approved")
    ctx.fail("CONFLICT", "승인된 캐릭터만 관계를 등록할 수 있습니다.", {
      reason: "not_approved",
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
  if (!Number.isInteger(affinity) || affinity < 0 || affinity > 5)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  amount(order, "Relation order");
  const links = text(link ?? "", 2000)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (links.length > MAX_LINKS)
    ctx.fail("INVALID_REQUEST", `관계 링크는 ${MAX_LINKS}개까지입니다.`, {
      reason: "invalid_input",
    });
  const previous = id ? await ctx.get(RELATIONS, id) : null;
  if (
    id &&
    (!previous ||
      previous.data.owner !== ctx.member.id ||
      previous.data.character !== character)
  )
    ctx.fail("ACCESS_DENIED", "내 캐릭터만 바꿀 수 있습니다.", {
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
    link: links.map((line) => imageUrl(line)).join("\n"),
    order,
  };
  return {
    document: previous
      ? await ctx.set(RELATIONS, id, data)
      : await ctx.add(RELATIONS, data),
  };
}

export async function removeRelation(ctx: Ctx, { id }: { id?: string } = {}) {
  const row = typeof id === "string" ? await ctx.get(RELATIONS, id) : null;
  if (
    !row ||
    row.data.owner !== ctx.member.id ||
    !(await ownCharacter(ctx, row.data.character))
  )
    ctx.fail("ACCESS_DENIED", "내 캐릭터만 바꿀 수 있습니다.", {
      reason: "not_owned",
    });
  await ctx.delete(RELATIONS, row.id);
  return null;
}
