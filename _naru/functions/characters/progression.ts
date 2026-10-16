import {
  CHARACTERS,
  CHARACTER_STATE,
  HISTORY,
  INVENTORY,
  ITEMS,
  SETTINGS,
  WALLETS,
  LEVELS,
  TITLES,
  ownCharacter,
  amount,
  weightedRows,
  characterState,
  siteOpen,
} from "../../modules/shared.js";
import type { Ctx } from "../../modules/naru-types.js";

export const readOnly = ["characterStatus", "characterSheet"];
// The character viewer (member/viewer.php) is open to visitors while the site
// is (사이트공개); a closed site sends them to log in.
export const visitors = ["characterStatus", "characterSheet"];

/** Refuses a visitor while the site is closed (extend/community.config.php). */
async function viewable(ctx: Ctx) {
  if (!ctx.member && !(await siteOpen(ctx)))
    ctx.fail("ACCESS_DENIED", "회원 로그인 후 이용할 수 있습니다.", {
      reason: "site_closed",
    });
}

/** Experience history rows a page (member/exp.php's cf_page_rows). */
const EXP_PAGE = 20;

/**
 * What the character viewer (member/viewer.php) adds to the profile: the
 * character's experience history (member/exp.php) a page at a time, newest
 * first, and, where the owner turns them on (ad_use_inven, ad_use_money), its
 * inventory and its owner's money. A later page (`after`, the `expCursor`
 * of the one before) carries only the history.
 */
export async function characterSheet(
  ctx: Ctx,
  {
    character,
    after = null,
    size = EXP_PAGE,
  }: { character?: string; after?: string | null; size?: number } = {},
) {
  await viewable(ctx);
  if (
    (after !== null && typeof after !== "string") ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 50
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const profile =
    typeof character === "string" ? await ctx.get(CHARACTERS, character) : null;
  if (!profile || profile.data.deleted)
    ctx.fail("NOT_FOUND", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const owner = profile.createdBy ?? profile.data.owner ?? null;
  const settings = (await ctx.get(SETTINGS, "community"))?.data ?? {};
  const page = await ctx.list(HISTORY, {
    filter: { kind: "exp", character },
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size,
    after,
  });
  const exp = page.documents.map((row) => ({
    at: row.data.at,
    delta: row.data.expDelta,
    exp: row.data.exp,
    memo: row.data.memo ?? "",
  }));
  const expCursor = page.nextCursor ?? null;
  if (after !== null) return { exp, expCursor };
  let inventory = null;
  if (settings.viewerInventory === true) {
    const rows = (
      await ctx.list(INVENTORY, { filter: { character }, size: 100 })
    ).documents;
    const items = await ctx.getMany(ITEMS, [
      ...new Set(rows.map((row) => row.data.item).filter(Boolean)),
    ]);
    inventory = rows.map((row) => {
      const item = items.find((entry) => entry?.id === row.data.item);
      return {
        name: row.data.name ?? item?.data.name ?? "",
        image: item?.data.image ?? null,
      };
    });
  }
  const balance =
    settings.viewerMoney === true && owner
      ? ((await ctx.get(WALLETS, owner))?.data.balance ?? 0)
      : null;
  return { exp, expCursor, inventory, balance };
}

/** Public character progression is separate from member-editable profile fields. */
export async function characterStatus(
  ctx: Ctx,
  { character }: { character?: string } = {},
) {
  await viewable(ctx);
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
  ctx: Ctx,
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
    // An approved character only spends what is left: no stat goes below
    // what it has (mypage/character/status.inc.php's status_fix).
    if (state.data.approved === true && count < before.allocated)
      ctx.fail(
        "CONFLICT",
        "승인된 캐릭터는 남은 포인트만 배분할 수 있고, 배분한 능력치를 줄일 수 없습니다.",
        { reason: "approved_stats" },
      );
    const max = (definition.data.initial ?? 0) + count;
    if (!Number.isSafeInteger(max) || max > (definition.data.max ?? 999))
      ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
        reason: "invalid_input",
      });
    // st_min: a stat starts no lower than the owner's minimum.
    if (max < (definition.data.min ?? 0))
      ctx.fail(
        "INVALID_REQUEST",
        `${definition.data.name ?? definition.id}은(는) ${definition.data.min} 이상이어야 합니다.`,
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
  const document = await ctx.set(CHARACTER_STATE, character, {
    ...state.data,
    stats,
  });
  return { document };
}

export async function equipTitle(
  ctx: Ctx,
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
  const row = typeof title === "string" ? await ctx.get(TITLES, title) : null;
  // A title out of use (ti_use) cannot be shown either.
  if (
    title !== null &&
    (!row ||
      !state.data.titles?.includes(title) ||
      row.data.deleted ||
      row.data.enabled === false)
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
