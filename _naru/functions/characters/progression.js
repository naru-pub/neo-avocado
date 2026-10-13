import {
  CHARACTERS,
  CHARACTER_STATE,
  LEVELS,
  TITLES,
  ownCharacter,
  failure,
  amount,
  weightedRows,
  characterState,
} from "../../modules/shared.js";

/** Public character progression is separate from member-editable profile fields. */
export function characterStatus(ctx, { character } = {}) {
  const profile =
    typeof character === "string" ? ctx.get(CHARACTERS, character) : null;
  if (!profile || profile.data.deleted) return failure("no_character");
  const state = characterState(
    ctx,
    character,
    profile.createdBy ?? profile.data.owner ?? null,
  );
  const levels = weightedRows(ctx, LEVELS)
    .filter((row) => {
      amount(row.data.exp, "Rank experience");
      return row.data.exp <= state.data.exp;
    })
    .sort((a, b) => b.data.exp - a.data.exp || a.id.localeCompare(b.id));
  return {
    ok: true,
    state: Object.fromEntries(
      Object.entries(state.data).filter(([key]) => key !== "purchases"),
    ),
    revision: state.existing?.revision ?? null,
    definitions: state.definitions,
    rank: levels[0]?.data.name ?? "",
  };
}

export function allocateStats(
  ctx,
  { character, allocation, revision = null } = {},
) {
  if (!ownCharacter(ctx, character)) return failure("not_owned");
  if (
    !allocation ||
    Array.isArray(allocation) ||
    typeof allocation !== "object"
  )
    return failure("invalid_input");
  const state = characterState(ctx, character);
  if ((state.existing?.revision ?? null) !== revision)
    return failure("conflict");
  if (
    Object.keys(allocation).length !== state.definitions.length ||
    state.definitions.some((row) => !Object.hasOwn(allocation, row.id))
  )
    return failure("invalid_input");
  const stats = {};
  let spent = 0;
  for (const definition of state.definitions) {
    const count = amount(allocation[definition.id], "Allocation");
    spent += count;
    const before = state.data.stats[definition.id];
    const max = (definition.data.initial ?? 0) + count;
    if (!Number.isSafeInteger(max) || max > (definition.data.max ?? 999))
      return failure("invalid_input");
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
    return failure("not_enough_points");
  const document = ctx.set(CHARACTER_STATE, character, {
    ...state.data,
    stats,
  });
  return { ok: true, document };
}

export function equipTitle(ctx, { character, title = null } = {}) {
  if (!ownCharacter(ctx, character)) return failure("not_owned");
  const state = characterState(ctx, character);
  if (
    title !== null &&
    (typeof title !== "string" ||
      !state.data.titles?.includes(title) ||
      !ctx.get(TITLES, title) ||
      ctx.get(TITLES, title)?.data.deleted)
  )
    return failure("missing_title");
  return {
    ok: true,
    document: ctx.set(CHARACTER_STATE, character, {
      ...state.data,
      activeTitle: title,
    }),
  };
}
