// Notifications in the Naru app (SDK 1.1.0's ctx.notify): a 쪽지, a call or a
// comment notice also reaches the member's phone or Mac, once the mutation
// that wrote it returns. Whether it shows there is the member's choice in the
// app; the site is not told who has it.
import type { MutationCtx } from "./naru-types.js";

export type PushCtx = Pick<MutationCtx, "notify">;

/** Tells `members` of `title` (and `body`), opening `path` when tapped. */
export async function push(
  ctx: PushCtx,
  members: string[],
  { title, body = "", path }: { title: string; body?: string; path: string },
) {
  if (!members.length) return;
  // Naru takes a title of 1–100 characters and a body of at most 500.
  await ctx.notify(members, {
    title: title.slice(0, 100),
    body: body.slice(0, 500),
    path,
  });
}
