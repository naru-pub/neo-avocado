import {
  CHARACTERS,
  CHARACTER_STATE,
  INVENTORY,
  ITEMS,
  characterState,
  text,
  withExp,
} from "../../modules/shared.js";
import {
  addHistory,
  profileByNick,
  saveWallet,
  walletOf,
} from "../../modules/members.js";
import type { Ctx, NaruDocument } from "../../modules/naru-types.js";

/** Members given money a call, when it goes to everyone. */
const MONEY_PAGE = 10;

/** Inventory rows and history a call writes, inside its write budget. */
const ITEM_WRITES = 20;

/**
 * The owner's grants (adm/point_list.php's 화폐 관리, exp_list.php's 경험치
 * 관리, inventory_list.php's 아이템 지급): money to one member by nickname
 * or to every member, experience to one character by name or to every
 * approved character, more or less, with a memo each recipient's history
 * keeps; or 1 to 100 of an item to one character by name or to every
 * approved character. A grant to everyone, and a large item grant, goes a
 * part at a time inside a call's write budget: call again with `after` until
 * it answers `done`.
 */
export async function grant(
  ctx: Ctx,
  {
    kind,
    target,
    name = "",
    value,
    memo = "",
    after = null,
    item,
  }: {
    kind?: "money" | "exp" | "item";
    /** One member or character by name, or everyone. */
    target?: "one" | "all";
    name?: string;
    /** How much, more (positive) or less (negative); of an item, how many. */
    value?: number;
    /** The item given, for `kind: "item"`. */
    item?: string;
    memo?: string;
    after?: string | null;
  } = {},
) {
  if (!ctx.owner)
    ctx.fail("ACCESS_DENIED", "사이트 운영자만 지급할 수 있습니다.", {
      reason: "owner_only",
    });
  if (
    !["money", "exp", "item"].includes(kind) ||
    !["one", "all"].includes(target) ||
    !Number.isSafeInteger(value) ||
    value === 0 ||
    (after !== null && typeof after !== "string")
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const note = text(memo ?? "", 200);
  if (kind === "item")
    return await grantItem(ctx, item, target, name, value, note, after);
  if (kind === "money") {
    const give = async (member: string) => {
      const balance = (await walletOf(ctx, member)).balance + value;
      // Taking more than they have is refused, as point_update.php does.
      if (balance < 0) return false;
      await saveWallet(ctx, member, balance);
      await addHistory(ctx, {
        owner: member,
        kind: "adjust",
        at: ctx.now,
        delta: value,
        balance,
        memo: note,
        actor: "grant",
      });
      return true;
    };
    if (target === "one") {
      const found = await profileByNick(ctx, text(name, 20, true));
      if (!found)
        ctx.fail("INVALID_REQUEST", "존재하는 회원이 아닙니다.", {
          reason: "no_member",
        });
      if (!(await give(found.id)))
        ctx.fail("CONFLICT", "가진 것보다 많이 깎을 수 없습니다.", {
          reason: "not_enough",
        });
      return { done: true, granted: 1, skipped: 0 };
    }
    const { rows } = await ctx.sql<{ member: string; level: number | null }>`
      SELECT profiles.member, members.level FROM profiles
      LEFT JOIN members ON members.member = profiles.member
      WHERE profiles.deleted_at IS NULL AND profiles.member > ${after ?? ""}
      ORDER BY profiles.member LIMIT ${MONEY_PAGE + 1}`;
    const page = rows.slice(0, MONEY_PAGE);
    const next = rows.length > MONEY_PAGE ? page.at(-1).member : null;
    let granted = 0;
    let excluded = 0;
    for (const row of page) {
      // 전체지급 leaves out level-1 members (adm/point_update.php:18,
      // mb_level > 1); members are level 2 unless the owner says otherwise.
      if (row.level === 1) excluded += 1;
      else if (await give(row.member)) granted += 1;
    }
    return {
      done: !next,
      after: next,
      granted,
      skipped: page.length - granted - excluded,
    };
  }
  const give = async (character: NaruDocument) => {
    const current = await characterState(
      ctx,
      character.id,
      character.createdBy ?? character.data.owner,
    );
    const exp = (current.data.exp ?? 0) + value;
    if (exp < 0) return false;
    await ctx.set(
      CHARACTER_STATE,
      character.id,
      await withExp(ctx, current.data, exp),
    );
    await addHistory(ctx, {
      owner: current.data.owner ?? character.data.owner,
      kind: "exp",
      at: ctx.now,
      character: character.id,
      expDelta: value,
      exp,
      memo: note,
      actor: "grant",
    });
    return true;
  };
  if (target === "one") {
    const { documents } = await ctx.list(CHARACTERS, {
      where: {
        all: [
          { eq: ["name", text(name, 40, true)] },
          { ne: ["deleted", true] },
        ],
      },
      size: 1,
    });
    if (!documents[0])
      ctx.fail("INVALID_REQUEST", "존재하는 캐릭터가 아닙니다.", {
        reason: "no_character",
      });
    if (!(await give(documents[0])))
      ctx.fail("CONFLICT", "가진 것보다 많이 깎을 수 없습니다.", {
        reason: "not_enough",
      });
    return { done: true, granted: 1, skipped: 0 };
  }
  // 전체지급: every approved character (exp_update.php's ch_state = 승인).
  const page = await ctx.list(CHARACTERS, {
    where: {
      all: [{ eq: ["state", "approved"] }, { ne: ["deleted", true] }],
    },
    size: 8,
    after,
  });
  let granted = 0;
  for (const character of page.documents)
    if (await give(character)) granted += 1;
  return {
    done: !page.nextCursor,
    after: page.nextCursor,
    granted,
    skipped: page.documents.length - granted,
  };
}

/**
 * 아이템 지급 (adm/inventory_update.php): `count` of an item, each its own
 * inventory row as insert_inventory makes them, to one character by name or
 * to every approved character (ch_state = 승인). `after` is how many the
 * character being given to already has, and where the list of characters
 * stands: "given:cursor".
 */
async function grantItem(
  ctx: Ctx,
  id: unknown,
  target: "one" | "all",
  name: string,
  count: number,
  note: string,
  after: string | null,
) {
  const listing = typeof id === "string" ? await ctx.get(ITEMS, id) : null;
  const resumed = after === null ? null : /^(\d{1,3}):(.*)$/s.exec(after);
  if (
    count < 1 ||
    count > 100 ||
    (after !== null &&
      (!resumed ||
        Number(resumed[1]) >= count ||
        (target === "one" && resumed[2])))
  )
    ctx.fail("INVALID_REQUEST", "지급할 개수는 1~100개입니다.", {
      reason: "invalid_input",
    });
  if (!listing)
    ctx.fail("INVALID_REQUEST", "해당 아이템의 정보가 없습니다.", {
      reason: "no_item",
    });
  let given = resumed ? Number(resumed[1]) : 0;
  let at = resumed?.[2] || null;
  let writes = ITEM_WRITES;
  let granted = 0;
  /** Gives what the budget allows; true once the character has them all. */
  const give = async (character: NaruDocument) => {
    const owner = character.createdBy ?? character.data.owner;
    while (given < count && writes > 1) {
      await ctx.add(INVENTORY, {
        owner,
        item: listing.id,
        name: listing.data.name,
        from: "admin",
        character: character.id,
      });
      given += 1;
      writes -= 1;
    }
    if (given < count) return false;
    await addHistory(ctx, {
      owner,
      kind: "grant",
      at: ctx.now,
      character: character.id,
      item: listing.id,
      name: listing.data.name,
      count,
      memo: note,
      actor: "grant",
    });
    writes -= 1;
    granted += 1;
    given = 0;
    return true;
  };
  if (target === "one") {
    const { documents } = await ctx.list(CHARACTERS, {
      where: {
        all: [
          { eq: ["name", text(name, 40, true)] },
          { ne: ["deleted", true] },
        ],
      },
      size: 1,
    });
    if (!documents[0])
      ctx.fail("INVALID_REQUEST", "존재하는 캐릭터가 아닙니다.", {
        reason: "no_character",
      });
    return (await give(documents[0]))
      ? { done: true, granted, skipped: 0 }
      : { done: false, after: `${given}:`, granted, skipped: 0 };
  }
  for (;;) {
    const page = await ctx.list(CHARACTERS, {
      where: {
        all: [{ eq: ["state", "approved"] }, { ne: ["deleted", true] }],
      },
      size: 1,
      after: at,
    });
    if (!page.documents[0]) return { done: true, granted, skipped: 0 };
    if (!(await give(page.documents[0])))
      return {
        done: false,
        after: `${given}:${at ?? ""}`,
        granted,
        skipped: 0,
      };
    at = page.nextCursor;
    if (!at) return { done: true, granted, skipped: 0 };
    if (writes < 2)
      return { done: false, after: `0:${at}`, granted, skipped: 0 };
  }
}
