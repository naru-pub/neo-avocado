// One log as the list shows it (mmb_list_item): its picture, text, speaker,
// dice, actions, links and files, its edits and votes; and, opened alone, the
// posts beside it and its 조회수.
import {
  state,
  mine,
  $,
  boardStaff,
  run,
  mutate,
  edit,
  say,
  query,
  formatTime,
  uploadMedia,
  withGuestPassword,
  preloadNicks,
  guestCredentials,
  type EditField,
} from "./core.js";
import {
  postInventory,
  postText,
  diceText,
  actionItem,
  speakerLabel,
  wireSpeakerChoice,
  wireItemChoice,
} from "./posts.js";
import { emoticonContent } from "../shared/emoticons.js";
import {
  boardSetting,
  imageWidthOf,
  isNew,
  kindOf,
  loadEmoticons,
  loadLogs,
  openPost,
  previewOf,
  uploadCountOf,
} from "./logs.js";
import { startReply } from "./log-form.js";
import { commentItem } from "./comments.js";

/** 2026-10-16 15:11:33, as the original prints a comment's wr_datetime. */
export function fullTime(at) {
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
export function presentOptions(item, log) {
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
export function optionEdits(current) {
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
export function actionEdits(current) {
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
export async function fillActionEdits(character) {
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
export function forgetInventory() {
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
        // bbs/move.php's boards, checked one or more: a 게시판·그룹 관리자
        // moves to boards they administer. 답변글 go with their post.
        ...state.boards
          .filter((row) => boardStaff(row.id))
          .map((row) => ({
            name: `board:${row.id}`,
            label: `${row.data.name}${row.id === (log.data.board ?? "default") ? " (현재)" : ""}`,
            type: "checkbox",
          })),
      ],
      async ({ how, ...checked }) => {
        const boards = Object.entries(checked)
          .filter(([, on]) => on)
          .map(([name]) => name.slice("board:".length));
        if (!boards.length)
          throw Object.assign(new Error("게시판을 하나 이상 골라 주세요."), {
            details: { reason: "no_board" },
          });
        await mutate(
          how === "copy"
            ? "community/boards:copyPost"
            : "community/boards:movePosts",
          { id: log.id, boards },
        );
        say(how === "copy" ? "복사했습니다." : "이동했습니다.");
        await loadLogs();
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
      // Below the board's 다운로드 등급: its name, and no address.
      if (file?.locked) {
        list.append(
          Object.assign(document.createElement("li"), {
            textContent: `${file.name} (${sizeText(file.size)}) · 다운로드 권한이 없습니다`,
          }),
        );
        continue;
      }
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
  else
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
  // 인기글 (bo_hot): from so many views, the list's icon_hot.
  const hot = boardSetting(log.data.board, "hot", 100);
  if (hot > 0 && typeof log.data.hits === "number" && log.data.hits >= hot)
    item.querySelector(".log-title").append(
      Object.assign(document.createElement("span"), {
        className: "hot",
        textContent: " 인기",
      }),
    );
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
          label: "설명",
          value: current.data.text,
          multiline: true,
          max: Math.max(2000, current.data.text?.length ?? 0),
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
export function pictureEdits(current): EditField[] {
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
export function sizeText(size) {
  const bytes = Number(size) || 0;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}`;
}
/** A plain board's 첨부파일 in edit mode: each one's 삭제, and one to add. */
export function attachmentEdits(current): EditField[] {
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
/** 윗글 and 아래글 (view.skin.php) under a plain board's post shown alone. */
export async function showNeighbors(post) {
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
export async function countView(id, { always = false } = {}) {
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
