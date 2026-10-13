import { PROFILES, ownCharacter, failure } from "../../modules/shared.js";

export function mainCharacter(ctx, { character } = {}) {
  if (!ownCharacter(ctx, character)) return failure("not_owned");
  const profile = ctx.get(PROFILES, ctx.member.id);
  if (!profile) return failure("no_profile");
  return {
    ok: true,
    document: ctx.set(PROFILES, profile.id, {
      ...profile.data,
      mainCharacter: character,
    }),
  };
}
