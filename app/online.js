// 현재접속자 (bbs/current_connect.php): members seen in the last ten
// minutes, and where they were.
import { $, caller, formatTime, run, say, showTab, state } from "./core.js";

async function loadOnline() {
  const { members } = await caller().call("community/presence:online");
  $("onlineList").replaceChildren(
    ...members.map((member) => {
      const item = document.createElement("li");
      const nick = document.createElement("strong");
      nick.textContent = member.nick;
      item.append(
        nick,
        ` · ${member.where || "메인"} · ${formatTime(member.at)}`,
      );
      return item;
    }),
  );
  if (!members.length) {
    const empty = document.createElement("li");
    empty.textContent = "지금 접속한 회원이 없습니다.";
    $("onlineList").append(empty);
  }
}

$("tabOnline").onclick = () =>
  run(async () => {
    // Members only: where members are can name members-only boards.
    if (!state.member) return say("회원 로그인 후 이용할 수 있습니다.");
    showTab("online");
    await loadOnline();
  });
