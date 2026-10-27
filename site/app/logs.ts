// Boards and their logs: a board's list and pages, 분류, tags and search, a post
// opened alone, choosing a board and what it allows, and emoticons.

import { sanitizedFragment } from "../shared/content-renderer.js";
import type { Emoticon } from "../shared/emoticons.js";
import { callError } from "../shared/errors.js";
import {
  $,
  boardStaff,
  mutate,
  pageTitle,
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
import { showNewPost, watchBoard } from "./live.js";
// The writing form, which wires its own controls as it loads.
import { listDrafts } from "./log-form.js";
import {
  countView,
  logItem,
  showNeighbors,
  transferDialog,
} from "./log-item.js";

/** A board's own number setting, else the original's default. */
export function boardSetting(
  id: string | null | undefined,
  key: string,
  fallback: number,
): number {
  const value = state.boards.find((row) => row.id === (id ?? "default"))?.data[
    key
  ];
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
/** bo_upload_count (1), bo_image_width (600), bo_new (24 hours). */
export const uploadCountOf = (id = state.board) =>
  boardSetting(id, "uploadCount", 1);
export const imageWidthOf = (id = state.board) =>
  boardSetting(id, "imageWidth", 600);
export const isNew = (log: Row) => {
  const hours = boardSetting(log.data.board, "newHours", 24);
  const at = Date.parse(log.createdAt ?? "");
  const age = Date.now() - at;
  return hours > 0 && age >= 0 && age < hours * 3600000;
};
/**
 * What a board is (bo_skin): image logs (mmb), plain posts, questions and
 * answers (qna), or settlement requests (caculate).
 */
export const kindOf = (id = state.board) =>
  state.boards.find((row) => row.id === (id ?? "default"))?.data.kind ??
  "image";
/**
 * The list's address: the board, and its page, tag, search or category
 * (/logs/free/page/3, /logs/free/tag/봄, /logs/free/search/바다,
 * /logs/free/category/잡담/page/2).
 */
export function logsPath() {
  const base = ["logs", state.board];
  if (state.search) return [...base, "search", state.search];
  if (state.tag) return [...base, "tag", state.tag];
  if (state.upTo) return [...base, "from", String(state.upTo)];
  if (state.category) base.push("category", state.category);
  if (state.logPage > 1) return [...base, "page", String(state.logPage)];
  return base;
}
/** Writes the list's address, while the list is what is shown. */
export function routeList() {
  if (!$("logsView").hidden && $("logFocusPanel").hidden)
    route(logsPath(), { replace: true });
}
/**
 * Shows a page of the board (the first unless `page` is given): its posts,
 * how many pages there are and each post's comment count, read at once
 * (community/posts:page).
 */
export async function loadLogs({ page: number = 1 } = {}) {
  // Until the owner makes a board there is none to read, member or not.
  if (!state.boards.length) return $("logs").replaceChildren();
  // 전체목록보이기 hid the list under a post; with none open, it shows.
  if ($("logFocusPanel").hidden) {
    $("logs").hidden = false;
    $("logPages").classList.remove("under-post");
  }
  watchBoard();
  if (state.search) return showSearch();
  showCategories();
  const page = await query("community/posts:page", {
    board: state.board,
    page: number,
    ...(state.category ? { category: state.category } : {}),
    ...(state.tag ? { tag: state.tag } : {}),
    ...(state.upTo ? { upTo: state.upTo } : {}),
  });
  // The board as it is now, should the owner have changed it.
  state.boards = state.boards.map((row) =>
    row.id === page.board.id ? page.board : row,
  );
  state.logPage = number;
  if (!$("logsView").hidden && $("logFocusPanel").hidden)
    pageTitle(page.board.data.name || null);
  routeList();
  await preloadNicks(page.documents);
  $("logs").replaceChildren();
  if (number === 1) showNewPost(null);
  $("tagFilter").hidden = !state.tag && !state.upTo;
  $("searchMore").hidden = true;
  $("tagName").textContent = state.tag
    ? `#${state.tag} 태그가 달린 로그`
    : state.upTo
      ? `${state.upTo}번 로그부터`
      : "";
  $("logBulk").hidden = !boardStaff() || !page.documents.length;
  for (const log of page.documents) {
    // Questions show whole, as the qna skin lists them.
    const item = await logItem(kindOf() === "qna" ? log : previewOf(log));
    if (log.data.notice) item.classList.add("notice");
    if (typeof page.counts[log.id] === "number")
      within(item, ".comments summary").textContent =
        `댓글 (${page.counts[log.id]})`;
    $("logs").append(item);
  }
  renderPages(
    $("logPages"),
    number,
    Math.ceil(page.total / page.size),
    (next) => loadLogs({ page: next }),
  );
}
/**
 * The board's 분류 links (bbs/list.mmb.php:4-25): 전체 and each category,
 * the chosen one marked; a choice lists that category's posts.
 */
export function showCategories() {
  const board = state.boards.find((row) => row.id === state.board);
  const categories: string[] = board?.data.categories ?? [];
  const nav = $("boardCategories");
  nav.hidden = !categories.length;
  if (state.category && !categories.includes(state.category))
    state.category = null;
  nav.replaceChildren(
    ...["", ...categories].map((name) => {
      const link = document.createElement("a");
      link.href = `/${["logs", state.board, ...(name ? ["category", name] : [])].map((part) => encodeURIComponent(part)).join("/")}`;
      link.textContent = name || "전체";
      if ((state.category ?? "") === name)
        link.setAttribute("aria-current", "page");
      link.onclick = (event) => {
        event.preventDefault?.();
        run(async () => {
          state.category = name || null;
          state.tag = null;
          state.upTo = null;
          state.search = null;
          $<HTMLInputElement>("searchText").value = "";
          await loadLogs();
        });
      };
      return link;
    }),
  );
}
/**
 * A listed post shows the start of its text (150 characters, an HTML body as
 * plain text); "본문 보기" reads the whole post.
 */
export function previewOf(log: Row): Row {
  // 제목 길이 (bo_subject_len): a list's titles cut short (cut_str's …).
  const most = boardSetting(log.data.board, "subjectLen", 60);
  const title = log.data.title ?? "";
  if (most > 0 && title.length > most)
    log = { ...log, data: { ...log.data, title: `${title.slice(0, most)}…` } };
  const raw = log.data.text ?? "";
  if (raw.length <= 150) return log;
  return {
    ...log,
    data: { ...log.data, text: raw.slice(0, 150), truncated: true },
  };
}
/** Shows log No. `number` of the current board, as the skin's log link (?log=N&single=Y). */
export async function openLogNumber(number: number | string) {
  const log = await query("community/posts:post", {
    board: state.board,
    number,
  }).then(
    (found) => found.document,
    (error) => {
      if (error?.code !== "NOT_FOUND") throw error;
      return null;
    },
  );
  if (!log) return say("자료를 찾을 수 없습니다.");
  await openPost(log.id, { log });
}
/**
 * One post on its own (?log=N&single=Y), at its permanent address
 * /post/<id>, which survives a move to another board; with `comment`, its
 * comments open at that comment (/post/<id>/comment/<id>).
 */
export async function openPost(
  id: string,
  {
    comment = null,
    log = null,
  }: { comment?: string | null; log?: Row | null } = {},
) {
  const post = log ?? (await query("community/posts:post", { id })).document;
  const board = post.data.board ?? "default";
  showTab("logs");
  if (board !== state.board && state.boards.some((row) => row.id === board)) {
    state.board = board;
    $<HTMLSelectElement>("board").value = board;
    configureBoard();
    await loadLogs();
  }
  await preloadNicks([post]);
  // 글읽기 포인트: where the board has them, reading waits for the charge,
  // and a member short of it does not read (bbs/board.php:130).
  const priced = Boolean(
    state.member &&
      state.boards.find((row) => row.id === board)?.data.readReward,
  );
  if (priced) {
    try {
      await countView(post.id, { always: true });
    } catch (error) {
      const failure = callError(error);
      if (failure?.details?.reason === "read_point") {
        $("logFocus").replaceChildren();
        $("logFocusPanel").hidden = true;
        say(failure.message ?? "");
        return;
      }
    }
  } else countView(post.id).catch(() => {});
  const item = await logItem(post);
  $("logFocus").replaceChildren(item);
  await showNeighbors(post);
  // 전체목록보이기 (bo_use_list_view): off, the list is not under the post.
  const listed =
    kindOf(board) !== "text" ||
    state.boards.find((row) => row.id === board)?.data.listView !== false;
  $("logs").hidden = !listed;
  $("logPages").classList.toggle("under-post", !listed);
  $("logFocusPanel").hidden = false;
  pageTitle(
    post.data.title ||
      `${state.boards.find((row) => row.id === board)?.data.name ?? "로그"} ${post.data.number ?? ""}`.trim(),
  );
  route(["post", post.id, ...(comment ? ["comment", comment] : [])], {
    replace: true,
  });
  if (comment) {
    const found = await item.showComment?.(comment);
    if (!found) say("댓글을 찾을 수 없습니다.");
  }
  (
    $("logFocus").querySelector(".comment.linked") ?? $("logFocusPanel")
  ).scrollIntoView?.();
}
$("closeFocus").onclick = () => {
  $("logs").hidden = false;
  $("logPages").classList.remove("under-post");
  $("logFocus").replaceChildren();
  $("logFocusPanel").hidden = true;
  route(logsPath(), { replace: true });
};
/** Lists the current board's logs with `tag` (mmb's hash search). */
export async function searchTag(tag: string) {
  showTab("logs");
  state.tag = tag;
  state.upTo = null;
  state.category = null;
  await loadLogs();
}
$("clearTag").onclick = () =>
  run(async () => {
    state.tag = null;
    state.upTo = null;
    state.search = null;
    $<HTMLInputElement>("searchText").value = "";
    await loadLogs();
  });
/**
 * The board's search results (the skins' 검색), newest first, over every
 * post, 20 at a time; 더 찾기 reads the next 20.
 */
export let searchFrom = null;
export let searchFound = 0;
export async function showSearch({ more = false } = {}) {
  $("logBulk").hidden = true;
  if (!more) {
    searchFrom = null;
    searchFound = 0;
    $("logs").replaceChildren();
  }
  const page = await query("community/posts:search", {
    board: state.board,
    text: state.search,
    after: searchFrom,
    field: $<HTMLSelectElement>("boardSearchField").value || "all",
    ...(state.category ? { category: state.category } : {}),
  });
  await preloadNicks(page.documents);
  for (const log of page.documents)
    $("logs").append(await logItem(kindOf() === "qna" ? log : previewOf(log)));
  searchFound += page.documents.length;
  searchFrom = page.nextCursor;
  $("tagFilter").hidden = false;
  $("tagName").textContent =
    `‘${state.search}’ 검색 결과 ${searchFound}건${searchFrom ? " 이상" : ""}`;
  $("searchMore").hidden = !searchFrom;
  $("logPages").hidden = true;
  routeList();
}
$("searchMore").onclick = () => run(() => showSearch({ more: true }));
/**
 * 검색대상 as the board's skin lists it: the mmb skin's 캐릭터, 코멘트, 오너
 * and 오너(코) (mmb/list.skin.php:200-204); the others' 제목, 내용,
 * 제목+내용, 글쓴이 and 글쓴이(코) (basic/list.skin.php:134-143).
 */
function fillSearchFields(kind: string) {
  const select = $<HTMLSelectElement>("boardSearchField");
  const fields =
    kind === "image"
      ? [
          ["all", "전체"],
          ["character", "캐릭터"],
          ["comment", "코멘트"],
          ["owner", "오너"],
          ["commentWriter", "오너(코)"],
        ]
      : [
          ["all", "전체"],
          ["title", "제목"],
          ["body", "내용"],
          ["titleBody", "제목+내용"],
          ["writer", "글쓴이"],
          ["commentWriter", "글쓴이(코)"],
        ];
  const chosen = select.value;
  select.replaceChildren(
    ...fields.map(([value, text]) =>
      Object.assign(document.createElement("option"), {
        value,
        textContent: text,
      }),
    ),
  );
  if (fields.some(([value]) => value === chosen)) select.value = chosen;
}
$("searchKind").onchange = () =>
  ($("boardSearchField").hidden =
    $<HTMLSelectElement>("searchKind").value !== "text");
$("boardSearch").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const text = $<HTMLInputElement>("searchText").value.trim();
    const kind = $<HTMLSelectElement>("searchKind").value;
    if (kind === "tag" && text) return searchTag(text.replace(/^#/, ""));
    if (kind === "number" && text) {
      const number = Number(text.replace(/^@/, ""));
      if (!Number.isSafeInteger(number) || number < 1)
        return say("로그번호를 숫자로 입력해 주세요.");
      state.tag = null;
      state.search = null;
      state.category = null;
      state.upTo = number;
      return loadLogs();
    }
    // A search stays in the 분류 being read (sca).
    state.tag = null;
    state.upTo = null;
    state.search = text || null;
    await loadLogs();
  });
};
export async function loadBoards() {
  const {
    boards,
    groups: listed,
    emoticons,
  } = await query("community/boards:boards");
  // Every board on every device: the pages fit any screen, so there is no
  // 접속기기 (bo_device, gr_device).
  state.boards = boards;
  state.groups = listed;
  state.emoticons = emoticons;
  // As in the original, there is nothing to read or post on until the owner
  // makes a board (adm/board_form.php).
  $("noPublicBoards").hidden = state.boards.length > 0;
  $("noPublicBoards").textContent = state.member
    ? "아직 게시판이 없습니다. 운영자가 게시판을 만들면 글을 쓸 수 있습니다."
    : "손님에게 공개된 게시판이 없습니다.";
  // With no board, its picker's label, the links and the guest form go too.
  $("logs").hidden = !state.boards.length;
  $("board").closest("label")!.hidden = !state.boards.length;
  document.querySelector<HTMLElement>("#logsView .board-links")!.hidden =
    !state.boards.length;
  $("guestIdentity").hidden = Boolean(state.member) || !state.boards.length;
  if (!state.boards.length) {
    $("board").replaceChildren();
    $("logForm").hidden = true;
    $("logPages").hidden = true;
    return;
  }
  if (!state.boards.some((row) => row.id === state.board))
    state.board = state.boards[0].id;
  // Boards under their group's name (adm/boardgroup_list), ungrouped first.
  const groups = listed;
  const option = (row: Row) => new Option(row.data.name, row.id);
  const grouped = (row: Row) =>
    groups.some((group: Row) => group.id === row.data.group);
  $("board").replaceChildren(
    ...state.boards.filter((row) => !grouped(row)).map(option),
    ...groups
      .map((group: Row) => {
        const boards = state.boards.filter(
          (row) => row.data.group === group.id,
        );
        if (!boards.length) return null;
        const set = document.createElement("optgroup");
        set.label = group.data.name;
        set.append(...boards.map(option));
        return set;
      })
      .filter(
        (set: HTMLOptGroupElement | null): set is HTMLOptGroupElement =>
          set !== null,
      ),
  );
  $<HTMLSelectElement>("board").value = state.board;
  configureBoard();
}
export function configureBoard() {
  // 임시 저장된 글: how many the member keeps.
  if (state.member) listDrafts().catch(() => {});
  const board = state.boards.find((row) => row.id === state.board);
  // bo_content_head: the owner's HTML, sanitized as HTML posts are.
  $("boardDescription").replaceChildren(
    sanitizedFragment(document, board?.data.description ?? ""),
  );
  // mmb_counter, above a picture board's logs.
  $("boardCounter").replaceChildren(
    kindOf() === "image"
      ? sanitizedFragment(document, state.counter ?? "")
      : "",
  );
  showCategories();
  const area = $<HTMLTextAreaElement>("logText");
  // bo_write_max, under the text's own limit.
  const most = Number(board?.data.writeMax) || 0;
  area.maxLength = most > 0 && !boardStaff() ? Math.min(most, 2000) : 2000;
  // bo_insert_content: a new post starts from the board's text.
  if (!area.value.trim() || area.value === area.dataset.inserted) {
    area.value = board?.data.insertContent ?? "";
    area.dataset.inserted = area.value;
  }
  const kind = kindOf();
  // Pictures belong to image boards; questions and settlements are text.
  const pictures = !["qna", "settlement"].includes(kind);
  // A member uploads or links one; the submit checks they did.
  $<HTMLInputElement>("logImage").required = false;
  $<HTMLInputElement>("logImageUrl").required =
    !state.member && kind === "image";
  // bo_upload_count: several pictures on a plain board, none at 0.
  const uploads = kind === "text" ? uploadCountOf() : 1;
  $<HTMLInputElement>("logImage").multiple = uploads > 1;
  $("logImageLabel").hidden = !pictures || uploads === 0;
  $("logImageUrlLabel").hidden = !pictures || uploads === 0;
  // 업로드 등급 and 링크 등급 (bo_upload_level, bo_link_level).
  const reaches = (key: string) =>
    boardStaff() ||
    state.owner ||
    state.level >= boardSetting(state.board, key, 1);
  $("logAttachmentsLabel").hidden =
    kind !== "text" || uploads === 0 || !reaches("uploadLevel");
  for (const id of ["logLink1", "logLink2"])
    ($(id).closest("label") as HTMLLabelElement).hidden = !reaches("linkLevel");
  // 리스트에서 파일 사용 (bo_use_list_file): off, files show on a post alone.
  $("logs").classList.toggle(
    "no-list-file",
    kind === "text" && board?.data.listFile === false,
  );
  $("logTitleLabel").hidden = !pictures;
  fillSearchFields(kind);
  // A settlement names its category (정산 분류); a guest may ask in secret.
  $<HTMLSelectElement>("logCategory").required = kind === "settlement";
  // Guests write secret posts too, opened again with their password.
  $("logSecretLabel").classList.remove("member-only");
  // 공지 as it is written, for the board's staff (write.skin.php).
  $("logNoticeLabel").hidden = !boardStaff() || Boolean(state.replyTo);
  $<HTMLInputElement>("logNotice").checked = false;
  $("logForm").hidden =
    board?.data.enabled === false ||
    (!boardStaff() && state.level < (board?.data.writeLevel ?? 2));
  $("logCategory").replaceChildren();
  for (const name of ["", ...(board?.data.categories ?? [])]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name || "분류 없음";
    $("logCategory").append(option);
  }
  if (!state.member && board?.data.secret === "required")
    $("logForm").hidden = true;
  $<HTMLInputElement>("logSecret").disabled = board?.data.secret !== "optional";
  $<HTMLInputElement>("logSecret").checked = board?.data.secret === "required";
  // The mmb skin's options are an image board's; 익명 where it is allowed.
  $("logOptions").hidden = kind !== "image";
  $("logAnonymousLabel").hidden = board?.data.anonymous !== true;
  const foldHeight = Number(board?.data.foldHeight ?? 600) || 0;
  $("logFoldHint").textContent = foldHeight
    ? `(${foldHeight}px 이상은 자동으로 접힙니다.)`
    : "";
  $("logActions").hidden = !state.member || board?.data.actions !== true;
  // 조합(레시피)사용 (cf_5) off: 조합 is not offered.
  const combine = within<HTMLOptionElement>(
    $("logAction"),
    'option[value="combine"]',
  );
  combine.hidden = combine.disabled = !state.combining;
  ($("logMaterials").closest("label") as HTMLLabelElement).hidden =
    !state.combining;
}
$("board").onchange = () =>
  run(async () => {
    state.board = $<HTMLSelectElement>("board").value;
    route(`logs/${state.board}`, { replace: true });
    state.tag = null;
    state.upTo = null;
    state.search = null;
    state.category = null;
    $<HTMLInputElement>("searchText").value = "";
    configureBoard();
    await loadLogs();
  });
/** The emoticons, read with the boards (community/boards:boards). */
export async function loadEmoticons(): Promise<Emoticon[]> {
  if (state.emoticons !== null) return state.emoticons;
  const member = state.member;
  const { emoticons } = await query("community/boards:boards");
  if (state.member !== member) return [];
  state.emoticons = emoticons;
  return emoticons;
}

// Writes to the shared state from the other modules.

/* list.skin.php's 선택삭제, 선택복사 and 선택이동 (chk_wr_id[]). */
const picked = () =>
  [
    ...$("logs").querySelectorAll<HTMLInputElement>(
      ".log-pick:not([hidden]) input:checked",
    ),
  ].map((box) => box.value);
const pickedOrSay = (what: string) => {
  const ids = picked();
  if (!ids.length) say(`${what}할 글을 하나 이상 선택하세요.`);
  return ids;
};
$("bulkAll").onclick = () => {
  const boxes = [
    ...$("logs").querySelectorAll<HTMLInputElement>(
      ".log-pick:not([hidden]) input",
    ),
  ];
  const all = boxes.every((box) => box.checked);
  for (const box of boxes) box.checked = !all;
};
// bbs/delete_all.php: each as its own delete would, the replies before
// what they answer; what may not go (a writer above one's level, a post
// with replies left) stays.
$("bulkDelete").onclick = () =>
  run(async () => {
    const ids = pickedOrSay("삭제");
    if (!ids.length) return;
    if (!confirm("선택한 게시물을 정말 삭제하시겠습니까?")) return;
    let deleted = 0;
    for (const id of ids.reverse())
      try {
        await mutate("community/posts:remove", { id });
        deleted += 1;
      } catch {
        // Left, as delete_all.php passes over it.
      }
    say(
      deleted === ids.length
        ? `${deleted}개를 삭제했습니다.`
        : `${deleted}개를 삭제했고 ${ids.length - deleted}개는 삭제하지 못했습니다.`,
    );
    await loadLogs({ page: state.logPage });
  });
$("bulkCopy").onclick = () => {
  const ids = pickedOrSay("복사");
  if (ids.length) transferDialog(ids, state.board, "copy");
};
$("bulkMove").onclick = () => {
  const ids = pickedOrSay("이동");
  if (ids.length) transferDialog(ids, state.board);
};
