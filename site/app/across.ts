// What is written across the boards: 최근게시물 (bbs/new.php) and 전체검색
// (bbs/search.php), each a view of its own at /new and /search.

import {
  $,
  type Fields,
  formatTime,
  mutate,
  nickOf,
  preloadNicks,
  query,
  type Row,
  renderPages,
  route,
  run,
  say,
  showTab,
  state,
  within,
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
async function writerOf(row: Row) {
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
    result.entries.flatMap((entry: Fields) =>
      entry.comment ? [entry.post, entry.comment] : [entry.post],
    ),
  );
  const body = within($("newList"), "tbody");
  body.replaceChildren();
  // new_delete.php is the 최고관리자's: here the site's 운영자.
  const staff = state.role === "moderator";
  for (const element of document.querySelectorAll<HTMLElement>(
    "#newView .staff-pick",
  ))
    element.hidden = !staff;
  $<HTMLInputElement>("newAll").checked = false;
  for (const entry of result.entries) {
    const row = document.createElement("tr");
    const cell = (...content: (string | Node)[]) => {
      const td = document.createElement("td");
      td.append(...content);
      row.append(td);
    };
    if (staff) {
      const pick = document.createElement("input");
      pick.type = "checkbox";
      pick.setAttribute("aria-label", "선택");
      pick.dataset.kind = entry.comment ? "comment" : "post";
      pick.value = (entry.comment ?? entry.post).id;
      cell(pick);
    }
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
    td.colSpan = staff ? 6 : 5;
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
$("newAll").onchange = () => {
  for (const box of $("newList").querySelectorAll<HTMLInputElement>(
    "tbody input[type=checkbox]",
  ))
    box.checked = $<HTMLInputElement>("newAll").checked;
};
$("newDelete").onclick = () =>
  run(async () => {
    const boxes = [
      ...$("newList").querySelectorAll<HTMLInputElement>(
        "tbody input[type=checkbox]:checked",
      ),
    ];
    if (!boxes.length) return say("삭제할 게시물을 하나 이상 선택하세요.");
    if (!confirm("선택한 게시물을 정말 삭제하시겠습니까?")) return;
    let deleted = 0;
    // Comments first, so a post's go before it.
    boxes.sort((a, b) =>
      a.dataset.kind === b.dataset.kind
        ? 0
        : a.dataset.kind === "comment"
          ? -1
          : 1,
    );
    for (const box of boxes)
      try {
        await mutate(
          box.dataset.kind === "comment"
            ? "community/comments:remove"
            : "community/posts:remove",
          { id: box.value },
        );
        deleted += 1;
      } catch {
        // Left, as new_delete.php passes over what it may not delete.
      }
    say(
      deleted === boxes.length
        ? `${deleted}개를 삭제했습니다.`
        : `${deleted}개를 삭제했고 ${boxes.length - deleted}개는 삭제하지 못했습니다.`,
    );
    await showRecent();
  });
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
    const total = result.counts.reduce(
      (sum: number, entry: Fields) => sum + entry.count,
      0,
    );
    $("searchSummary").textContent = result.counts.length
      ? `게시판 ${result.counts.length}개 · 게시물 ${total}개`
      : "검색된 자료가 하나도 없습니다.";
    const pick = (label: string, id: string) => {
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
        ...result.counts.map((entry: Fields) =>
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
