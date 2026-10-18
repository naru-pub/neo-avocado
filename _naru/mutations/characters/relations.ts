import { amount, imageUrl, text, invalid } from "../../modules/access.js";
import {
  characterKey,
  characterRow,
  ownCharacter,
} from "../../modules/characters.js";
import { relationOf } from "../../modules/relations.js";
import type { RelationRow } from "../../modules/relations.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/** Links a relation may list, one per line (rm_link). */
const MAX_LINKS = 10;

const notOwned = (ctx: MutationCtx) =>
  ctx.fail("ACCESS_DENIED", "내 캐릭터만 바꿀 수 있습니다.", {
    reason: "not_owned",
  });

/**
 * A relation belongs to the source character; the target's owner cannot
 * edit it. Only an approved character has relations, its affinity is 0 to 5
 * hearts and its links are addresses one per line
 * (mypage/character/viewer.php:157-196, relation_list.php:31-58).
 */
export async function relation(
  ctx: MutationCtx,
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
  if (!source) notOwned(ctx);
  if (source.state !== "approved")
    ctx.fail("CONFLICT", "승인된 캐릭터만 관계를 등록할 수 있습니다.", {
      reason: "not_approved",
    });
  const other = await characterRow(ctx, target);
  if (!other || other.id === source.id)
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  if (!Number.isInteger(affinity) || affinity < 0 || affinity > 5) invalid(ctx);
  amount(order, "Relation order");
  const links = text(link ?? "", 2000)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (links.length > MAX_LINKS)
    ctx.fail("INVALID_REQUEST", `관계 링크는 ${MAX_LINKS}개까지입니다.`, {
      reason: "invalid_input",
    });
  const values = [
    affinity,
    text(memo, 2000),
    links.map((line) => imageUrl(line)).join("\n"),
    order,
    other.id,
  ];
  if (id) {
    const key = characterKey(id);
    const previous =
      key === null
        ? null
        : (
            await ctx.sql<RelationRow>`SELECT * FROM relations WHERE id = ${key}`
          ).rows[0];
    if (
      !previous ||
      previous.owner !== ctx.member.id ||
      previous.character_id !== source.id
    )
      notOwned(ctx);
    if (String(previous.version) !== String(revision))
      ctx.fail(
        "CONFLICT",
        "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
        { reason: "conflict" },
      );
    const { rows } = await ctx.sql<RelationRow>(
      "UPDATE relations SET affinity = ?, memo = ?, link = ?, sort_order = ?, target = ?, version = version + 1 WHERE id = ? RETURNING *",
      [...values, previous.id],
    );
    return { document: relationOf(rows[0]) };
  }
  const { rows } = await ctx.sql<RelationRow>(
    "INSERT INTO relations (affinity, memo, link, sort_order, target, owner, character_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
    [...values, ctx.member.id, source.id, ctx.now],
  );
  return { document: relationOf(rows[0]) };
}

export async function removeRelation(
  ctx: MutationCtx,
  { id }: { id?: string } = {},
) {
  const key = characterKey(id);
  const row =
    key === null
      ? null
      : (await ctx.sql<RelationRow>`SELECT * FROM relations WHERE id = ${key}`)
          .rows[0];
  if (
    !row ||
    row.owner !== ctx.member?.id ||
    !(await ownCharacter(ctx, row.character_id))
  )
    notOwned(ctx);
  await ctx.sql`DELETE FROM relations WHERE id = ${row.id}`;
  return null;
}
