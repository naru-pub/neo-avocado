import {
  CHARACTERS,
  CHARACTER_STATE,
  LEVELS,
  TITLES,
  ownCharacter,
  amount,
  weightedRows,
  characterState,
} from "../../modules/shared.js";

export const readOnly = ["characterStatus"];

/** Public character progression is separate from member-editable profile fields. */
export async function characterStatus(ctx, { character } = {}) {
  const profile =
    typeof character === "string" ? await ctx.get(CHARACTERS, character) : null;
  if (!profile || profile.data.deleted)
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const state = await characterState(
    ctx,
    character,
    profile.createdBy ?? profile.data.owner ?? null,
  );
  const levels = (await weightedRows(ctx, LEVELS))
    .filter((row) => {
      amount(row.data.exp, "Rank experience");
      return row.data.exp <= state.data.exp;
    })
    .sort((a, b) => b.data.exp - a.data.exp || a.id.localeCompare(b.id));
  return {
    state: Object.fromEntries(
      Object.entries(state.data).filter(([key]) => key !== "purchases"),
    ),
    revision: state.existing?.revision ?? null,
    definitions: state.definitions,
    rank: levels[0]?.data.name ?? "",
  };
}

export async function allocateStats(
  ctx,
  { character, allocation, revision = null } = {},
) {
  if (!(await ownCharacter(ctx, character)))
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  if (
    !allocation ||
    Array.isArray(allocation) ||
    typeof allocation !== "object"
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const state = await characterState(ctx, character);
  if ((state.existing?.revision ?? null) !== revision)
    ctx.fail(
      "CONFLICT",
      "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
      { reason: "conflict" },
    );
  if (
    Object.keys(allocation).length !== state.definitions.length ||
    state.definitions.some((row) => !Object.hasOwn(allocation, row.id))
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const stats = {};
  let spent = 0;
  for (const definition of state.definitions) {
    const count = amount(allocation[definition.id], "Allocation");
    spent += count;
    const before = state.data.stats[definition.id];
    const max = (definition.data.initial ?? 0) + count;
    if (!Number.isSafeInteger(max) || max > (definition.data.max ?? 999))
      ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
        reason: "invalid_input",
      });
    // Reallocation preserves damage, so reducing and raising a stat is not healing.
    const damage = before.damage;
    stats[definition.id] = {
      allocated: count,
      max,
      damage,
      current: Math.max(0, max - damage),
    };
  }
  if (!Number.isSafeInteger(spent) || spent > state.data.points)
    ctx.fail("CONFLICT", "배분할 능력치 포인트가 모자랍니다.", {
      reason: "not_enough_points",
    });
  const document = await ctx.set(CHARACTER_STATE, character, {
    ...state.data,
    stats,
  });
  return { document };
}

export async function equipTitle(ctx, { character, title = null } = {}) {
  if (!(await ownCharacter(ctx, character)))
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const state = await characterState(ctx, character);
  if (
    title !== null &&
    (typeof title !== "string" ||
      !state.data.titles?.includes(title) ||
      !(await ctx.get(TITLES, title)) ||
      (await ctx.get(TITLES, title))?.data.deleted)
  )
    ctx.fail("CONFLICT", "필요한 타이틀이 없습니다.", {
      reason: "missing_title",
    });
  return {
    document: await ctx.set(CHARACTER_STATE, character, {
      ...state.data,
      activeTitle: title,
    }),
  };
}
