// Boards, logs and comments: reading, writing, tags and emoticons.

import { emoticonContent } from "../emoticons.js";
import { sanitizedFragment } from "../content-renderer.js";
import {
  $,
  allDocuments,
  caller,
  COLLECTION,
  COMMENT_PAGE,
  collection,
  edit,
  formatTime,
  guestCredentials,
  LOG_PAGE,
  mine,
  preloadNicks,
  run,
  say,
  showTab,
  state,
  uploadManaged,
  withGuestPassword,
  removeAll,
  route,
  cursorPages,
  renderPages,
} from "./core.js";
import {
  actionItem,
  diceText,
  postText,
  speakerLabel,
  wireItemChoice,
  wireSpeakerChoice,
} from "./posts.js";
import { showNewPost } from "./live.js";

const LOG_SORT = [
  ["notice", "desc"],
  [{ metadata: "createdAt" }, "desc"],
];
/** A tag search: logs whose tags hold `tag`. */
const tagOptions = (tag) => ({ where: { has: ["tags", tag] } });
/**
 * What a board is (bo_skin): image logs (mmb), plain posts, questions and
 * answers (qna), or settlement requests (caculate).
 */
export const kindOf = (id = state.board) =>
  state.boards.find((row) => row.id === (id ?? "default"))?.data.kind ??
  "image";
/** The current board's posts, ten to a page (or those with the tag). */
const logPages = cursorPages((after, includeTotal) =>
  // A Q&A board shows others' secret questions locked, so a function reads it.
  kindOf() === "qna" && !state.tag
    ? caller().call("community/posts:questions", { board: state.board, after })
    : collection(COLLECTION.logs).list({
        filter: { board: state.board },
        // Notices (bo_notice) sort first: true above false and unset.
        sort: LOG_SORT,
        size: LOG_PAGE,
        after,
        ...(includeTotal ? { includeTotal: true } : {}),
        ...(state.tag ? tagOptions(state.tag) : {}),
      }),
);
/** Shows a page of the board: the first unless `page` is given. */
/**
 * The list's address: the board, and its page, tag or search
 * (#/logs/free/page/3, #/logs/free/tag/봄, #/logs/free/search/바다).
 */
function logsPath() {
  const base = ["logs", state.board];
  if (state.search) return [...base, "search", state.search];
  if (state.tag) return [...base, "tag", state.tag];
  if (state.logPage > 1) return [...base, "page", String(state.logPage)];
  return base;
}
/** Writes the list's address, while the list is what is shown. */
function routeList() {
  if (!$("logsView").hidden && $("logFocusPanel").hidden)
    route(logsPath(), { replace: true });
}
export async function loadLogs({ page: number = 1 } = {}) {
  if (!state.member && !state.boards.length) return $("logs").replaceChildren();
  if (state.search) return showSearch();
  if (number === 1) logPages.reset();
  const page = await logPages.page(number);
  state.logPage = page.number;
  routeList();
  await preloadNicks(page.documents);
  $("logs").replaceChildren();
  if (page.number === 1) showNewPost(null);
  $("tagFilter").hidden = !state.tag;
  $("searchMore").hidden = true;
  $("tagName").textContent = state.tag ? `#${state.tag} 태그가 달린 로그` : "";
  const shown = [];
  for (const log of page.documents) {
    // Questions show whole, as the qna skin lists them.
    const item = await logItem(kindOf() === "qna" ? log : previewOf(log));
    if (log.data.notice) item.classList.add("notice");
    $("logs").append(item);
    shown.push([log.id, item]);
  }
  renderPages(
    $("logPages"),
    page.number,
    Math.ceil((logPages.total ?? 0) / LOG_PAGE),
    (next) => loadLogs({ page: next }),
  );
  await showCommentCounts(shown);
}
/** Fills each log's "댓글 (n)" from one read-only count call. */
async function showCommentCounts(entries) {
  const ids = entries.map(([id]) => id).filter(Boolean);
  if (!ids.length) return;
  // Counts are a decoration: a page without them is still a page.
  const counts = await caller()
    .call("community/boards:commentCounts", {
      ids: ids.slice(0, 20),
    })
    .then(
      (result) => result.counts ?? {},
      () => ({}),
    );
  for (const [id, item] of entries)
    if (typeof counts[id] === "number")
      item.querySelector(".comments summary").textContent =
        `댓글 (${counts[id]})`;
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
  const page = await collection(COLLECTION.logs).list({
    filter: { board: state.board, number },
    size: 1,
  });
  const log = page.documents[0];
  if (!log) return say("자료를 찾을 수 없습니다.");
  await openPost(log.id, { log });
}
/**
 * One post on its own (?log=N&single=Y), at its permanent address
 * #/post/<id>, which survives a move to another board; with `comment`, its
 * comments open at that comment (#/post/<id>/comment/<id>).
 */
export async function openPost(id, { comment = null, log = null } = {}) {
  const post = log ?? (await collection(COLLECTION.logs).get(id));
  const board = post.data.board ?? "default";
  showTab("logs");
  if (board !== state.board && state.boards.some((row) => row.id === board)) {
    state.board = board;
    $("board").value = board;
    configureBoard();
    await loadLogs();
  }
  await preloadNicks([post]);
  const item = await logItem(post);
  $("logFocus").replaceChildren(item);
  $("logFocusPanel").hidden = false;
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
  $("logFocus").replaceChildren();
  $("logFocusPanel").hidden = true;
  route(logsPath(), { replace: true });
};
/** Lists the current board's logs with `tag` (mmb's hash search). */
export async function searchTag(tag) {
  showTab("logs");
  state.tag = tag;
  await loadLogs();
}
$("clearTag").onclick = () =>
  run(async () => {
    state.tag = null;
    state.search = null;
    $("searchText").value = "";
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
  const page = await caller().call("community/posts:search", {
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
    const text = $("searchText").value.trim();
    state.tag = null;
    state.search = text || null;
    await loadLogs();
  });
};
export async function logItem(log) {
  const item = $("logTemplate").content.firstElementChild.cloneNode(true);
  item.dataset.id = log.id;
  // The post's number links to its permanent address.
  const number = document.createElement("a");
  number.href = `#/post/${encodeURIComponent(log.id)}`;
  number.textContent = log.data.number ? `No. ${log.data.number}` : "링크";
  item
    .querySelector(".log-number")
    .replaceChildren(log.data.notice ? "공지 · " : "", number);
  const pin = item.querySelector(".pin");
  const move = item.querySelector(".move");
  pin.hidden = move.hidden = state.role !== "moderator" || log.data.locked;
  pin.textContent = log.data.notice ? "공지 해제" : "공지로";
  pin.onclick = () =>
    run(async () => {
      const { document: saved } = await caller().call(
        "community/boards:moderatePost",
        {
          id: log.id,
          notice: !log.data.notice,
        },
      );
      item.replaceWith(await logItem(saved));
      await loadLogs();
    });
  move.onclick = () =>
    edit(
      "다른 게시판으로 이동",
      [
        {
          name: "board",
          label: "게시판",
          value: log.data.board ?? "default",
          options: state.boards.map((row) => [row.id, row.data.name]),
        },
      ],
      async ({ board }) => {
        await caller().call("community/boards:moderatePost", {
          id: log.id,
          board,
        });
        item.remove();
      },
    );
  const image = item.querySelector(".log-image");
  if (log.data.image && !log.data.locked) image.src = log.data.image;
  else image.remove();
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
        const { document: opened } = await caller().call(
          "community/posts:open",
          { id: log.id, password: password.value },
        );
        item.replaceWith(await logItem(opened));
      });
    };
    item.querySelector(".log-text").replaceChildren("비밀 질문입니다. ", form);
  } else if (log.data.locked)
    item.querySelector(".log-text").textContent =
      "비밀글입니다. 본문을 볼 수 없습니다.";
  else if (log.data.format === "html" && !log.data.truncated) {
    item.querySelector(".log-text").classList.add("rich-text");
    item
      .querySelector(".log-text")
      .append(sanitizedFragment(document, log.data.text));
  } else item.querySelector(".log-text").append(postText(log.data.text));
  if (log.data.dice && !log.data.locked) {
    item.querySelector(".log-dice").hidden = false;
    item.querySelector(".log-dice").textContent = diceText(log);
  }
  item.querySelector(".log-title").textContent =
    `${log.data.settlement ? `[${log.data.settlement.state}] ` : ""}${log.data.secret ? "🔒 " : ""}${log.data.title ?? ""}${log.data.category ? ` · ${log.data.category}` : ""}`;
  if (log.data.settlement) item.classList.add("settled");
  item.querySelector(".author").replaceChildren(await speakerLabel(log));
  item.querySelector("time").textContent = formatTime(log.createdAt);
  const remove = item.querySelector(".delete");
  const guestPost = !state.member && Boolean(log.data.guest);
  remove.hidden = !mine(log) && state.role !== "moderator" && !guestPost;
  const change = item.querySelector(".edit");
  change.hidden =
    Boolean(log.data.locked) ||
    (!mine(log) && state.role !== "moderator" && !guestPost);
  // A settled request stays as it was settled (caculate's wr_10).
  if (log.data.settlement && state.role !== "moderator")
    remove.hidden = change.hidden = true;
  if (
    kindOf(log.data.board) === "settlement" &&
    state.role === "moderator" &&
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
            value: log.data.settlement?.state ?? "완료",
            options: [
              ["완료", "완료"],
              ["반려", "반려"],
              ["보류", "보류"],
            ],
          },
          {
            name: "exp",
            label: "캐릭터 경험치 지급",
            type: "number",
            value: 0,
          },
          { name: "money", label: "오너 아보 지급", type: "number", value: 0 },
          { name: "memo", label: "답변", multiline: true, max: 500 },
        ],
        async ({ state: settled, exp, money, memo }) => {
          const { document: saved } = await caller().call(
            "community/posts:settle",
            {
              id: log.id,
              state: settled,
              exp: Number(exp) || 0,
              money: Number(money) || 0,
              memo,
            },
          );
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
      ],
      async ({ text, title, category, secret = false, password }) => {
        const { document: saved } = await caller().call(
          "community/posts:write",
          {
            id: log.id,
            data: { ...current.data, text, title, category, secret },
            revision: current.revision,
            ...(guestPost ? { guest: { password } } : {}),
          },
        );
        item.replaceWith(await logItem(saved));
      },
    );
  change.onclick = () =>
    log.data.truncated
      ? run(async () =>
          beginEdit(await collection(COLLECTION.logs).get(log.id)),
        )
      : beginEdit(log);
  if (log.data.truncated && !log.data.locked) {
    const expand = document.createElement("button");
    expand.type = "button";
    expand.textContent = "본문 보기";
    expand.onclick = () =>
      run(async () => {
        const full = await collection(COLLECTION.logs).get(log.id);
        item.replaceWith(
          await logItem({ ...full, data: { ...full.data, truncated: false } }),
        );
      });
    item.querySelector(".log-text").after(expand);
  }
  remove.onclick = () =>
    guestPost
      ? withGuestPassword("로그 삭제", async (guest) => {
          await removeAll("community/posts:remove", { id: log.id, guest });
          item.remove();
        })
      : run(async () => {
          if (!confirm("이 로그를 지울까요?")) return;
          await removeAll("community/posts:remove", { id: log.id });
          item.remove();
        });
  // 댓글은 펼쳤을 때 처음 읽는다.
  const comments = item.querySelector(".comments");
  comments.hidden = Boolean(log.data.locked);
  let cursor;
  const load = (more) =>
    run(async () => {
      const page = await collection(COLLECTION.comments).list({
        filter: { logId: log.id },
        sort: [[{ metadata: "createdAt" }, "asc"]],
        size: COMMENT_PAGE,
        after: more ? cursor : null,
      });
      await preloadNicks(page.documents);
      const list = item.querySelector(".comment-list");
      if (!more) list.replaceChildren();
      for (const comment of page.documents)
        list.append(await commentItem(comment));
      cursor = page.nextCursor;
      item.querySelector(".more-comments").hidden = !cursor;
    });
  comments.ontoggle = () => {
    if (comments.open && cursor === undefined) load(false);
  };
  // Opens the comments at one, reading on until it is found.
  item.showComment = async (id) => {
    comments.open = true;
    if (cursor === undefined) await load(false);
    const find = () =>
      item.querySelector(`.comment[data-id="${CSS.escape(id)}"]`);
    while (!find() && cursor) await load(true);
    const found = find();
    found?.classList.add("linked");
    return Boolean(found);
  };
  item.querySelector(".more-comments").onclick = () => load(true);
  const form = item.querySelector(".comment-form");
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
            const input = form.querySelector(".comment-text");
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

  const speakerChoice = form.querySelector(".comment-character");
  const actionChoice = form.querySelector(".comment-action");
  const itemChoice = form.querySelector(".comment-item");
  const materialsChoice = form.querySelector(".comment-materials");
  wireSpeakerChoice(speakerChoice);
  wireItemChoice(itemChoice);
  // Combination takes up to three of the inventory's items (make_1…make_3).
  actionChoice.onchange = () =>
    run(async () => {
      materialsChoice.hidden = actionChoice.value !== "combine";
      if (materialsChoice.hidden || materialsChoice.dataset.loaded) return;
      materialsChoice.dataset.loaded = "1";
      state.postItems ??= await allDocuments(COLLECTION.inventory, {
        owner: state.member.id,
      });
      for (const row of state.postItems) {
        const option = document.createElement("option");
        option.value = row.id;
        option.textContent = row.data.name ?? row.data.item;
        materialsChoice.append(option);
      }
    });
  const board = state.boards.find(
    (row) => row.id === (log.data.board ?? "default"),
  );
  form.querySelector(".comment-actions").hidden =
    !state.member || !board?.data.actions;
  form.hidden =
    board?.data.enabled === false ||
    (state.role !== "moderator" &&
      state.level < (board?.data.commentLevel ?? 2));
  form.onsubmit = (event) => {
    event.preventDefault?.();
    run(async () => {
      const text = form.querySelector(".comment-text").value.trim();
      const dice = form.querySelector(".comment-dice").checked;
      const character = speakerChoice.value;
      const action = actionChoice.value;
      const used = itemChoice.value;
      const materials = [...materialsChoice.selectedOptions].map(
        (option) => option.value,
      );
      if (action === "combine" && (!materials.length || materials.length > 3))
        return say("조합 재료를 1~3개 선택해 주세요.");
      if (!text && !dice && !action && !used) return;
      const guest = state.member ? null : guestCredentials();
      const { document: saved } = await caller().call(
        "community/comments:write",
        {
          data: {
            logId: log.id,
            text,
            dice,
            ...(character && !guest ? { character } : {}),
            ...(action && !guest ? { action } : {}),
            ...(action === "combine" && !guest ? { materials } : {}),
            ...(used && !guest ? { item: used } : {}),
          },
          ...(guest ? { guest } : {}),
        },
      );
      item.querySelector(".comment-list").append(await commentItem(saved));
      form.querySelector(".comment-text").value = "";
      form.querySelector(".comment-dice").checked = false;
      actionChoice.value = "";
      if (used || action) {
        // The inventory changed: read it again when next needed.
        state.postItems = null;
        state.shopLoaded = false;
        itemChoice.replaceChildren(itemChoice.options[0]);
        delete itemChoice.dataset.loaded;
        materialsChoice.replaceChildren();
        materialsChoice.hidden = true;
        delete materialsChoice.dataset.loaded;
      }
    });
  };
  return item;
}
async function commentItem(comment) {
  const item = document.createElement("li");
  item.className = "comment";
  item.dataset.id = comment.id;
  const author = document.createElement("strong");
  author.className = "author";
  author.append(await speakerLabel(comment));
  item.append(author, " ");
  if (comment.data.dice) {
    const dice = document.createElement("span");
    dice.className = "dice";
    dice.textContent = diceText(comment);
    item.append(dice, " ");
  }
  item.append(postText(comment.data.text ?? "", await loadEmoticons()));
  // The comment's own address (#/post/<id>/comment/<id>).
  const link = document.createElement("a");
  link.className = "permalink";
  link.href = `#/post/${encodeURIComponent(comment.data.logId)}/comment/${encodeURIComponent(comment.id)}`;
  link.title = "댓글 링크";
  link.textContent = "#";
  item.append(" ", link);
  for (const action of Array.isArray(comment.data.actions)
    ? comment.data.actions
    : [])
    item.append(actionItem(action));
  const guestComment = !state.member && Boolean(comment.data.guest);
  if (mine(comment) || state.role === "moderator" || guestComment) {
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
            max: 500,
          },
        ],
        async ({ text, password }) => {
          if (!text && !comment.data.dice)
            throw new Error("댓글을 입력해 주세요.");
          const { document: saved } = await caller().call(
            "community/comments:write",
            {
              id: comment.id,
              data: { ...comment.data, text },
              revision: comment.revision,
              ...(guestComment ? { guest: { password } } : {}),
            },
          );
          item.replaceWith(await commentItem(saved));
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
            await caller().call("community/comments:remove", {
              id: comment.id,
              guest,
            });
            item.remove();
          })
        : run(async () => {
            await caller().call("community/comments:remove", {
              id: comment.id,
            });
            item.remove();
          });
    item.append(" ", remove);
  }
  return item;
}
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
    const file = guest ? null : $("logImage").files?.[0];
    const address = guest ? $("logImageUrl").value.trim() : "";
    if (!file && !address && kindOf() === "image")
      return say("그림을 골라 주세요.");
    say("올리는 중…");
    const image = file ? await uploadManaged(file) : null;
    const character = guest ? "" : $("logCharacter").value;
    const { document: log } = await caller().call("community/posts:write", {
      data: {
        image: image?.url ?? (address || null),
        text: $("logText").value.trim(),
        board: state.board,
        title: $("logTitle").value.trim(),
        category: $("logCategory").value,
        secret: guest && kindOf() !== "qna" ? false : $("logSecret").checked,
        ...(character ? { character } : {}),
        ...($("logDice").checked ? { dice: true } : {}),
      },
      ...(guest ? { guest } : {}),
    });
    state.ownPosts.add(log.id);
    if (state.newPost === log.id) showNewPost(null);
    $("logs").prepend(await logItem(log));
    $("logForm").reset?.();
    $("logCharacter").value = character;
    configureBoard();
    say("로그를 올렸습니다.");
  });
};
export async function loadBoards() {
  state.boards = await allDocuments(COLLECTION.boards);
  $("noPublicBoards").hidden = Boolean(state.member) || state.boards.length > 0;
  $("logs").hidden = $("board").hidden = !state.boards.length;
  if (!state.boards.length && !state.member) {
    $("board").replaceChildren();
    $("logForm").hidden = true;
    $("logPages").hidden = true;
    return;
  }
  // Posts without a board are on "default", which exists until the admin
  // stores their own, for members.
  if (state.member && !state.boards.some((row) => row.id === "default"))
    state.boards.unshift({
      id: "default",
      data: {
        name: "로그",
        kind: "image",
        enabled: true,
        secret: "optional",
        categories: [],
        writeLevel: 2,
        actions: true,
      },
    });
  if (!state.boards.some((row) => row.id === state.board))
    state.board = state.boards[0].id;
  // Boards under their group's name (adm/boardgroup_list), ungrouped first.
  const groups = (await allDocuments(COLLECTION.boardGroups)).sort(
    (a, b) =>
      (a.data.order ?? 0) - (b.data.order ?? 0) || (a.id < b.id ? -1 : 1),
  );
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
  $("board").value = state.board;
  configureBoard();
}
export function configureBoard() {
  const board = state.boards.find((row) => row.id === state.board);
  $("boardDescription").textContent = board?.data.description ?? "";
  $("logText").maxLength = board?.data.html ? 12000 : 2000;
  $("logHtmlHint").hidden = !board?.data.html;
  $("logInlineImage").hidden = !board?.data.html;
  const kind = kindOf();
  // Pictures belong to image boards; questions and settlements are text.
  const pictures = !["qna", "settlement"].includes(kind);
  $("logImage").required = Boolean(state.member) && kind === "image";
  $("logImageUrl").required = !state.member && kind === "image";
  $("logImageLabel").hidden = !pictures;
  $("logImageUrlLabel").hidden = !pictures;
  $("logTitleLabel").hidden = !pictures;
  // A settlement names its category (정산 분류); a guest may ask in secret.
  $("logCategory").required = kind === "settlement";
  $("logSecretLabel").classList.toggle("member-only", kind !== "qna");
  $("logForm").hidden =
    board?.data.enabled === false ||
    (state.role !== "moderator" && state.level < (board?.data.writeLevel ?? 2));
  $("logCategory").replaceChildren();
  for (const name of ["", ...(board?.data.categories ?? [])]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name || "분류 없음";
    $("logCategory").append(option);
  }
  if (!state.member && board?.data.secret === "required")
    $("logForm").hidden = true;
  $("logSecret").disabled = board?.data.secret !== "optional";
  $("logSecret").checked = board?.data.secret === "required";
}
wireSpeakerChoice($("logCharacter"));
// An uploaded picture goes into the HTML body at the cursor; the post's
// address of it is what keeps the upload (managed uploads, SDK 1.1.0).
$("logInlineFile").onchange = () =>
  run(async () => {
    const file = $("logInlineFile").files?.[0];
    if (!file) return;
    say("그림을 올리는 중…");
    const uploaded = await uploadManaged(file);
    const area = $("logText");
    area.setRangeText(
      `<img src="${uploaded.url}" alt="">`,
      area.selectionStart,
      area.selectionEnd,
      "end",
    );
    $("logInlineFile").value = "";
    say("그림을 넣었습니다.");
  });
$("board").onchange = () =>
  run(async () => {
    state.board = $("board").value;
    route(`logs/${state.board}`, { replace: true });
    state.tag = null;
    state.search = null;
    $("searchText").value = "";
    configureBoard();
    await loadLogs();
  });
async function loadEmoticons() {
  if (state.emoticons !== null) return state.emoticons;
  const member = state.member;
  const rows = await allDocuments(COLLECTION.emoticons);
  if (state.member !== member) return [];
  state.emoticons = rows.filter((row) => !row.data.deleted);
  return state.emoticons;
}
