// 캐릭터 경험치·능력치·타이틀 (adm/character_form.php's record, exp_list.php):
// the owner sets a character's experience, points, stat allocation and
// damage, and titles, checked against the stat definitions and the points
// (modules/admin-model.ts), at the version the form was opened at. A change
// of experience goes into its owner's history with the reason, in the same
// call. The record is the character's row: it is never made or deleted
// alone.

import { one, only, ownerOnly } from "../../modules/access.js";
import {
  checked,
  conflict,
  invalid,
  STATE_SELECT,
  stateOf,
} from "../../modules/admin.js";
import {
  characterKey,
  checkRevision,
  saveState,
} from "../../modules/characters.js";
import { addHistory } from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export const save = ownerOnly(async function save(
  ctx: MutationCtx,
  {
    id,
    values,
    revision = null,
    create = false,
  }: {
    id?: string;
    values?: Record<string, unknown>;
    revision?: string | null;
    create?: boolean;
  } = {},
) {
  const key = characterKey(id);
  if (key === null) invalid(ctx);
  const row = await one(ctx, `${STATE_SELECT} WHERE characters.id = ?`, [key]);
  if (create || !row) conflict(ctx);
  checkRevision(ctx, row as { version: number }, revision);
  const current = stateOf(row);
  const record = await checked(ctx, "character_state", {
    id: current.id,
    values,
    current,
  });
  await saveState(ctx, key, record.data);
  const before = current.data.exp ?? 0;
  const after = record.data.exp ?? 0;
  if (after !== before)
    await addHistory(ctx, {
      owner: current.data.owner,
      kind: "exp",
      at: ctx.now,
      character: current.id,
      expDelta: after - before,
      exp: after,
      memo: String((values as Record<string, unknown>).expNote ?? "").trim(),
      actor: "site-owner",
    });
  return stateOf(
    await only(ctx, `${STATE_SELECT} WHERE characters.id = ?`, [key]),
  );
});
