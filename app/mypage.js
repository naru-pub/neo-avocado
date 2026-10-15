// 마이페이지 (mypage/): the member's account, characters and posts, their
// experience history, and leaving the community. 우편함 and 호출내역 are the
// messages and calls views, under the same menu.
import {
  $,
  caller,
  collection,
  COLLECTION,
  formatTime,
  ownCharacters,
  run,
  say,
  showAdmission,
  showTab,
  state,
  STATE_NAMES,
} from "./core.js";
import { configureBoard, openLogNumber } from "./logs.js";

/** 계정정보: the profile, the member's characters, and leaving. */
async function loadMyPage() {
  const profile = state.profile;
  $("myNick").textContent = profile?.data.nick ?? "";
  $("myAcceptMessages").textContent =
    profile?.data.acceptMessages === false ? "받지 않음" : "받음";
  $("myCommentAlerts").textContent =
    profile?.data.commentAlerts === false ? "받지 않음" : "받음";
  $("myMemberId").textContent = state.member?.id ?? "";
  const characters = await ownCharacters();
  $("myCharacters").replaceChildren(
    ...characters.map((character) => {
      const item = document.createElement("li");
      const main = profile?.data.mainCharacter === character.id;
      item.textContent = `${character.data.name} · ${
        STATE_NAMES[character.data.state] ?? character.data.state ?? ""
      }${main ? " · 대표" : ""}`;
      return item;
    }),
  );
  if (!characters.length) {
    const empty = document.createElement("li");
    empty.textContent = "등록한 캐릭터가 없습니다.";
    $("myCharacters").append(empty);
  }
}

/**
 * 로그내역 (mypage/log): the member's own posts on every board they can read,
 * newest first. Each board is asked for its own, as the board rule reads one
 * board at a time.
 */
async function loadMyLogs() {
  const pages = await Promise.all(
    state.boards.map((board) =>
      collection(COLLECTION.logs)
        .list({
          filter: { board: board.id },
          where: { eq: ["owner", state.member.id] },
          sort: [[{ metadata: "createdAt" }, "desc"]],
          size: 20,
        })
        .then((page) => page.documents.map((log) => ({ board, log }))),
    ),
  );
  const posts = pages
    .flat()
    .sort((a, b) => (a.log.createdAt < b.log.createdAt ? 1 : -1))
    .slice(0, 30);
  $("myLogs").replaceChildren(
    ...posts.map(({ board, log }) => {
      const item = document.createElement("li");
      const open = document.createElement("a");
      open.href = "#";
      const text = (log.data.title || log.data.text || "그림 로그").slice(
        0,
        60,
      );
      open.textContent = `[${board.data.name}] No. ${log.data.number ?? "-"} ${text}`;
      open.onclick = (event) => {
        event.preventDefault();
        run(async () => {
          state.board = board.id;
          $("board").value = board.id;
          configureBoard();
          showTab("logs");
          await openLogNumber(log.data.number);
        });
      };
      const time = document.createElement("time");
      time.textContent = ` · ${formatTime(log.createdAt)}`;
      item.append(open, time);
      return item;
    }),
  );
  if (!posts.length) {
    const empty = document.createElement("li");
    empty.textContent = "쓴 로그가 없습니다.";
    $("myLogs").append(empty);
  }
}

/** 경험치 내역 (member/exp.php): what the owner gave or took, and why. */
let expCursor = null;
async function loadMyExp({ more = false } = {}) {
  const [page, characters] = await Promise.all([
    caller().call("economy/history:history", {
      kind: "exp",
      after: more ? expCursor : null,
      size: 20,
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
    empty.textContent = "경험치 내역이 없습니다.";
    $("myExp").append(empty);
  }
  expCursor = page.nextCursor;
  $("moreExp").hidden = !page.nextCursor;
}

const openMyPage = () =>
  run(async () => {
    showTab("mypage");
    await loadMyPage();
  });
$("tabMypage").onclick = openMyPage;
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
    await caller().call("community/membership:leave", { confirm: true });
    say("탈퇴했습니다.");
    showAdmission("left");
  });
