// What Naru answers the paths routes.json lists with, before the page loads:
// a board's RSS feed (bbs/rss.php) at /rss/<board>, and every other one
// index.html with its link preview (modules/previews.ts). What a path names
// is read in shared/places.ts, as the page's router reads it; a listed path
// that names nothing is 404.
import { page, type RouteInput } from "./modules/previews.js";
import { placeOf } from "./shared/places.js";
import { feed } from "./modules/rss.js";
import type { QueryCtx } from "./modules/naru-types.js";

export default async function route(ctx: QueryCtx, input: RouteInput) {
  const place = placeOf(input?.path ?? "/");
  return place?.kind === "rss"
    ? await feed(ctx, { ...input, params: { board: place.board } })
    : await page(ctx, input);
}
