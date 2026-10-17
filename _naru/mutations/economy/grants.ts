// The owner's grants: money, experience and items, to one or to everyone.
import {
  amount,
  communitySettings,
  ownerOnly,
  text,
} from "../../modules/access.js";
import { itemById } from "../../modules/economy.js";
import type { Item } from "../../modules/economy.js";
import {
  characterState,
  saveState,
  withExp,
} from "../../modules/characters.js";
import type { CharacterRow } from "../../modules/characters.js";
import {
  addHistory,
  profileByNick,
  saveWallet,
  walletOf,
} from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/** The character named so, or null (adm/exp_update.php finds it by ch_name). */
async function characterNamed(
  ctx: MutationCtx,
  name: string,
): Promise<CharacterRow | null> {
  const { rows } = await ctx.sql<CharacterRow>(
    "SELECT * FROM characters WHERE name = ? ORDER BY id LIMIT 1",
    [text(name, 40, true)],
  );
  return rows[0] ?? null;
}

/** The members 전체지급 pays: not left (deleted), and above level 1. */
const PAID_MEMBERS = `FROM profiles
  LEFT JOIN members ON members.member = profiles.member
  LEFT JOIN wallets ON wallets.member = profiles.member
  WHERE profiles.deleted_at IS NULL AND coalesce(members.level, 2) != 1`;

/**
 * The owner's grants (adm/point_list.php's 화폐 관리, exp_list.php's 경험치
 * 관리, inventory_list.php's 아이템 지급): money to one member by nickname
 * or to every member, experience to one character by name or to every
 * approved character, more or less, with a memo each recipient's history
 * keeps; or 1 to 100 of an item to one character by name or to every
 * approved character. One call does it all.
 */
export const grant = ownerOnly(async function grant(
  ctx: MutationCtx,
  args: {
    kind?: "money" | "exp" | "item";
    /** One member or character by name, or everyone. */
    target?: "one" | "all";
    name?: string;
    /** How much, more (positive) or less (negative); of an item, how many. */
    value?: number;
    /** The item given, for `kind: "item"`. */
    item?: string;
    memo?: string;
  },
) {
  const { kind, target, name = "", value, memo = "", item } = args ?? {};
  if (
    !["money", "exp", "item"].includes(kind) ||
    !["one", "all"].includes(target) ||
    !Number.isSafeInteger(value) ||
    value === 0
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const note = text(memo ?? "", 200);
  if (kind === "item")
    return await grantItem(ctx, item, target, name, value, note);
  if (kind === "money") {
    if (target === "one") {
      const found = await profileByNick(ctx, text(name, 20, true));
      if (!found)
        ctx.fail("INVALID_REQUEST", "존재하는 회원이 아닙니다.", {
          reason: "no_member",
        });
      const balance = (await walletOf(ctx, found.id)).balance + value;
      // Taking more than they have is refused, as point_update.php does.
      if (balance < 0)
        ctx.fail("CONFLICT", "가진 것보다 많이 깎을 수 없습니다.", {
          reason: "not_enough",
        });
      await saveWallet(ctx, found.id, balance);
      await addHistory(ctx, {
        owner: found.id,
        kind: "adjust",
        at: ctx.now,
        delta: value,
        balance,
        memo: note,
        actor: "grant",
      });
      return { done: true, granted: 1, skipped: 0 };
    }
    // 전체지급 leaves out level-1 members (adm/point_update.php:18,
    // mb_level > 1); members are level 2 unless the owner says otherwise.
    // Whoever would go below nothing is skipped.
    const paid = `${PAID_MEMBERS} AND coalesce(wallets.balance, 0) + ? BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}`;
    const counts = (
      await ctx.sql<{ total: number; granted: number }>(
        `SELECT count(*) AS total, coalesce(sum(coalesce(wallets.balance, 0) + ? BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}), 0) AS granted ${PAID_MEMBERS}`,
        [value],
      )
    ).rows[0];
    await ctx.sql(
      `INSERT INTO history (owner, kind, at, delta, balance, memo, actor, details)
       SELECT profiles.member, 'adjust', ?, ?, coalesce(wallets.balance, 0) + ?, ?, 'grant', '{}'
       ${paid} ORDER BY profiles.member`,
      [ctx.now, value, value, note, value],
    );
    await ctx.sql(
      `INSERT INTO wallets (member, balance)
       SELECT profiles.member, coalesce(wallets.balance, 0) + ? ${paid}
       ON CONFLICT (member) DO UPDATE SET balance = excluded.balance`,
      [value, value],
    );
    return {
      done: true,
      granted: counts.granted,
      skipped: counts.total - counts.granted,
    };
  }
  if (target === "one") {
    const character = await characterNamed(ctx, name);
    if (!character)
      ctx.fail("INVALID_REQUEST", "존재하는 캐릭터가 아닙니다.", {
        reason: "no_character",
      });
    const current = await characterState(ctx, character.id);
    const exp = current.data.exp + value;
    if (exp < 0)
      ctx.fail("CONFLICT", "가진 것보다 많이 깎을 수 없습니다.", {
        reason: "not_enough",
      });
    await saveState(ctx, character.id, await withExp(ctx, current.data, exp));
    await addHistory(ctx, {
      owner: current.data.owner,
      kind: "exp",
      at: ctx.now,
      character: String(character.id),
      expDelta: value,
      exp,
      memo: note,
      actor: "grant",
    });
    return { done: true, granted: 1, skipped: 0 };
  }
  // 전체지급: every approved character (exp_update.php's ch_state = 승인),
  // but one that would go below none. Reaching a rank adds its bonus points
  // and falling below one takes them back (extend/exp.lib.php's insert_exp),
  // as withExp does for one.
  const counts = (
    await ctx.sql<{ total: number; granted: number }>(
      "SELECT count(*) AS total, coalesce(sum(exp + ? >= 0), 0) AS granted FROM characters WHERE state = 'approved'",
      [value],
    )
  ).rows[0];
  const initial = amount(
    (await communitySettings(ctx)).initialStatPoints ?? 0,
    "Initial stat points",
  );
  await ctx.sql(
    `INSERT INTO history (owner, kind, at, character_id, exp_delta, exp, memo, actor, details)
     SELECT owner, 'exp', ?, CAST(id AS TEXT), ?, exp + ?, ?, 'grant', '{}'
     FROM characters WHERE state = 'approved' AND exp + ? >= 0 ORDER BY id`,
    [ctx.now, value, value, note, value],
  );
  await ctx.sql(
    `UPDATE characters SET
       exp = exp + ?,
       points = max(0, coalesce(points, ?)
         + coalesce((SELECT sum(bonus_points) FROM levels WHERE exp <= characters.exp + ?), 0)
         - coalesce((SELECT sum(bonus_points) FROM levels WHERE exp <= characters.exp), 0)),
       version = version + 1
     WHERE state = 'approved' AND exp + ? >= 0`,
    [value, initial, value, value],
  );
  return {
    done: true,
    granted: counts.granted,
    skipped: counts.total - counts.granted,
  };
});

/**
 * 아이템 지급 (adm/inventory_update.php): `count` of an item, each its own
 * inventory row as insert_inventory makes them, to one character by name or
 * to every approved character (ch_state = 승인), with one history row each.
 */
async function grantItem(
  ctx: MutationCtx,
  id: unknown,
  target: "one" | "all",
  name: string,
  count: number,
  note: string,
) {
  if (count < 1 || count > 100)
    ctx.fail("INVALID_REQUEST", "지급할 개수는 1~100개입니다.", {
      reason: "invalid_input",
    });
  const listing: Item | null = await itemById(ctx, id);
  if (!listing)
    ctx.fail("INVALID_REQUEST", "해당 아이템의 정보가 없습니다.", {
      reason: "no_item",
    });
  if (target === "one") {
    const character = await characterNamed(ctx, name);
    if (!character)
      ctx.fail("INVALID_REQUEST", "존재하는 캐릭터가 아닙니다.", {
        reason: "no_character",
      });
    await ctx.sql(
      `INSERT INTO inventory (owner, item_id, name, origin, character_id)
       SELECT ?, ?, ?, 'admin', ? FROM json_each(?) ORDER BY json_each.key`,
      [
        character.owner,
        listing.id,
        listing.data.name,
        character.id,
        JSON.stringify(Array(count).fill(0)),
      ],
    );
    await addHistory(ctx, {
      owner: character.owner,
      kind: "grant",
      at: ctx.now,
      character: String(character.id),
      item: listing.id,
      name: listing.data.name,
      count,
      memo: note,
      actor: "grant",
    });
    return { done: true, granted: 1, skipped: 0 };
  }
  const { rows } = await ctx.sql<{
    n: number;
  }>`SELECT count(*) AS n FROM characters WHERE state = 'approved'`;
  await ctx.sql(
    `INSERT INTO inventory (owner, item_id, name, origin, character_id)
     SELECT characters.owner, ?, ?, 'admin', characters.id
     FROM json_each(?) AS copies CROSS JOIN characters
     WHERE characters.state = 'approved' ORDER BY characters.id, copies.key`,
    [listing.id, listing.data.name, JSON.stringify(Array(count).fill(0))],
  );
  await ctx.sql(
    `INSERT INTO history (owner, kind, at, character_id, item_id, memo, actor, details)
     SELECT owner, 'grant', ?, CAST(id AS TEXT), ?, ?, 'grant', json_object('name', ?, 'count', ?)
     FROM characters WHERE state = 'approved' ORDER BY id`,
    [ctx.now, listing.id, note, listing.data.name, count],
  );
  return { done: true, granted: rows[0].n, skipped: 0 };
}
