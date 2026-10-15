import { PROFILES, ownCharacter } from "../../modules/shared.js";

export async function mainCharacter(ctx, { character } = {}) {
  if (!(await ownCharacter(ctx, character)))
    ctx.fail("ACCESS_DENIED", "내 캐릭터만 대표로 정할 수 있습니다.", {
      reason: "not_owned",
    });
  const profile = await ctx.get(PROFILES, ctx.member.id);
  if (!profile)
    ctx.fail("CONFLICT", "먼저 닉네임을 등록해 주세요.", {
      reason: "no_profile",
    });
  return {
    document: await ctx.set(PROFILES, profile.id, {
      ...profile.data,
      mainCharacter: character,
    }),
  };
}
