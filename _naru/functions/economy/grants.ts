import {
  CHARACTERS,
  CHARACTER_STATE,
  HISTORY,
  PROFILES,
  WALLETS,
  characterState,
  text,
  withExp,
} from "../../modules/shared.js";
import type { Ctx, NaruDocument } from "../../modules/naru-types.js";

/**
 * The owner's grants (adm/point_list.php's 화폐 관리, exp_list.php's 경험치
 * 관리): money to one member by nickname or to every member, experience to
 * one character by name or to every approved character, more or less, with
 * a memo each recipient's history keeps. A grant to everyone goes a page at
 * a time inside a call's write budget: call again with `after` until it
 * answers `done`.
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
  }: {
    kind?: "money" | "exp";
    /** One member or character by name, or everyone. */
    target?: "one" | "all";
    name?: string;
    /** How much, more (positive) or less (negative). */
    value?: number;
    memo?: string;
    after?: string | null;
  } = {},
) {
  if (!ctx.owner)
    ctx.fail("ACCESS_DENIED", "사이트 운영자만 지급할 수 있습니다.", {
      reason: "owner_only",
    });
  if (
    !["money", "exp"].includes(kind) ||
    !["one", "all"].includes(target) ||
    !Number.isSafeInteger(value) ||
    value === 0 ||
    (after !== null && typeof after !== "string")
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const note = text(memo ?? "", 200);
  if (kind === "money") {
    const give = async (profile: NaruDocument) => {
      const wallet = await ctx.get(WALLETS, profile.id);
      const balance = (wallet?.data.balance ?? 0) + value;
      // Taking more than they have is refused, as point_update.php does.
      if (balance < 0) return false;
      await ctx.set(WALLETS, profile.id, { ...wallet?.data, balance });
      await ctx.add(HISTORY, {
        owner: profile.id,
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
      const { documents } = await ctx.list(PROFILES, {
        filter: { nick: text(name, 20, true) },
        size: 1,
      });
      if (!documents[0])
        ctx.fail("INVALID_REQUEST", "존재하는 회원이 아닙니다.", {
          reason: "no_member",
        });
      if (!(await give(documents[0])))
        ctx.fail("CONFLICT", "가진 것보다 많이 깎을 수 없습니다.", {
          reason: "not_enough",
        });
      return { done: true, granted: 1, skipped: 0 };
    }
    const page = await ctx.list(PROFILES, {
      where: { ne: ["deleted", true] },
      size: 10,
      after,
    });
    let granted = 0;
    for (const profile of page.documents) if (await give(profile)) granted += 1;
    return {
      done: !page.nextCursor,
      after: page.nextCursor,
      granted,
      skipped: page.documents.length - granted,
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
    await ctx.add(HISTORY, {
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
