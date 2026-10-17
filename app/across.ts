// What is written across the boards: 최근게시물 (bbs/new.php) and 전체검색
// (bbs/search.php), each a view of its own at /new and /search.

import {
  $,
  formatTime,
  nickOf,
  preloadNicks,
  query,
  renderPages,
  route,
  run,
  showTab,
  state,
} from "./core.js";

/** The board groups, as the group pickers list them. */
function fillGroups(select: HTMLSelectElement) {
  const chosen = select.value;
  select.replaceChildren(
    new Option("전체그룹", ""),
    ...(state.groups ?? []).map(
      (group) => new Option(group.data.name, group.id),
    ),
  );
  select.value = chosen;
}
/** Who wrote a post or comment, as far as the reader is shown. */
async function writerOf(row) {
  if (row.data.anonymous && !row.data.owner) return "익명의 누군가";
  if (row.data.guest?.name) return `${row.data.guest.name} (손님)`;
  return row.data.owner ? await nickOf(row.data.owner) : "알 수 없음";
}

/** 최근게시물 (new.skin.php): 그룹, 게시판, 제목 ([코] for a comment), 이름, 일시. */
export async function showRecent(page = 1) {
  showTab("new");
  fillGroups($<HTMLSelectElement>("newGroup"));
  const result = await query("community/search:recent", {
    group: $<HTMLSelectElement>("newGroup").value,
    view: $<HTMLSelectElement>("newKind").value,
    nick: $<HTMLInputElement>("newNick").value.trim(),
    page,
  });
  await preloadNicks(
    result.entries.flatMap((entry) =>
      entry.comment ? [entry.post, entry.comment] : [entry.post],
    ),
  );
  const body = $("newList").querySelector("tbody");
  body.replaceChildren();
  for (const entry of result.entries) {
    const row = document.createElement("tr");
    const cell = (...content) => {
      const td = document.createElement("td");
      td.append(...content);
      row.append(td);
    };
    const group = (state.groups ?? []).find((item) => item.id === entry.group);
    cell(group?.data.name ?? "");
    const board = document.createElement("a");
    board.href = `/logs/${encodeURIComponent(entry.board.id)}`;
    board.textContent = entry.board.name;
    cell(board);
    const link = document.createElement("a");
    link.href = `/post/${encodeURIComponent(entry.post.id)}${entry.comment ? `/comment/${encodeURIComponent(entry.comment.id)}` : ""}`;
    link.textContent = `${entry.comment ? "[코] " : ""}${entry.post.data.title || entry.post.data.text?.slice(0, 40) || `No. ${entry.post.data.number}`}`;
    cell(link);
    cell(await writerOf(entry.comment ?? entry.post));
    cell(formatTime((entry.comment ?? entry.post).createdAt));
    body.append(row);
  }
  if (!result.entries.length) {
    const row = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "게시물이 없습니다.";
    row.append(td);
    body.append(row);
  }
  renderPages(
    $("newPages"),
    page,
    Math.ceil(result.total / result.size),
    (next) => showRecent(next),
  );
}
$("newFilters").onsubmit = (event) => {
  event.preventDefault?.();
  run(() => showRecent());
};

let searchCursor: string | null = null;
/**
 * 전체검색 (search.skin.php): 그룹, 검색조건, the words and AND·OR; each
 * board found with its count (전체 and one board: onetable), then the posts,
 * 300 characters each, 10 at a time.
 */
export async function showSearch(
  text: string | null = null,
  { board = "", more = false }: { board?: string; more?: boolean } = {},
) {
  showTab("search");
  fillGroups($<HTMLSelectElement>("searchGroup"));
  if (text !== null) $<HTMLInputElement>("searchWords").value = text;
  const words = $<HTMLInputElement>("searchWords").value.trim();
  if (!more) {
    $("searchResults").replaceChildren();
    $("searchBoards").replaceChildren();
    $("searchSummary").textContent = "";
  }
  $("searchAllMore").hidden = true;
  if (!words) return;
  route(["search", words], { replace: true });
  const operator =
    $("searchForm").querySelector<HTMLInputElement>(
      'input[name="searchOperator"]:checked',
    )?.value ?? "and";
  const result = await query("community/search:everything", {
    text: words,
    field: $<HTMLSelectElement>("searchField").value,
    operator,
    group: $<HTMLSelectElement>("searchGroup").value,
    board,
    after: more ? searchCursor : null,
  });
  if (!more) {
    const total = result.counts.reduce((sum, entry) => sum + entry.count, 0);
    $("searchSummary").textContent = result.counts.length
      ? `게시판 ${result.counts.length}개 · 게시물 ${total}개`
      : "검색된 자료가 하나도 없습니다.";
    const pick = (label, id) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-pressed", String(board === id));
      button.onclick = () => run(() => showSearch(null, { board: id }));
      item.append(button);
      return item;
    };
    if (result.counts.length)
      $("searchBoards").append(
        pick("전체게시판", ""),
        ...result.counts.map((entry) =>
          pick(`${entry.name} (${entry.count})`, entry.id),
        ),
      );
  }
  await preloadNicks(result.documents);
  for (const row of result.documents) {
    const item = document.createElement("li");
    const heading = document.createElement("a");
    heading.href = `/post/${encodeURIComponent(row.id)}`;
    heading.textContent = `[${row.boardName}] ${row.data.title || `No. ${row.data.number}`}`;
    const text = document.createElement("p");
    text.textContent = row.data.locked
      ? "멤버 공개용 로그입니다."
      : (row.data.text ?? "");
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = `${await writerOf(row)} · ${formatTime(row.createdAt)}`;
    item.append(heading, text, meta);
    $("searchResults").append(item);
  }
  searchCursor = result.nextCursor;
  $("searchAllMore").hidden = !result.nextCursor;
  $("searchAllMore").onclick = () =>
    run(() => showSearch(null, { board, more: true }));
}
$("searchForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(() => showSearch());
};
