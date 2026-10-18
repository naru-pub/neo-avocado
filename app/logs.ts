// Boards, logs and comments: reading, writing, tags and emoticons.

import { emoticonContent } from "../emoticons.js";
import { sanitizedFragment } from "../content-renderer.js";
import {
  $,
  boardStaff,
  edit,
  type EditField,
  pageTitle,
  formatTime,
  guestCredentials,
  mine,
  mutate,
  preloadNicks,
  query,
  run,
  say,
  showTab,
  state,
  uploadMedia,
  withGuestPassword,
  route,
  renderPages,
} from "./core.js";
import {
  actionItem,
  postInventory,
  diceText,
  postText,
  speakerLabel,
  wireItemChoice,
  wireSpeakerChoice,
} from "./posts.js";
import { showNewPost, watchBoard } from "./live.js";

/** A board's own number setting, else the original's default. */
function boardSetting(id, key, fallback) {
  const value = state.boards.find((row) => row.id === (id ?? "default"))?.data[
    key
  ];
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
/** bo_upload_count (1), bo_image_width (600), bo_new (24 hours). */
const uploadCountOf = (id = state.board) => boardSetting(id, "uploadCount", 1);
const imageWidthOf = (id = state.board) => boardSetting(id, "imageWidth", 600);
const isNew = (log) => {
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
function logsPath() {
  const base = ["logs", state.board];
  if (state.search) return [...base, "search", state.search];
  if (state.tag) return [...base, "tag", state.tag];
  if (state.upTo) return [...base, "from", String(state.upTo)];
  if (state.category) base.push("category", state.category);
  if (state.logPage > 1) return [...base, "page", String(state.logPage)];
  return base;
}
/** Writes the list's address, while the list is what is shown. */
function routeList() {
  if (!$("logsView").hidden && $("logFocusPanel").hidden)
    route(logsPath(), { replace: true });
}
/**
 * Shows a page of the board (the first unless `page` is given): its posts,
 * how many pages there are and each post's comment count, read at once
 * (community/posts:page).
 */
export async function loadLogs({ page: number = 1 } = {}) {
  if (!state.member && !state.boards.length) return $("logs").replaceChildren();
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
  for (const log of page.documents) {
    // Questions show whole, as the qna skin lists them.
    const item = await logItem(kindOf() === "qna" ? log : previewOf(log));
    if (log.data.notice) item.classList.add("notice");
    if (typeof page.counts[log.id] === "number")
      item.querySelector(".comments summary").textContent =
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
function showCategories() {
  const board = state.boards.find((row) => row.id === state.board);
  const categories: string[] = board?.data.categories ?? [];
  const nav = $("boardCategories");
  nav.hidden = !categories.length;
  if (state.category && !categories.includes(state.category))
    state.category = null;
  nav.replaceChildren(
    ...["", ...categories].map((name) => {
      const link = document.createElement("a");
      link.href = `/${["logs", state.board, ...(name ? ["category", name] : [])].map(encodeURIComponent).join("/")}`;
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
function previewOf(log) {
  const raw = log.data.text ?? "";
  if (raw.length <= 150) return log;
  const text = log.data.format === "html" ? htmlText(raw) : raw;
  return {
    ...log,
    data: { ...log.data, text: text.slice(0, 150), truncated: true },
  };
}
/** The text of an HTML body, for a preview cut short. */
function htmlText(html) {
  const holder = document.createElement("div");
  holder.append(sanitizedFragment(document, html));
  return holder.textContent.replace(/\s+/g, " ").trim();
}
/** Shows log No. `number` of the current board, as the skin's log link (?log=N&single=Y). */
export async function openLogNumber(number) {
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
export async function openPost(id, { comment = null, log = null } = {}) {
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
      if (error?.details?.reason === "read_point") {
        $("logFocus").replaceChildren();
        $("logFocusPanel").hidden = true;
        say(error.message);
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
    const found = await item.showComment(comment);
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
export async function searchTag(tag) {
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
let searchFrom = null;
let searchFound = 0;
async function showSearch({ more = false } = {}) {
  if (!more) {
    searchFrom = null;
    searchFound = 0;
    $("logs").replaceChildren();
  }
  const page = await query("community/posts:search", {
    board: state.board,
    text: state.search,
    after: searchFrom,
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
    state.tag = null;
    state.upTo = null;
    state.category = null;
    state.search = text || null;
    await loadLogs();
  });
};
/** 2026-10-16 15:11:33, as the original prints a comment's wr_datetime. */
function fullTime(at) {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return "";
  const kst = new Date(time.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${kst.slice(0, 10)} ${kst.slice(11, 19)}`;
}
/**
 * The mmb skin's options on a shown post (list.log.skin.php:41-83): 19금
 * covered until clicked, 로그접기 (or a picture taller than the board's
 * height) folded with OPEN, and 리플창 아래로.
 */
function presentOptions(item, log) {
  if (log.data.locked) return;
  const board = state.boards.find(
    (row) => row.id === (log.data.board ?? "default"),
  );
  item.classList.toggle("wide", log.data.wide === true);
  const picture = item.querySelector(".log-picture");
  const fold = () => {
    if (picture.classList.contains("foldable")) return;
    picture.classList.add("foldable", "folded");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "open-log";
    toggle.textContent = "OPEN";
    toggle.onclick = () => {
      const folded = picture.classList.toggle("folded");
      toggle.textContent = folded ? "OPEN" : "CLOSE";
    };
    picture.append(toggle);
  };
  if (log.data.fold === true) fold();
  const image = item.querySelector(".log-image");
  // bo_gallery_height, 600 unless the owner sets it (board_form.php:95).
  const height = Number(board?.data.foldHeight ?? 600) || 0;
  if (image && height > 0) {
    const check = () => {
      if (image.naturalHeight >= height) fold();
    };
    if (image.complete) check();
    else image.addEventListener("load", check, { once: true });
  }
  // A member marked adult (mb_adult) sees it uncovered (list.log.skin.php:133).
  if (log.data.adult === true && !state.adult) {
    picture.classList.add("blind");
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "remove-blind";
    reveal.textContent =
      "해당 로그는 필터 된 로그입니다. 확인을 원하실 경우 클릭해 주세요.";
    reveal.onclick = () => {
      picture.classList.remove("blind");
      reveal.remove();
    };
    picture.append(reveal);
  }
}
/** The options in a post's edit dialog, as its board allows them. */
function optionEdits(current) {
  if (kindOf(current.data.board) !== "image") return [];
  const board = state.boards.find(
    (row) => row.id === (current.data.board ?? "default"),
  );
  const box = (name, label) => ({
    name,
    label,
    type: "checkbox",
    value: current.data[name] === true,
  });
  const guest = Boolean(current.data.guest);
  return [
    ...(guest ? [] : [box("membersOnly", "멤버공개"), box("adult", "19금")]),
    box("wide", "리플창 아래로"),
    box("fold", "로그접기"),
    ...(!guest && board?.data.anonymous === true
      ? [box("anonymous", "익명")]
      : []),
  ];
}
/**
 * What a post without them may still take when edited, as the mmb skin's
 * form offers them again (write.skin.php:196,290,319): dice, 탐색 or 조합,
 * and an item, for the writer's own post on a board that allows actions.
 */
function actionEdits(current) {
  const fields: any[] = [];
  if (!current.data.dice)
    fields.push({ name: "dice", label: "주사위", type: "checkbox" });
  const board = state.boards.find(
    (row) => row.id === (current.data.board ?? "default"),
  );
  if (
    !mine(current) ||
    board?.data.actions !== true ||
    !current.data.character ||
    current.data.guest
  )
    return fields;
  const actions = Array.isArray(current.data.actions)
    ? current.data.actions
    : [];
  if (!actions.some((row) => ["explore", "combine"].includes(row?.type))) {
    fields.push({
      name: "action",
      label: "행동",
      options: [
        ["", "일반 행동"],
        ["explore", "탐색"],
        ...(state.combining ? [["combine", "조합"]] : []),
      ],
    });
    for (const n of [1, 2, 3])
      fields.push({
        name: `material${n}`,
        label: `조합 재료 ${n}`,
        options: [["", "재료 없음"]],
      });
  }
  if (!actions.some((row) => row?.type === "use"))
    fields.push({
      name: "item",
      label: "사용할 아이템",
      options: [["", "사용할 아이템 없음"]],
    });
  return fields;
}
/** Fills the edit dialog's material and item choices from the post's character's inventory. */
async function fillActionEdits(character) {
  const fields = $("editorFields");
  const materials = [1, 2, 3]
    .map((n) => fields.querySelector(`[name="material${n}"]`))
    .filter(Boolean);
  const used = fields.querySelector('[name="item"]');
  if (!character || (!materials.length && !used)) return;
  for (const { row, item } of await postInventory()) {
    if (row.data.character !== character || !item) continue;
    const name = row.data.name ?? row.data.item;
    if (item.craftMaterial !== false)
      for (const select of materials) select.append(new Option(name, row.id));
    if (used && item.usable !== false && item.usableInPosts !== false)
      used.append(new Option(name, row.id));
  }
}
/** The inventory changed: read it again when next needed. */
function forgetInventory() {
  state.postItems = null;
  state.shopLoaded = false;
  $("logItem").replaceChildren($<HTMLSelectElement>("logItem").options[0]);
  delete $("logItem").dataset.loaded;
  $("logMaterials").replaceChildren();
  delete $("logMaterials").dataset.loaded;
}
export async function logItem(log) {
  // A post's card, with what opens one of its comments.
  const item = $<HTMLTemplateElement>(
    "logTemplate",
  ).content.firstElementChild.cloneNode(true) as HTMLElement & {
    showComment?: (id: string) => Promise<boolean>;
  };
  item.dataset.id = log.id;
  // The post's number links to its permanent address.
  const number = document.createElement("a");
  number.href = `/post/${encodeURIComponent(log.id)}`;
  number.textContent = log.data.number ? `No. ${log.data.number}` : "링크";
  item
    .querySelector(".log-number")
    .replaceChildren(log.data.notice ? "공지 · " : "", number);
  // 새글 아이콘 (bo_new): a post newer than the board's hours.
  if (isNew(log))
    item.querySelector(".log-number").append(
      Object.assign(document.createElement("span"), {
        className: "new-mark",
        title: "새 글",
        textContent: " N",
      }),
    );
  // 19금's mark (list.log.skin.php:114).
  if (log.data.adult)
    item.querySelector(".log-number").append(
      Object.assign(document.createElement("span"), {
        className: "adult-mark",
        title: "19금",
        textContent: " ■",
      }),
    );
  const pin = item.querySelector<HTMLButtonElement>(".pin");
  const move = item.querySelector<HTMLButtonElement>(".move");
  pin.hidden = move.hidden = !boardStaff(log.data.board) || log.data.locked;
  pin.textContent = log.data.notice ? "공지 해제" : "공지로";
  pin.onclick = () =>
    run(async () => {
      const { document: saved } = await mutate(
        "community/boards:moderatePost",
        {
          id: log.id,
          notice: !log.data.notice,
        },
      );
      item.replaceWith(await logItem(saved));
      await loadLogs();
    });
  // bbs/move.php's 이동 and 복사 (sw=move, copy).
  move.textContent = "이동·복사";
  move.onclick = () =>
    edit(
      "다른 게시판으로 이동·복사",
      [
        {
          name: "how",
          label: "방식",
          value: "move",
          options: [
            ["move", "이동"],
            ["copy", "복사 (댓글과 함께)"],
          ],
        },
        {
          name: "board",
          label: "게시판",
          value: log.data.board ?? "default",
          // bbs/move.php: a 게시판·그룹 관리자 moves to boards they administer.
          options: state.boards
            .filter((row) => boardStaff(row.id))
            .map((row) => [row.id, row.data.name]),
        },
      ],
      async ({ how, board }) => {
        if (how === "copy") {
          await mutate("community/boards:copyPost", { id: log.id, board });
          say("복사했습니다.");
          if (board === (log.data.board ?? "default")) await loadLogs();
          return;
        }
        await mutate("community/boards:moderatePost", {
          id: log.id,
          board,
        });
        item.remove();
      },
    );
  const image = item.querySelector<HTMLImageElement>(".log-image");
  if (log.data.image && !log.data.locked) image.src = log.data.image;
  else image.remove();
  // A plain board's further pictures, and its pictures' width (bo_image_width).
  const files = item.querySelector<HTMLElement>(".log-files");
  if (!log.data.locked && Array.isArray(log.data.files))
    for (const url of log.data.files)
      if (typeof url === "string" && url.startsWith("https://"))
        files.append(
          Object.assign(document.createElement("img"), {
            src: url,
            alt: "",
            className: "log-file",
            loading: "lazy",
          }),
        );
  files.hidden = !files.children.length;
  if (kindOf(log.data.board) === "text") {
    const width = imageWidthOf(log.data.board);
    for (const picture of item.querySelectorAll<HTMLImageElement>(
      ".log-image, .log-file",
    ))
      if (width) picture.style.maxWidth = `min(100%, ${width}px)`;
  }
  // wr_link1, wr_link2: the mmb skin's LINK, in a new window.
  const links = item.querySelector<HTMLElement>(".log-links");
  if (!log.data.locked && Array.isArray(log.data.links))
    for (const [n, url] of log.data.links.entries())
      if (typeof url === "string" && /^https?:\/\//.test(url)) {
        const link = Object.assign(document.createElement("a"), {
          href: url,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
          className: "link",
          textContent: "LINK",
        });
        // bbs/link.php counts each one followed (wr_link1_hit); a plain
        // board says how many times (basic view's 회 연결).
        let hits = Number(log.data.linkHits?.[n] ?? 0);
        const count = document.createElement("span");
        count.className = "link-hits";
        const showHits = () => {
          count.textContent =
            kindOf(log.data.board) === "text" ? ` ${hits}회 연결` : "";
        };
        showHits();
        link.onclick = () => {
          mutate("community/posts:linkHit", { id: log.id, url })
            .then(() => {
              hits += 1;
              showHits();
            })
            .catch(() => {});
        };
        links.append(link, count, " ");
      }
  links.hidden = !links.children.length;
  // basic/view.skin.php:36-62: each 첨부파일 with its size and 다운로드 count.
  if (!log.data.locked && Array.isArray(log.data.attachments)) {
    const list = document.createElement("ul");
    list.className = "log-attachments";
    for (const file of log.data.attachments) {
      if (typeof file?.url !== "string" || !file.url.startsWith("https://"))
        continue;
      const entry = document.createElement("li");
      const link = Object.assign(document.createElement("a"), {
        href: file.url,
        target: "_blank",
        rel: "noopener",
        textContent: file.name,
      });
      link.setAttribute("download", file.name);
      const count = Object.assign(document.createElement("span"), {
        className: "downloads",
        textContent: ` (${sizeText(file.size)}) ${file.downloads ?? 0}회 다운로드`,
      });
      link.onclick = () => {
        mutate("community/posts:download", { id: log.id, url: file.url })
          .then(() => {
            file.downloads = (file.downloads ?? 0) + 1;
            count.textContent = ` (${sizeText(file.size)}) ${file.downloads}회 다운로드`;
          })
          .catch(() => {});
      };
      entry.append(link, count);
      if (file.note)
        entry.append(
          Object.assign(document.createElement("span"), {
            className: "file-note",
            textContent: ` — ${file.note}`,
          }),
        );
      list.append(entry);
    }
    if (list.childElementCount) links.after(list);
  }
  if (log.data.locked && log.data.guest) {
    // A guest's secret question opens with its password (qna/password.php).
    const form = document.createElement("form");
    form.className = "open-secret";
    const password = document.createElement("input");
    password.type = "password";
    password.placeholder = "비밀번호";
    password.autocomplete = "current-password";
    password.setAttribute("aria-label", "질문 비밀번호");
    const enter = document.createElement("button");
    enter.type = "submit";
    enter.textContent = "열기";
    form.append(password, enter);
    form.onsubmit = (event) => {
      event.preventDefault?.();
      run(async () => {
        const { document: opened } = await query("community/posts:open", {
          id: log.id,
          password: password.value,
        });
        item.replaceWith(await logItem(opened));
      });
    };
    item
      .querySelector(".log-text")
      .replaceChildren(
        kindOf(log.data.board) === "qna"
          ? "비밀 질문입니다. "
          : "비밀글입니다. ",
        form,
      );
  } else if (log.data.locked)
    item.querySelector(".log-text").textContent = log.data.membersOnly
      ? "멤버 공개용 로그입니다."
      : "비밀글입니다. 본문을 볼 수 없습니다.";
  else if (log.data.format === "html" && !log.data.truncated) {
    item.querySelector(".log-text").classList.add("rich-text");
    item
      .querySelector(".log-text")
      .append(sanitizedFragment(document, log.data.text));
  } else
    item.querySelector(".log-text").append(
      postText(log.data.text, [], {
        pictureBoard: kindOf(log.data.board) === "image",
      }),
    );
  if (log.data.dice && !log.data.locked) {
    item.querySelector<HTMLElement>(".log-dice").hidden = false;
    item.querySelector<HTMLElement>(".log-dice").textContent = diceText(log);
  }
  if (!log.data.locked)
    for (const action of Array.isArray(log.data.actions)
      ? log.data.actions
      : [])
      item.querySelector<HTMLElement>(".log-dice").before(actionItem(action));
  presentOptions(item, log);
  // 관심 (mmb's favorite): a member keeps the post in 관심로그.
  const favorite = item.querySelector<HTMLButtonElement>(".fav");
  const marked = () => (state.profile?.data.favorites ?? []).includes(log.id);
  favorite.hidden = !state.member || Boolean(log.data.locked);
  favorite.setAttribute("aria-pressed", String(marked()));
  favorite.onclick = () =>
    run(async () => {
      const { favorite: on } = await mutate("community/posts:favorite", {
        id: log.id,
      });
      if (state.profile) {
        const others = (state.profile.data.favorites ?? []).filter(
          (id) => id !== log.id,
        );
        state.profile.data.favorites = on ? [log.id, ...others] : others;
      }
      favorite.setAttribute("aria-pressed", String(on));
      say(on ? "관심로그에 담았습니다." : "관심로그에서 뺐습니다.");
    });
  item.querySelector(".log-title").textContent =
    `${log.data.writing ? "[작성 중] " : ""}${log.data.settlement ? `[${log.data.settlement.state}] ` : ""}${log.data.secret ? "🔒 " : ""}${log.data.title ?? ""}${log.data.category ? ` · ${log.data.category}` : ""}`;
  if (log.data.writing) item.classList.add("writing");
  // 추천 and 비추천 (bbs/good.php), where the board takes them.
  const voteBoard = state.boards.find(
    (row) => row.id === (log.data.board ?? "default"),
  );
  for (const [kind, label, enabled] of [
    ["good", "추천", voteBoard?.data.useGood],
    ["nogood", "비추천", voteBoard?.data.useNogood],
  ]) {
    if (!enabled || log.data.locked) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vote ${kind}`;
    const show = (n) => (button.textContent = `${label} ${n ?? 0}`);
    show(log.data[kind]);
    button.disabled = !state.member || mine(log);
    button.onclick = () =>
      run(async () => {
        const counts = await mutate("community/posts:vote", {
          id: log.id,
          vote: kind,
        });
        show(counts[kind]);
        say(`${label}했습니다.`);
      });
    item.querySelector(".meta").append(" ", button);
  }
  if (log.data.settlement) item.classList.add("settled");
  // 답변글 (wr_reply): under what they answer, a step in for each level.
  if (log.data.depth) {
    item.classList.add("reply-post");
    item.style.setProperty("--depth", String(Math.min(log.data.depth, 10)));
  }
  // 답변 (view.skin.php:113) on a plain board, at 글답변 권한.
  const reply = item.querySelector<HTMLButtonElement>(".reply");
  reply.hidden =
    kindOf(log.data.board) !== "text" ||
    Boolean(log.data.locked) ||
    (log.data.depth ?? 0) >= 10 ||
    (!boardStaff(log.data.board) &&
      !state.owner &&
      state.level < boardSetting(log.data.board, "replyLevel", 2));
  reply.onclick = () => startReply(log);
  item.querySelector(".author").replaceChildren(await speakerLabel(log));
  item.querySelector("time").textContent = formatTime(log.createdAt);
  // 조회 (basic/list.skin.php:99, view.skin.php:32), on a plain board.
  if (kindOf(log.data.board) === "text" && typeof log.data.hits === "number")
    item.querySelector("time").after(
      Object.assign(document.createElement("span"), {
        className: "hits",
        textContent: ` · 조회 ${log.data.hits}`,
      }),
    );
  const remove = item.querySelector<HTMLButtonElement>(".delete");
  const guestPost = !state.member && Boolean(log.data.guest);
  const moderating = boardStaff(log.data.board);
  remove.hidden = !mine(log) && !moderating && !guestPost;
  const change = item.querySelector<HTMLButtonElement>(".edit");
  change.hidden =
    Boolean(log.data.locked) || (!mine(log) && !moderating && !guestPost);
  // A settled request stays as it was settled (caculate's wr_10).
  if (log.data.settlement && !moderating) remove.hidden = change.hidden = true;
  if (
    kindOf(log.data.board) === "settlement" &&
    moderating &&
    !log.data.locked
  ) {
    const settle = document.createElement("button");
    settle.type = "button";
    settle.textContent = "정산 처리";
    settle.onclick = () =>
      edit(
        "정산 처리",
        [
          {
            name: "state",
            label: "처리 상태",
            // caculate/write_comment.php: 정산완료 or 반려.
            value: log.data.settlement?.state === "반려" ? "반려" : "정산완료",
            options: [
              ["정산완료", "정산완료"],
              ["반려", "반려"],
            ],
          },
          {
            name: "exp",
            label: `캐릭터 ${state.names.expName} 지급`,
            type: "number",
            value: 0,
          },
          {
            name: "money",
            label: `오너 ${state.names.moneyName} 지급`,
            type: "number",
            value: 0,
          },
          { name: "memo", label: "답변", multiline: true, max: 500 },
        ],
        async ({ state: settled, exp, money, memo }) => {
          const { document: saved } = await mutate("community/posts:settle", {
            id: log.id,
            state: settled,
            exp: Number(exp) || 0,
            money: Number(money) || 0,
            memo,
          });
          item.replaceWith(await logItem(previewOf(saved)));
        },
      );
    change.after(" ", settle);
  }
  const beginEdit = (current) =>
    edit(
      "로그 수정",
      [
        ...(guestPost
          ? [
              {
                name: "password",
                label: "비밀번호",
                type: "password",
                required: true,
                max: 64,
              },
            ]
          : []),
        { name: "title", label: "제목", value: current.data.title, max: 120 },
        {
          name: "category",
          label: "분류",
          value: current.data.category ?? "",
          options: [
            ["", "분류 없음"],
            ...(
              state.boards.find(
                (row) => row.id === (current.data.board ?? "default"),
              )?.data.categories ?? []
            ).map((name) => [name, name]),
          ],
        },
        ...(guestPost
          ? []
          : [
              {
                name: "secret",
                label: "비밀글",
                value: current.data.secret === true,
                type: "checkbox",
              },
            ]),
        {
          name: "text",
          label: current.data.format === "html" ? "본문 (HTML)" : "설명",
          value: current.data.text,
          multiline: true,
          max: current.data.format === "html" ? 12000 : 2000,
        },
        ...[0, 1].map((n) => ({
          name: `link${n + 1}`,
          label: `링크 #${n + 1}`,
          value: current.data.links?.[n] ?? "",
          max: 2000,
        })),
        ...pictureEdits(current),
        ...attachmentEdits(current),
        ...optionEdits(current),
        ...actionEdits(current),
      ],
      async ({
        text,
        title,
        category,
        secret = false,
        password,
        dice = false,
        action = "",
        material1 = "",
        material2 = "",
        material3 = "",
        item: used = "",
        link1 = "",
        link2 = "",
        pictureFile = null,
        pictureUrl = "",
        pictureRemove = false,
        attachmentAdd = null,
        attachmentNote = "",
        ...rest
      }) => {
        // basic/write.skin.php's 파일 삭제 boxes and a new 파일.
        const options = Object.fromEntries(
          Object.entries(rest).filter(([key]) => !key.startsWith("drop:")),
        );
        let attachments = (current.data.attachments ?? [])
          .filter((file) => !rest[`drop:${file.url}`])
          .map(({ url, name, size, type, note }) => ({
            url,
            name,
            size,
            type,
            ...(note ? { note } : {}),
          }));
        if (attachmentAdd) {
          const stored = await uploadMedia(attachmentAdd);
          attachments = [
            ...attachments,
            {
              url: stored.url,
              name: stored.name ?? attachmentAdd.name,
              size: stored.size ?? attachmentAdd.size,
              type: stored.contentType ?? attachmentAdd.type,
              ...(attachmentNote ? { note: attachmentNote } : {}),
            },
          ];
        }
        const links = [link1, link2].map((link) => link.trim()).filter(Boolean);
        // write.skin.php's edit: a new picture (UPLOAD or URL), or 로그 삭제
        // (bf_file_del); else the post keeps its own.
        if (pictureFile && pictureUrl)
          throw new Error("그림은 파일과 주소 중 하나만 정해 주세요.");
        const image = pictureFile
          ? (await uploadMedia(pictureFile)).url
          : pictureUrl || (pictureRemove ? null : (current.data.image ?? null));
        const materials = [material1, material2, material3].filter(Boolean);
        if (action === "combine" && !materials.length)
          throw new Error("조합 재료를 골라 주세요.");
        const { document: saved } = await mutate("community/posts:write", {
          id: log.id,
          data: {
            ...current.data,
            image,
            text,
            title,
            ...(current.data.attachments || attachments.length
              ? { attachments }
              : {}),
            category,
            secret,
            ...(links.length || current.data.links?.length ? { links } : {}),
            ...options,
            ...(dice ? { dice: true } : {}),
            ...(action === "combine" ? { action, materials } : {}),
            ...(action === "explore" ? { action } : {}),
            ...(used ? { item: used } : {}),
          },
          revision: current.revision,
          ...(guestPost ? { guest: { password } } : {}),
        });
        if (action || used) forgetInventory();
        item.replaceWith(await logItem(saved));
      },
    );
  const openEdit = (current) => {
    beginEdit(current);
    run(() => fillActionEdits(current.data.character));
  };
  const whole = async () =>
    (await query("community/posts:post", { id: log.id })).document;
  change.onclick = () =>
    log.data.truncated
      ? run(async () => openEdit(await whole()))
      : openEdit(log);
  if (log.data.truncated && !log.data.locked) {
    const expand = document.createElement("button");
    expand.type = "button";
    expand.textContent = "본문 보기";
    expand.onclick = () =>
      run(async () => {
        const full = await whole();
        item.replaceWith(
          await logItem({ ...full, data: { ...full.data, truncated: false } }),
        );
      });
    item.querySelector(".log-text").after(expand);
  }
  remove.onclick = () =>
    guestPost
      ? withGuestPassword("로그 삭제", async (guest) => {
          await mutate("community/posts:remove", { id: log.id, guest });
          item.remove();
        })
      : run(async () => {
          if (!confirm("이 로그를 지울까요?")) return;
          await mutate("community/posts:remove", { id: log.id });
          item.remove();
        });
  // 댓글은 펼쳤을 때 처음 읽는다.
  const comments = item.querySelector<HTMLDetailsElement>(".comments");
  comments.hidden = Boolean(log.data.locked);
  let cursor;
  const load = (more) =>
    run(async () => {
      const page = await query("community/comments:list", {
        post: log.id,
        after: more ? cursor : null,
      });
      await preloadNicks(page.documents);
      const list = item.querySelector(".comment-list");
      if (!more) list.replaceChildren();
      for (const comment of page.documents)
        list.append(await commentItem(comment, log));
      cursor = page.nextCursor;
      item.querySelector<HTMLButtonElement>(".more-comments").hidden = !cursor;
    });
  // The first page of comments, read once: opening them and a link to one
  // of them (which opens them too) share the read.
  let first: Promise<void> | null = null;
  const loadFirst = () => (first ??= load(false));
  comments.ontoggle = () => {
    if (comments.open) loadFirst();
  };
  // Opens the comments at one, reading on until it is found.
  item.showComment = async (id) => {
    comments.open = true;
    await loadFirst();
    const find = () =>
      item.querySelector(`.comment[data-id="${CSS.escape(id)}"]`);
    // Up to 500 comments, so a link to one that is gone ends soon.
    for (let pages = 1; !find() && cursor && pages < 10; pages++)
      await load(true);
    const found = find();
    found?.classList.add("linked");
    return Boolean(found);
  };
  item.querySelector<HTMLButtonElement>(".more-comments").onclick = () =>
    load(true);
  const form = item.querySelector<HTMLFormElement>(".comment-form");
  form.querySelector<HTMLButtonElement>(".cancel-reply").onclick = () => {
    delete form.dataset.replyTo;
    form.querySelector<HTMLElement>(".comment-replying").hidden = true;
  };
  const picker = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "이모티콘";
  const choices = document.createElement("div");
  choices.className = "emoticon-choices";
  picker.append(summary, choices);
  form.prepend(picker);
  picker.ontoggle = () => {
    if (picker.open && !choices.childNodes.length)
      run(async () => {
        const definitions = await loadEmoticons();
        for (const row of definitions) {
          const button = document.createElement("button");
          button.type = "button";
          button.title = row.data.name;
          button.setAttribute("aria-label", row.data.name);
          button.append(
            emoticonContent(document, row.data.name, [row]),
            row.data.name,
          );
          button.onclick = () => {
            const input =
              form.querySelector<HTMLTextAreaElement>(".comment-text");
            input.setRangeText(
              row.data.name,
              input.selectionStart,
              input.selectionEnd,
              "end",
            );
            input.focus();
          };
          choices.append(button);
        }
        if (!definitions.length)
          choices.textContent = "등록된 이모티콘이 없습니다.";
      });
  };

  const speakerChoice =
    form.querySelector<HTMLSelectElement>(".comment-character");
  const actionChoice = form.querySelector<HTMLSelectElement>(".comment-action");
  const itemChoice = form.querySelector<HTMLSelectElement>(".comment-item");
  wireSpeakerChoice(speakerChoice);
  wireItemChoice(itemChoice);
  const board = state.boards.find(
    (row) => row.id === (log.data.board ?? "default"),
  );
  // 익명 (write_comment.php:51) where the board allows it.
  form.querySelector<HTMLElement>(".comment-anonymous").hidden =
    !state.member || board?.data.anonymous !== true;
  form.querySelector<HTMLElement>(".comment-actions").hidden =
    !state.member || !board?.data.actions;
  const staff = boardStaff(log.data.board) || state.owner;
  form.hidden =
    board?.data.enabled === false ||
    // Only the staff answer a Q&A board's questions (qna/list.skin.php:85).
    (board?.data.kind === "qna" && !staff) ||
    (!staff && state.level < (board?.data.commentLevel ?? 2));
  form.onsubmit = (event) => {
    event.preventDefault?.();
    run(async () => {
      const text = form
        .querySelector<HTMLTextAreaElement>(".comment-text")
        .value.trim();
      const dice =
        form.querySelector<HTMLInputElement>(".comment-dice").checked;
      const character = speakerChoice.value;
      const action = actionChoice.value;
      const used = itemChoice.value;
      const anonymous = form.querySelector<HTMLInputElement>(
        ".comment-anonymous-check",
      ).checked;
      const secret = form.querySelector<HTMLInputElement>(
        ".comment-secret-check",
      ).checked;
      if (!text && !dice && !action && !used) return;
      const guest = state.member ? null : guestCredentials();
      const { document: saved } = await mutate("community/comments:write", {
        data: {
          logId: log.id,
          text,
          dice,
          ...(character && !guest ? { character } : {}),
          ...(action && !guest ? { action } : {}),
          ...(used && !guest ? { item: used } : {}),
          ...(anonymous && !guest ? { anonymous: true } : {}),
          ...(secret && !guest ? { secret: true } : {}),
          ...(form.dataset.replyTo ? { replyTo: form.dataset.replyTo } : {}),
        },
        ...(guest ? { guest } : {}),
      });
      if (form.dataset.replyTo) {
        // A reply sits under what it answers: the list is read again.
        delete form.dataset.replyTo;
        form.querySelector<HTMLElement>(".comment-replying").hidden = true;
        first = load(false);
        await first;
      } else
        item
          .querySelector(".comment-list")
          .append(await commentItem(saved, log));
      form.querySelector<HTMLTextAreaElement>(".comment-text").value = "";
      form.querySelector<HTMLInputElement>(".comment-dice").checked = false;
      form.querySelector<HTMLInputElement>(".comment-anonymous-check").checked =
        false;
      form.querySelector<HTMLInputElement>(".comment-secret-check").checked =
        false;
      actionChoice.value = "";
      if (used || action) {
        // The inventory changed: read it again when next needed.
        state.postItems = null;
        state.shopLoaded = false;
        itemChoice.replaceChildren(itemChoice.options[0]);
        delete itemChoice.dataset.loaded;
      }
    });
  };
  return item;
}
/**
 * write.skin.php's picture in edit mode: a replacement file (members) or
 * address, and on a plain board, where a picture is optional, 로그 삭제.
 */
function pictureEdits(current): EditField[] {
  const board = current.data.board ?? "default";
  const kind = kindOf(board);
  if (["qna", "settlement"].includes(kind)) return [];
  if (kind === "text" && uploadCountOf(board) === 0 && !current.data.image)
    return [];
  return [
    ...(state.member
      ? [
          {
            name: "pictureFile",
            label: "그림 바꾸기 (파일)",
            type: "file",
            accept: "image/*",
          },
        ]
      : []),
    {
      name: "pictureUrl",
      label: "그림 바꾸기 (HTTPS 주소)",
      type: "url",
      max: 2000,
    },
    ...(kind === "text" && current.data.image
      ? [{ name: "pictureRemove", label: "그림 삭제", type: "checkbox" }]
      : []),
  ];
}
/** A file's size as get_filesize shows it: 1.2M, 34.5K or 120. */
function sizeText(size) {
  const bytes = Number(size) || 0;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}`;
}
/** A plain board's 첨부파일 in edit mode: each one's 삭제, and one to add. */
function attachmentEdits(current): EditField[] {
  const board = current.data.board ?? "default";
  if (kindOf(board) !== "text") return [];
  const files = current.data.attachments ?? [];
  return [
    ...files.map((file) => ({
      name: `drop:${file.url}`,
      label: `첨부파일 삭제: ${file.name}`,
      type: "checkbox",
    })),
    ...(state.member && uploadCountOf(board) > 0
      ? [
          {
            name: "attachmentAdd",
            label: "첨부파일 추가",
            type: "file",
            accept:
              ".pdf,.zip,.txt,.mp3,.ogg,.opus,.wav,image/*,application/pdf,application/zip,text/plain,audio/*",
          },
          ...(state.boards.find((row) => row.id === board)?.data.fileContent
            ? [{ name: "attachmentNote", label: "추가할 파일 설명", max: 255 }]
            : []),
        ]
      : []),
  ];
}
/** Who wrote a post or comment, as far as the reader is shown. */
const writerOf = (row) => row.createdBy ?? row.data.owner ?? null;
async function commentItem(comment, log) {
  const item = document.createElement("li");
  item.className = "comment";
  item.dataset.id = comment.id;
  // 댓글 답변 (wr_comment_reply): a step in for each level.
  if (comment.data.depth) {
    item.classList.add("comment-reply");
    item.style.setProperty("--depth", String(comment.data.depth));
  }
  // The post's own writer commenting (view_comment.skin.php:74-80): not
  // where either is 익명.
  if (
    !log.data.anonymous &&
    !comment.data.anonymous &&
    writerOf(comment) &&
    writerOf(comment) === writerOf(log)
  )
    item.classList.add("owner");
  const author = document.createElement("strong");
  author.className = "author";
  // The site owner's mark (view_comment.skin.php:38's ico_admin).
  // 관리자 아이콘 (ico_admin) in its place, where the owner set one.
  if (comment.data.admin === true && !comment.data.anonymous)
    author.append(
      state.adminIcon
        ? Object.assign(document.createElement("img"), {
            className: "admin-mark admin-icon",
            src: state.adminIcon,
            alt: "관리자",
          })
        : Object.assign(document.createElement("span"), {
            className: "admin-mark",
            textContent: "관리자",
          }),
    );
  author.append(await speakerLabel(comment));
  // 「작성자」 원글 작성자's 접두문자 and 접미문자 (view_comment.skin.php:93-96).
  if (item.classList.contains("owner")) {
    const { prefix = "", suffix = "" } = state.ownerMarks ?? {};
    if (prefix) author.prepend(`${prefix} `);
    if (suffix) author.append(` ${suffix}`);
  }
  item.append(author, " ");
  if (comment.data.dice) {
    const dice = document.createElement("span");
    dice.className = "dice";
    dice.textContent = diceText(comment);
    item.append(dice, " ");
  }
  // 비밀글 (bbs/view_comment.php:39): its text to the staff and the two
  // writers only; they see its mark.
  if (comment.data.hidden)
    item.append(
      Object.assign(document.createElement("span"), {
        className: "secret-comment",
        textContent: "비밀글 입니다.",
      }),
    );
  else {
    if (comment.data.secret)
      item.append(
        Object.assign(document.createElement("span"), {
          className: "secret-mark",
          textContent: "🔒",
          title: "비밀글",
        }),
        " ",
      );
    item.append(
      postText(comment.data.text ?? "", await loadEmoticons(), {
        pictureBoard: kindOf(log.data.board) === "image",
      }),
    );
  }
  // The comment's own address (/post/<id>/comment/<id>).
  const link = document.createElement("a");
  link.className = "permalink";
  link.href = `/post/${encodeURIComponent(comment.data.logId)}/comment/${encodeURIComponent(comment.id)}`;
  link.title = "댓글 링크";
  link.textContent = "#";
  item.append(" ", link);
  for (const action of Array.isArray(comment.data.actions)
    ? comment.data.actions
    : [])
    item.append(actionItem(action));
  // The comment's time in full (view_comment.skin.php's co-footer).
  item.append(
    " ",
    Object.assign(document.createElement("time"), {
      className: "comment-time",
      dateTime: comment.createdAt ?? "",
      textContent: fullTime(comment.createdAt),
    }),
  );
  // basic/view_comment.skin.php:71's 답변, on a plain board, five deep.
  const commentForm = () =>
    item.closest(".log")?.querySelector<HTMLFormElement>(".comment-form");
  const commentBoard = state.boards.find(
    (row) => row.id === (log.data.board ?? "default"),
  );
  if (
    kindOf(log.data.board) === "text" &&
    (comment.data.depth ?? 0) < 5 &&
    commentBoard?.data.enabled !== false &&
    (boardStaff(log.data.board) ||
      state.owner ||
      state.level >= (commentBoard?.data.commentLevel ?? 2))
  ) {
    const answer = document.createElement("button");
    answer.type = "button";
    answer.className = "answer";
    answer.textContent = "답변";
    answer.onclick = () => {
      const form = commentForm();
      if (!form) return;
      form.dataset.replyTo = comment.id;
      const note = form.querySelector<HTMLElement>(".comment-replying");
      note.hidden = false;
      note.querySelector("span").textContent = `${
        item.querySelector(".author")?.textContent ?? ""
      }님께 답변`;
      form.querySelector<HTMLTextAreaElement>(".comment-text").focus();
    };
    item.append(" ", answer);
  }
  const guestComment = !state.member && Boolean(comment.data.guest);
  if (mine(comment) || boardStaff(log.data.board) || guestComment) {
    const change = document.createElement("button");
    change.type = "button";
    change.className = "edit";
    change.textContent = "수정";
    change.onclick = () =>
      edit(
        "댓글 수정",
        [
          ...(guestComment
            ? [
                {
                  name: "password",
                  label: "비밀번호",
                  type: "password",
                  required: true,
                  max: 64,
                },
              ]
            : []),
          {
            name: "text",
            label: "댓글",
            value: comment.data.text,
            multiline: true,
            max: 2000,
          },
          ...(guestComment
            ? []
            : [
                {
                  name: "secret",
                  label: "비밀글",
                  type: "checkbox",
                  value: comment.data.secret === true,
                },
              ]),
        ],
        async ({ text, password, secret = false }) => {
          if (!text && !comment.data.dice)
            throw new Error("댓글을 입력해 주세요.");
          const { document: saved } = await mutate("community/comments:write", {
            id: comment.id,
            data: {
              ...comment.data,
              text,
              ...(guestComment ? {} : { secret }),
            },
            revision: comment.revision,
            ...(guestComment ? { guest: { password } } : {}),
          });
          item.replaceWith(await commentItem(saved, log));
        },
      );
    item.append(" ", change);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "삭제";
    remove.onclick = () =>
      guestComment
        ? withGuestPassword("댓글 삭제", async (guest) => {
            await mutate("community/comments:remove", {
              id: comment.id,
              guest,
            });
            item.remove();
          })
        : run(async () => {
            await mutate("community/comments:remove", {
              id: comment.id,
            });
            item.remove();
          });
    item.append(" ", remove);
  }
  return item;
}
/** 윗글 and 아래글 (view.skin.php) under a plain board's post shown alone. */
async function showNeighbors(post) {
  const nav = $("logNeighbors");
  nav.replaceChildren();
  nav.hidden = true;
  if (kindOf(post.data.board) !== "text") return;
  const { previous, next } = await query("community/posts:neighbors", {
    id: post.id,
  });
  for (const [label, found] of [
    ["윗글", previous],
    ["아래글", next],
  ]) {
    if (!found) continue;
    const link = document.createElement("a");
    link.href = `/post/${encodeURIComponent(found.id)}`;
    link.textContent = `${label}: ${found.title || `${found.number}번 글`}`;
    link.onclick = (event) => {
      event.preventDefault();
      run(() => openPost(found.id));
    };
    nav.append(link);
  }
  nav.hidden = !nav.childElementCount;
}
/**
 * 조회수: a post opened on its own counts once until the browser closes
 * (bbs/board.php:116's ss_view_ session), and never holds the page up.
 */
async function countView(id, { always = false } = {}) {
  const key = `neo-avocado:viewed:${id}`;
  let seen = false;
  try {
    seen = Boolean(sessionStorage.getItem(key));
  } catch {
    // Without storage, each opening counts.
  }
  // A priced post asks every time: the server charges it once a post.
  if (seen && !always) return;
  await mutate("community/posts:hit", {
    id,
    ...(seen ? { count: false } : {}),
  });
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // It counts again next time.
  }
}
// bo_use_file_content: a 설명 box for each file chosen.
$("logAttachments").addEventListener("change", () => {
  const board = state.boards.find((row) => row.id === state.board);
  const notes = $("logAttachmentNotes");
  const files = [...($<HTMLInputElement>("logAttachments").files ?? [])];
  notes.replaceChildren(
    ...(board?.data.fileContent
      ? files.map((file) => {
          const label = document.createElement("label");
          const input = document.createElement("input");
          input.maxLength = 255;
          label.append(`${file.name} 설명 `, input);
          return label;
        })
      : []),
  );
  notes.hidden = !notes.childElementCount;
});
/** Opens the log form to answer `log` (bbs/write.php?w=r), titled Re:. */
function startReply(log) {
  state.replyTo = log.id;
  $("logReplying").hidden = false;
  $("logReplyingTitle").textContent =
    `답변: ${log.data.title || `${log.data.number ?? ""}번 글`}`;
  const title = $<HTMLInputElement>("logTitle");
  if (!title.value.trim()) title.value = `Re: ${log.data.title ?? ""}`.trim();
  $("logForm").scrollIntoView?.();
  $<HTMLTextAreaElement>("logText").focus();
}
function endReply() {
  state.replyTo = null;
  $("logReplying").hidden = true;
}
$("cancelReply").onclick = () => {
  if ($<HTMLInputElement>("logTitle").value.startsWith("Re:"))
    $<HTMLInputElement>("logTitle").value = "";
  endReply();
};
$("tabLogs").onclick = () =>
  run(async () => {
    showTab("logs");
    if (state.newPost) await loadLogs();
  });
$("logForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    // Visitors cannot upload; they may link an HTTPS picture instead.
    const guest = state.member ? null : guestCredentials();
    // bo_upload_count: a plain board's post takes that many pictures.
    const chosen = guest
      ? []
      : [...($<HTMLInputElement>("logImage").files ?? [])];
    const most = kindOf() === "text" ? uploadCountOf() : 1;
    if (chosen.length > most)
      return say(
        most
          ? `그림은 ${most}개까지 올릴 수 있습니다.`
          : "이 게시판은 그림을 올릴 수 없습니다.",
      );
    const file = chosen[0] ?? null;
    // write.skin.php's UPLOAD or URL: a picture's address in place of a file.
    const address = $<HTMLInputElement>("logImageUrl").value.trim();
    if (file && address)
      return say("그림은 파일과 주소 중 하나만 정해 주세요.");
    if (!file && !address && kindOf() === "image")
      return say("그림을 골라 주세요.");
    say("올리는 중…");
    const image = file ? await uploadMedia(file) : null;
    const files = [];
    for (const more of chosen.slice(1))
      files.push((await uploadMedia(more)).url);
    // 첨부파일: a plain board's files, counted with its pictures.
    const attaching = guest
      ? []
      : [...($<HTMLInputElement>("logAttachments").files ?? [])];
    if (attaching.length && chosen.length + attaching.length > most)
      return say(`파일은 그림과 합쳐 ${most}개까지 올릴 수 있습니다.`);
    // 파일 업로드 용량 (bo_upload_size), checked before anything goes up.
    const most_mb = boardSetting(state.board, "uploadSize", 0);
    if (
      most_mb &&
      [...chosen, ...attaching].some((file) => file.size > most_mb * 1048576)
    )
      return say(`파일은 ${most_mb}MB까지 올릴 수 있습니다.`);
    const notes = [
      ...$("logAttachmentNotes").querySelectorAll<HTMLInputElement>("input"),
    ].map((input) => input.value.trim());
    const attachments = [];
    for (const [n, file] of attaching.entries()) {
      const stored = await uploadMedia(file);
      attachments.push({
        url: stored.url,
        name: stored.name ?? file.name,
        size: stored.size ?? file.size,
        type: stored.contentType ?? file.type,
        ...(notes[n] ? { note: notes[n] } : {}),
      });
    }
    const links = [
      $<HTMLInputElement>("logLink1").value.trim(),
      $<HTMLInputElement>("logLink2").value.trim(),
    ].filter(Boolean);
    const character = guest ? "" : $<HTMLSelectElement>("logCharacter").value;
    const action = guest ? "" : $<HTMLSelectElement>("logAction").value;
    const materials =
      action === "combine"
        ? [...$<HTMLSelectElement>("logMaterials").selectedOptions].map(
            (option) => option.value,
          )
        : [];
    if (action === "combine" && !materials.length)
      return say("조합 재료를 골라 주세요.");
    if (materials.length > 3)
      return say("조합 재료는 3개까지 고를 수 있습니다.");
    const used = guest ? "" : $<HTMLSelectElement>("logItem").value;
    const options =
      kindOf() === "image"
        ? {
            wide: $<HTMLInputElement>("logWide").checked,
            fold: $<HTMLInputElement>("logFold").checked,
            ...(guest
              ? {}
              : {
                  membersOnly: $<HTMLInputElement>("logMembersOnly").checked,
                  adult: $<HTMLInputElement>("logAdult").checked,
                  anonymous: $<HTMLInputElement>("logAnonymous").checked,
                }),
          }
        : {};
    const { document: log } = await mutate("community/posts:write", {
      data: {
        image: image?.url ?? (address || null),
        text: $<HTMLTextAreaElement>("logText").value.trim(),
        board: state.board,
        title: $<HTMLInputElement>("logTitle").value.trim(),
        category: $<HTMLSelectElement>("logCategory").value,
        secret: $<HTMLInputElement>("logSecret").checked,
        ...(character ? { character } : {}),
        ...($<HTMLInputElement>("logDice").checked ? { dice: true } : {}),
        ...(links.length ? { links } : {}),
        ...(files.length ? { files } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...options,
        ...(action === "combine" ? { action, materials } : {}),
        ...(action === "explore" ? { action } : {}),
        ...(used ? { item: used } : {}),
        ...(state.replyTo ? { replyTo: state.replyTo } : {}),
      },
      ...(guest ? { guest } : {}),
    });
    endReply();
    if (action || used) forgetInventory();
    state.ownPosts.add(log.id);
    if (state.newPost === log.id) showNewPost(null);
    const added = await logItem(log);
    $("logs").prepend(added);
    $<HTMLFormElement>("logForm").reset?.();
    $("logAttachmentNotes").replaceChildren();
    $("logAttachmentNotes").hidden = true;
    $<HTMLSelectElement>("logCharacter").value = character;
    configureBoard();
    say("로그를 올렸습니다.");
    // 췩: the picture holds its place; its words follow at once
    // (mmb/write_update.skin.php sends the writer to write.php?w=u).
    if (log.data.writing) {
      say("자리를 잡았습니다. 이어서 글을 써 주세요.");
      added.querySelector<HTMLButtonElement>(".edit")?.click();
    }
  });
};
export async function loadBoards() {
  const {
    boards,
    groups: listed,
    emoticons,
  } = await query("community/boards:boards");
  // gr_device (G5_IS_MOBILE): a group's boards for PC or mobile only.
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  state.boards = boards.filter(
    (row) => !row.data.device || row.data.device === (mobile ? "mobile" : "pc"),
  );
  state.groups = listed;
  state.emoticons = emoticons;
  // As in the original, there is nothing to read or post on until the owner
  // makes a board (adm/board_form.php).
  $("noPublicBoards").hidden = state.boards.length > 0;
  $("noPublicBoards").textContent = state.member
    ? "아직 게시판이 없습니다. 운영자가 게시판을 만들면 글을 쓸 수 있습니다."
    : "손님에게 공개된 게시판이 없습니다.";
  $("logs").hidden = $("board").hidden = !state.boards.length;
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
  const option = (row) => new Option(row.data.name, row.id);
  const grouped = (row) => groups.some((group) => group.id === row.data.group);
  $("board").replaceChildren(
    ...state.boards.filter((row) => !grouped(row)).map(option),
    ...groups
      .map((group) => {
        const boards = state.boards.filter(
          (row) => row.data.group === group.id,
        );
        if (!boards.length) return null;
        const set = document.createElement("optgroup");
        set.label = group.data.name;
        set.append(...boards.map(option));
        return set;
      })
      .filter(Boolean),
  );
  $<HTMLSelectElement>("board").value = state.board;
  configureBoard();
}
export function configureBoard() {
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
  // bo_write_max, under the text's own limit; HTML boards have none.
  const most = Number(board?.data.writeMax) || 0;
  area.maxLength = board?.data.html
    ? 12000
    : most > 0 && !boardStaff()
      ? Math.min(most, 2000)
      : 2000;
  // bo_insert_content: a new post starts from the board's text.
  if (!area.value.trim() || area.value === area.dataset.inserted) {
    area.value = board?.data.insertContent ?? "";
    area.dataset.inserted = area.value;
  }
  $("logHtmlHint").hidden = !board?.data.html;
  $("logInlineImage").hidden = !board?.data.html;
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
  $("logAttachmentsLabel").hidden = kind !== "text" || uploads === 0;
  // 리스트에서 파일 사용 (bo_use_list_file): off, files show on a post alone.
  $("logs").classList.toggle(
    "no-list-file",
    kind === "text" && board?.data.listFile === false,
  );
  $("logTitleLabel").hidden = !pictures;
  // A settlement names its category (정산 분류); a guest may ask in secret.
  $<HTMLSelectElement>("logCategory").required = kind === "settlement";
  // Guests write secret posts too, opened again with their password.
  $("logSecretLabel").classList.remove("member-only");
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
  const combine = $("logAction").querySelector<HTMLOptionElement>(
    'option[value="combine"]',
  );
  combine.hidden = combine.disabled = !state.combining;
  $("logMaterials").closest("label").hidden = !state.combining;
}
wireItemChoice($("logItem"));
// 조합 takes the inventory's craft materials (it_use_recepi), up to three.
$("logMaterials").onfocus = $("logMaterials").onpointerdown = () =>
  run(async () => {
    if ($("logMaterials").dataset.loaded) return;
    $("logMaterials").dataset.loaded = "1";
    for (const { row, item, owner } of await postInventory())
      if (owner && item?.craftMaterial === true)
        $("logMaterials").append(
          new Option(`${row.data.name ?? row.data.item} (${owner})`, row.id),
        );
  });
wireSpeakerChoice($("logCharacter"));
// An uploaded picture goes into the HTML body at the cursor; the post's
// address of it is what Naru's media library counts as using it.
$("logInlineFile").onchange = () =>
  run(async () => {
    const file = $<HTMLInputElement>("logInlineFile").files?.[0];
    if (!file) return;
    say("그림을 올리는 중…");
    const uploaded = await uploadMedia(file);
    const area = $<HTMLTextAreaElement>("logText");
    area.setRangeText(
      `<img src="${uploaded.url}" alt="">`,
      area.selectionStart,
      area.selectionEnd,
      "end",
    );
    $<HTMLInputElement>("logInlineFile").value = "";
    say("그림을 넣었습니다.");
  });
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
async function loadEmoticons() {
  if (state.emoticons !== null) return state.emoticons;
  const member = state.member;
  const { emoticons } = await query("community/boards:boards");
  if (state.member !== member) return [];
  state.emoticons = emoticons;
  return state.emoticons;
}
