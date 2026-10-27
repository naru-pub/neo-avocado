// 마이페이지 (mypage/): the member's account, characters and posts, their
// experience history, and leaving the community. 우편함 and 호출내역 are the
// messages and calls views, under the same menu.

import { openCharacterForm } from "./characters.js";
import {
  $,
  formatTime,
  memberSettings,
  mutate,
  nickOf,
  ownCharacters,
  preloadNicks,
  query,
  renderPages,
  run,
  STATE_NAMES,
  say,
  show,
  showAdmission,
  showTab,
  state,
  suggestNames,
} from "./core.js";
import { configureBoard, openLogNumber } from "./logs.js";
import { expText, moneyText } from "./names.js";

/** 계정정보: the profile, the member's characters, and leaving. */
async function loadMyPage() {
  const profile = state.profile;
  $("myNick").textContent = profile?.data.nick ?? "";
  $("myBirth").textContent = profile?.data.birthYear
    ? `${profile.data.birthYear} 년생`
    : "";
  $("myBirth").hidden = $("myBirthTerm").hidden = !profile?.data.birthYear;
  $("myAcceptMessages").textContent =
    profile?.data.acceptMessages === false ? "받지 않음" : "받음";
  $("myCommentAlerts").textContent =
    profile?.data.commentAlerts === false ? "받지 않음" : "받음";
  $("myMemberId").textContent = state.member?.id ?? "";
  // 가입일: the profile's making, joining the community (no birth year is
  // asked, so the original's 생년 is not shown).
  const joined = Date.parse(profile?.createdAt ?? "");
  $("myJoinedTerm").hidden = $("myJoined").hidden = !Number.isFinite(joined);
  $("myJoined").textContent = Number.isFinite(joined)
    ? new Date(joined).toLocaleDateString("ko-KR")
    : "";
  const warned = state.warnings.count > 0;
  $("myWarningsTerm").hidden = $("myWarnings").hidden = !warned;
  $("myWarnings").replaceChildren();
  if (warned) {
    const count = document.createElement("strong");
    count.className = "warning-count";
    count.textContent = `[ ${state.warnings.count.toLocaleString("ko-KR")} ] 회`;
    $("myWarnings").append(count);
    if (state.warnings.note)
      $("myWarnings").append(
        Object.assign(document.createElement("p"), {
          className: "warning-note",
          textContent: state.warnings.note,
        }),
      );
  }
  const characters = await ownCharacters();
  // 대표캐릭터 (mypage/character/index.php): chosen from the member's own.
  const main = document.createElement("form");
  main.className = "main-character-choice";
  const choice = document.createElement("select");
  choice.setAttribute("aria-label", "대표캐릭터");
  choice.append(
    new Option("대표캐릭터 선택", ""),
    ...characters.map((row) => new Option(row.data.name, row.id)),
  );
  choice.value = profile?.data.mainCharacter ?? "";
  const change = document.createElement("button");
  change.type = "submit";
  change.textContent = "변경";
  main.append("대표캐릭터 ", choice, " ", change);
  main.onsubmit = (event) => {
    event.preventDefault?.();
    run(async () => {
      if (!choice.value) return;
      const result = await mutate("characters/profile:mainCharacter", {
        character: choice.value,
      });
      show(result.document);
      say("대표캐릭터를 바꿨습니다.");
      await loadMyPage();
    });
  };
  $("myMainCharacter").replaceChildren(...(characters.length ? [main] : []));
  // Each card's 랭킹 and 경험치 where the owner shows them (ad_use_rank,
  // ad_use_exp; mypage/character/index.php:64-73).
  const statuses = new Map<string, any>(
    state.viewer.rank || state.viewer.exp
      ? await Promise.all(
          characters.map(
            async (character): Promise<[string, any]> => [
              character.id,
              // A card without them still shows.
              await query("characters/progression:characterStatus", {
                character: character.id,
              }).catch(() => null),
            ],
          ),
        )
      : [],
  );
  // Each character as a card (list-character-box): its 두상, name, 소속,
  // 종족, 랭킹, 경험치 and state, to its own page.
  $("myCharacters").replaceChildren(
    ...characters.map((character) => {
      const status = statuses.get(character.id);
      const item = document.createElement("li");
      item.className = "character-card";
      const link = document.createElement("a");
      link.href = `/character/${encodeURIComponent(character.id)}`;
      if (character.data.image?.startsWith("https://"))
        link.append(
          Object.assign(new Image(), {
            src: character.data.image,
            alt: "",
            loading: "lazy",
          }),
        );
      link.append(
        Object.assign(document.createElement("strong"), {
          textContent: character.data.name,
        }),
      );
      for (const text of [
        state.names.sideTitle && character.data.side,
        state.names.classTitle && character.data.class,
        state.viewer.rank && status?.rank,
        state.viewer.exp && status && expText(state.names, status.state.exp),
        STATE_NAMES[character.data.state] ?? character.data.state,
        profile?.data.mainCharacter === character.id ? "대표" : "",
      ])
        if (text)
          link.append(
            Object.assign(document.createElement("span"), {
              textContent: text,
            }),
          );
      item.append(link);
      return item;
    }),
  );
  if (!characters.length) {
    const empty = document.createElement("li");
    empty.textContent = "등록한 캐릭터가 없습니다.";
    $("myCharacters").append(empty);
  }
  // 신규 캐릭터 등록 shows while the owner allows creation and the member
  // has fewer than the limit (mypage/character/index.php); the server checks
  // the same.
  const settings = await memberSettings();
  const open = settings.characterCreation !== false;
  const limit = settings.characterLimit ?? 1;
  $("newCharacter").hidden = !open || (limit > 0 && characters.length >= limit);
  $("characterForm").hidden = true;
}
$("newCharacter").onclick = () => run(() => openCharacterForm());

/** A comment's writer as 나의로그 names them: the character, else the nick. */
async function commenterOf(comment) {
  if (comment.data.speaker?.name) return comment.data.speaker.name;
  if (comment.data.guest?.name) return comment.data.guest.name;
  if (comment.data.owner) return await nickOf(comment.data.owner);
  return "익명의 누군가";
}

/**
 * 나의로그 (mypage/log/index.php): the member's own logs on the picture
 * boards, 10 a page; each its picture, to the log, and its three newest
 * comments.
 */
async function loadMyLogs(page = 1) {
  const result = await query("community/posts:mine", { page });
  await preloadNicks(result.documents.flatMap((log) => log.comments ?? []));
  const posts = result.documents
    .map((log) => ({
      board: state.boards.find(
        (row) => row.id === (log.data.board ?? "default"),
      ),
      log,
    }))
    .filter((post) => post.board);
  const items = [];
  for (const { board, log } of posts) {
    const item = document.createElement("li");
    const open = document.createElement("a");
    open.href = "#";
    open.className = "my-log-picture";
    if (log.data.image) {
      const picture = document.createElement("img");
      picture.src = log.data.image;
      picture.alt = "";
      picture.loading = "lazy";
      open.append(picture);
    }
    const title = document.createElement("span");
    title.textContent = `[${board.data.name}] No. ${log.data.number ?? "-"}`;
    open.append(title);
    open.onclick = (event) => {
      event.preventDefault();
      run(async () => {
        state.board = board.id;
        $<HTMLSelectElement>("board").value = board.id;
        configureBoard();
        showTab("logs");
        await openLogNumber(log.data.number);
      });
    };
    const said = document.createElement("ul");
    said.className = "my-log-comments";
    for (const comment of log.comments ?? []) {
      const line = document.createElement("li");
      const who = document.createElement("strong");
      who.textContent = await commenterOf(comment);
      const words = document.createElement("span");
      words.textContent = ` ${comment.data.hidden ? "비밀글 입니다." : (comment.data.text ?? "").slice(0, 100)}`;
      const time = document.createElement("time");
      time.textContent = ` ${formatTime(comment.createdAt)}`;
      line.append(who, words, time);
      said.append(line);
    }
    if (!said.childElementCount) {
      const none = document.createElement("li");
      none.textContent = "코멘트가 없습니다.";
      said.append(none);
    }
    item.append(open, said);
    items.push(item);
  }
  $("myLogs").replaceChildren(...items);
  if (!posts.length) {
    const empty = document.createElement("li");
    empty.textContent = "쓴 로그가 없습니다.";
    $("myLogs").append(empty);
  }
  renderPages(
    $("myLogPages"),
    page,
    Math.ceil(result.total / result.size),
    (next) => loadMyLogs(next),
  );
}

/** 경험치 내역 (member/exp.php): what the owner gave or took, and why. */
let expCursor = null;
async function loadMyExp({ more = false } = {}) {
  const [page, characters] = await Promise.all([
    query("economy/history:history", {
      kind: "exp",
      after: more ? expCursor : null,
      size: state.paging.rows,
    }),
    ownCharacters(),
  ]);
  if (!more) $("myExp").replaceChildren();
  for (const row of page.documents) {
    const item = document.createElement("li");
    const name =
      characters.find((character) => character.id === row.data.character)?.data
        .name ?? "삭제된 캐릭터";
    const delta = row.data.expDelta;
    item.textContent = `${formatTime(row.data.at)} · ${name} · ${
      delta > 0 ? "+" : ""
    }${delta} (총 ${row.data.exp})${row.data.memo ? ` · ${row.data.memo}` : ""}`;
    $("myExp").append(item);
  }
  if (!more && !page.documents.length) {
    const empty = document.createElement("li");
    empty.textContent = `${state.names.expName} 내역이 없습니다.`;
    $("myExp").append(empty);
  }
  expCursor = page.nextCursor;
  $("moreExp").hidden = !page.nextCursor;
}

/** 관심로그 (mypage/log/log_favorite.php), 한페이지당 라인수 a page, in the order marked. */
async function loadMyFavorites(page = 1) {
  const result = await query("community/posts:favorites", {
    page,
    size: state.paging.rows,
  });
  $("myFavorites").replaceChildren(
    ...result.documents.map((log) => {
      const board = state.boards.find(
        (row) => row.id === (log.data.board ?? "default"),
      );
      const item = document.createElement("li");
      const open = document.createElement("a");
      open.href = `/post/${encodeURIComponent(log.id)}`;
      const text = (log.data.title || log.data.text || "그림 로그").slice(
        0,
        60,
      );
      open.textContent = `[${board?.data.name ?? "게시판"}] No. ${log.data.number ?? "-"} ${text}`;
      const time = document.createElement("time");
      time.textContent = ` · ${formatTime(log.createdAt)}`;
      item.append(open, time);
      return item;
    }),
  );
  if (!result.documents.length)
    $("myFavorites").append(
      Object.assign(document.createElement("li"), {
        textContent: "관심 로그가 없습니다. 로그의 관심 버튼으로 모읍니다.",
      }),
    );
  renderPages(
    $("myFavoritePages"),
    page,
    Math.ceil(Math.min(result.total, 200) / state.paging.rows),
    (next) => run(() => loadMyFavorites(next)),
  );
}
/** 화폐관리's ledger (mypage/money/index.php): 획득 and 사용, 20 a page. */
let moneyCursor = null;
let moneyGained = 0;
let moneySpent = 0;
async function loadMyMoney({ more = false } = {}) {
  const page = await query("economy/money:ledger", {
    after: more ? moneyCursor : null,
    size: state.paging.rows,
  });
  const body = $("moneyLedger").querySelector("tbody");
  if (!more) {
    body.replaceChildren();
    moneyGained = moneySpent = 0;
  }
  for (const row of page.documents) {
    const line = document.createElement("tr");
    const delta = row.data.delta ?? 0;
    if (delta > 0) moneyGained += delta;
    else moneySpent -= delta;
    const content = document.createElement("td");
    content.textContent = `[${formatTime(row.data.at)}] ${row.data.memo || HISTORY_KINDS[row.data.kind] || row.data.kind}`;
    const gained = document.createElement("td");
    const spent = document.createElement("td");
    gained.className = spent.className = "amount";
    if (delta > 0) gained.textContent = moneyText(state.names, delta);
    else spent.textContent = moneyText(state.names, -delta);
    line.append(content, gained, spent);
    body.append(line);
  }
  if (!more && !page.documents.length) {
    const empty = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "자료가 없습니다.";
    empty.append(cell);
    body.append(empty);
  }
  // 소계 of what is shown, and what the member holds now.
  $("moneyGained").textContent = moneyText(state.names, moneyGained);
  $("moneySpent").textContent = moneyText(state.names, moneySpent);
  $("moneyBalance").textContent = moneyText(state.names, page.balance ?? 0);
  moneyCursor = page.nextCursor;
  $("moreMoney").hidden = !page.nextCursor;
}
/** What each kind of record was, where it has no memo of its own. */
const HISTORY_KINDS = {
  adjust: "운영자 조정",
  daily: "첫 로그인",
  signup: "회원가입 축하",
  buy: "구매",
  sell: "판매",
  craft: "제작",
  gacha: "뽑기",
  settle: "정산",
  message: "쪽지 비용",
};
$("moneyForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const name = $<HTMLInputElement>("moneyTo").value.trim();
    const amount = Number($<HTMLInputElement>("moneyAmount").value);
    const { document: target } = name
      ? await query("characters/sheet:named", { name })
      : { document: null };
    if (!target) return say("상대를 확인할 수 없습니다.");
    const result = await mutate("economy/money:send", {
      character: target.id,
      amount,
    });
    $<HTMLFormElement>("moneyForm").reset?.();
    state.shopLoaded = false;
    say(`${result.nick}님께 ${moneyText(state.names, amount)} 보냈습니다.`);
    await loadMyMoney();
  });
};
$("moreMoney").onclick = () => run(() => loadMyMoney({ more: true }));
$("myFavoritesTab").onclick = () =>
  run(async () => {
    showTab("myFavorites");
    await loadMyFavorites();
  });
$("myMoneyTab").onclick = () =>
  run(async () => {
    showTab("myMoney");
    await loadMyMoney();
  });

const openMyPage = () =>
  run(async () => {
    showTab("mypage");
    await loadMyPage();
  });
$("tabMypage").onclick = openMyPage;
/** The main page card's 캐릭터 생성 (outlogin.skin.2.php): 마이페이지's form. */
export const createCharacter = () =>
  run(async () => {
    showTab("mypage");
    await loadMyPage();
    await openCharacterForm();
  });
$("myAccountTab").onclick = openMyPage;
$("cardMyPage").onclick = openMyPage;
$("myLogsTab").onclick = () =>
  run(async () => {
    showTab("myLogs");
    await loadMyLogs();
  });
$("myExpTab").onclick = () =>
  run(async () => {
    showTab("myExp");
    await loadMyExp();
  });
$("moreExp").onclick = () => run(() => loadMyExp({ more: true }));
$("myMailTab").onclick = () => $("tabMessages").click();
$("myCallsTab").onclick = () => $("tabCalls").click();
$("myEdit").onclick = () => $("editProfile").click();
// bbs/member_leave.php: the member becomes a guest; their posts stay.
$("myLeave").onclick = () =>
  run(async () => {
    if (
      !confirm(
        "탈퇴하면 이 커뮤니티를 손님으로만 이용할 수 있습니다. 쓴 글과 캐릭터는 남습니다. 탈퇴할까요?",
      )
    )
      return;
    await mutate("community/membership:leave", { confirm: true });
    say("탈퇴했습니다.");
    showAdmission("left");
  });
// get_ajax_character (mypage/money/index.php): approved characters' names.
suggestNames($<HTMLInputElement>("moneyTo"), "character");
