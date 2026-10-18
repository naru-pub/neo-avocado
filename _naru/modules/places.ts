// The site's addresses, read the same way by the page (app/router.ts) and by
// Naru's routes (previews.ts): what each one names, or null for none. A route
// answers 404 for a null; the page opens the home.
//
//   /                                   index
//   /home, /members, /new, …            a tab (SINGLE)
//   /post/<id>[/comment/<id>]           post
//   /logs                               logs
//   /logs/<board>[/page/<n>]            board, and its pages
//   /logs/<board>/category/<분류>[/page/<n>]
//   /logs/<board>/tag/<tag>, /search/<words>, /from/<number>
//   /logs/<board>/<number>              log: a post by its board's number
//   /messages[/<id>], /content[/<id>], /shop[/<분류>], /search[/<words>]
//   /character/<id>
//   /mypage[/logs|exp|favorites|money]
//   /rss/<board>                        a board's RSS feed (no page's)

/** Pages whose address is their name alone. */
export const SINGLE = [
  "home",
  "members",
  "applicants",
  "characters",
  "couples",
  "quests",
  "calls",
  "online",
  "new",
] as const;

/** 마이페이지's tabs, by the address's second part. */
export const MYPAGE_TABS = ["logs", "exp", "favorites", "money"] as const;

export type Place =
  | { kind: "index" }
  | { kind: (typeof SINGLE)[number] }
  | { kind: "post"; id: string; comment?: string }
  | { kind: "logs" }
  | {
      kind: "board";
      board: string;
      page?: string;
      category?: string;
      tag?: string;
      search?: string;
      from?: string;
    }
  | { kind: "log"; board: string; number: string }
  | { kind: "messages"; id?: string }
  | { kind: "character"; id: string }
  | { kind: "content"; id?: string }
  | { kind: "shop"; category?: string }
  | { kind: "search"; text?: string }
  | { kind: "mypage"; tab?: (typeof MYPAGE_TABS)[number] }
  | { kind: "rss"; board: string };

/** A whole positive number, as an address writes one. */
export const whole = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9]\d{0,14}$/.test(value);

/** The address's parts: "/logs/free/12" → ["logs", "free", "12"]. */
export function parts(path: string): string[] {
  return path
    .replace(/^\/+/, "")
    .replace(/(^|\/)index\.html$/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

/** What the address `path` names, or null for no page of the site's. */
export function placeOf(path: string): Place | null {
  const [kind, ...rest] = parts(path);
  const [first, second, third] = rest;
  const n = rest.length;
  if (kind === undefined) return { kind: "index" };
  if ((SINGLE as readonly string[]).includes(kind))
    return n === 0 ? { kind: kind as (typeof SINGLE)[number] } : null;
  switch (kind) {
    case "post":
      if (n === 1) return { kind, id: first };
      return n === 3 && second === "comment"
        ? { kind, id: first, comment: third }
        : null;
    case "logs":
      return n === 0 ? { kind } : boardPlace(rest);
    case "character":
      return n === 1 ? { kind, id: first } : null;
    case "messages":
    case "content":
      return n <= 1 ? { kind, id: first } : null;
    case "shop":
      return n <= 1 ? { kind, category: first } : null;
    case "search":
      return n <= 1 ? { kind, text: first } : null;
    case "rss":
      return n === 1 ? { kind, board: first } : null;
    case "mypage":
      if (n === 0) return { kind };
      return n === 1 && (MYPAGE_TABS as readonly string[]).includes(first)
        ? { kind, tab: first as (typeof MYPAGE_TABS)[number] }
        : null;
  }
  return null;
}

/** /logs/<board>/…: the board, one of its lists, or a post by its number. */
function boardPlace(rest: string[]): Place | null {
  const [board, how, what, more, page] = rest;
  const n = rest.length;
  if (n === 1) return { kind: "board", board };
  if (n === 2) return whole(how) ? { kind: "log", board, number: how } : null;
  if (how === "page")
    return n === 3 && whole(what) ? { kind: "board", board, page: what } : null;
  if (how === "category") {
    if (n === 3) return { kind: "board", board, category: what };
    return n === 5 && more === "page" && whole(page)
      ? { kind: "board", board, category: what, page }
      : null;
  }
  if (n === 3 && (how === "tag" || how === "search"))
    return { kind: "board", board, [how]: what };
  if (n === 3 && how === "from" && whole(what))
    return { kind: "board", board, from: what };
  return null;
}
