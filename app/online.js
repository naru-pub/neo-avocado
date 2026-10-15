// 현재접속자 (bbs/current_connect.php): members seen in the last ten
// minutes, and where they were.
import { $, caller, formatTime, run, showTab } from "./core.js";

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
    showTab("online");
    await loadOnline();
  });
