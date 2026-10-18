// A member's own character's stats and shown title.
import { amount, invalid } from "../../modules/access.js";
import {
  characterState,
  checkRevision,
  ownCharacter,
  saveState,
  titleRow,
} from "../../modules/characters.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export async function allocateStats(
  ctx: MutationCtx,
  {
    character,
    allocation,
    revision = null,
  }: {
    character?: string;
    /** Points per stat, by stat ID. */
    allocation?: Record<string, number>;
    revision?: string | null;
  } = {},
) {
  if (!(await ownCharacter(ctx, character)))
    ctx.fail("ACCESS_DENIED", "내 캐릭터만 바꿀 수 있습니다.", {
      reason: "not_owned",
    });
  if (
    !allocation ||
    Array.isArray(allocation) ||
    typeof allocation !== "object"
  )
    invalid(ctx);
  const state = await characterState(ctx, character);
  checkRevision(ctx, state.existing, revision);
  if (
    Object.keys(allocation).length !== state.definitions.length ||
    state.definitions.some((row) => !Object.hasOwn(allocation, row.id))
  )
    invalid(ctx);
  const stats = {};
  let spent = 0;
  for (const definition of state.definitions) {
    const count = amount(allocation[definition.id], "Allocation");
    spent += count;
    const before = state.data.stats[definition.id];
    // An approved character only spends what is left: no stat goes below
    // what it has (mypage/character/status.inc.php's status_fix).
    if (state.data.approved && count < before.allocated)
      ctx.fail(
        "CONFLICT",
        "승인된 캐릭터는 남은 포인트만 배분할 수 있고, 배분한 능력치를 줄일 수 없습니다.",
        { reason: "approved_stats" },
      );
    const max = definition.data.initial + count;
    if (!Number.isSafeInteger(max) || max > definition.data.max) invalid(ctx);
    // st_min: a stat starts no lower than the owner's minimum.
    if (max < definition.data.min)
      ctx.fail(
        "INVALID_REQUEST",
        `${definition.data.name || definition.id}은(는) ${definition.data.min} 이상이어야 합니다.`,
        { reason: "below_minimum" },
      );
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
  const saved = await saveState(ctx, character, { ...state.data, stats });
  return { revision: String(saved.version) };
}

export async function equipTitle(
  ctx: MutationCtx,
  {
    character,
    title = null,
  }: { character?: string; title?: string | null } = {},
) {
  if (!(await ownCharacter(ctx, character)))
    ctx.fail("ACCESS_DENIED", "내 캐릭터만 바꿀 수 있습니다.", {
      reason: "not_owned",
    });
  const state = await characterState(ctx, character);
  const row = await titleRow(ctx, title);
  // A title out of use (ti_use) cannot be shown either.
  if (
    title !== null &&
    (!row || !state.data.titles.includes(title) || row.enabled === 0)
  )
    ctx.fail("CONFLICT", "필요한 타이틀이 없습니다.", {
      reason: "missing_title",
    });
  const saved = await saveState(ctx, character, {
    ...state.data,
    activeTitle: title,
  });
  return { revision: String(saved.version) };
}
