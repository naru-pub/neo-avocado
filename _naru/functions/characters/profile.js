import { PROFILES, ownCharacter, failure } from "../../modules/shared.js";

export async function mainCharacter(ctx, { character } = {}) {
  if (!(await ownCharacter(ctx, character))) return failure("not_owned");
  const profile = await ctx.get(PROFILES, ctx.member.id);
  if (!profile) return failure("no_profile");
  return {
    ok: true,
    document: await ctx.set(PROFILES, profile.id, {
      ...profile.data,
      mainCharacter: character,
    }),
  };
}
