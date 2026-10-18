// 설문조사 (poll.skin.php, poll_result.php, poll_etc_update.php) and the
// 팝업레이어 (bbs/newwin.inc.php), on the main page.
import { sanitizedFragment } from "../content-renderer.js";
import { $, formatTime, mutate, query, run, say, state } from "./core.js";

let current = null;
let showingResults = false;

/**
 * The newest poll in use, as the main page shows it: the site frame's on
 * arrival, read again after a vote.
 */
export async function loadPoll(given = undefined) {
  const { poll } =
    given === undefined ? await query("content/polls:latest") : { poll: given };
  current = poll;
  $("pollBox").hidden = !poll;
  if (!poll) return;
  $("pollSubject").textContent = poll.subject;
  renderPoll();
}
function renderPoll() {
  const poll = current;
  const total = poll.counts.reduce((sum, n) => sum + n, 0);
  const results = showingResults || poll.voted !== null;
  $("pollAnswers").replaceChildren(
    ...poll.answers.map((answer, n) => {
      const item = document.createElement("li");
      if (results) {
        const share = total ? Math.round((poll.counts[n] / total) * 100) : 0;
        item.append(
          `${answer} `,
          Object.assign(document.createElement("meter"), {
            min: 0,
            max: Math.max(total, 1),
            value: poll.counts[n],
          }),
          ` ${poll.counts[n]}표 (${share}%)${poll.voted === n + 1 ? " ✔" : ""}`,
        );
      } else {
        const label = document.createElement("label");
        const choice = document.createElement("input");
        choice.type = "radio";
        choice.name = "pollChoice";
        choice.value = String(n + 1);
        label.append(choice, ` ${answer}`);
        item.append(label);
      }
      return item;
    }),
  );
  $("pollVote").hidden = results || !poll.canVote;
  $("pollResults").textContent = showingResults ? "투표하기로" : "결과보기";
  $("pollResults").hidden = poll.voted !== null;
  $("pollNote").textContent =
    poll.voted !== null
      ? `참여하셨습니다. 전체 ${total}표`
      : poll.canVote
        ? poll.point
          ? `투표하면 ${poll.point} ${state.names.moneyUnit || state.names.moneyName}를 받습니다.`
          : ""
        : state.member
          ? `권한 ${poll.level} 이상 회원만 투표에 참여하실 수 있습니다.`
          : "회원 로그인 후 투표에 참여하실 수 있습니다.";
  $("pollEtc").hidden = !poll.etc;
  $("pollEtcQuestion").textContent = poll.etc;
  $("pollEtcForm").hidden = !state.member;
  $("pollComments").replaceChildren(
    ...poll.comments.map((row) => {
      const item = document.createElement("li");
      item.append(`${row.nick}: ${row.idea} `);
      item.append(
        Object.assign(document.createElement("time"), {
          textContent: formatTime(row.at),
        }),
      );
      if (row.mine || state.owner) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.onclick = () =>
          run(async () => {
            await mutate("content/polls:removeComment", { id: row.id });
            await loadPoll();
          });
        item.append(" ", remove);
      }
      return item;
    }),
  );
}
$("pollResults").onclick = () => {
  showingResults = !showingResults;
  renderPoll();
};
$("pollForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const picked = $("pollForm").querySelector<HTMLInputElement>(
      'input[name="pollChoice"]:checked',
    );
    if (!picked) return say("항목을 선택하세요.");
    await mutate("content/polls:vote", {
      id: current.id,
      choice: Number(picked.value),
    });
    say("투표했습니다.");
    await loadPoll();
  });
};
$("pollEtcForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const idea = $<HTMLInputElement>("pollEtcText").value.trim();
    if (!idea) return;
    await mutate("content/polls:comment", { id: current.id, idea });
    $<HTMLInputElement>("pollEtcText").value = "";
    await loadPoll();
  });
};

const POPUP_KEY = (id) => `neo-avocado-popup-${id}`;
/**
 * The 팝업레이어 between their times, for this device, but those a reader
 * put off for their hours (hd_pops_ cookies).
 */
export function showPopups(popups = []) {
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const box = $("popups");
  box.replaceChildren();
  for (const popup of popups) {
    if (popup.device !== "both" && popup.device !== (mobile ? "mobile" : "pc"))
      continue;
    let until = 0;
    try {
      until = Number(localStorage.getItem(POPUP_KEY(popup.id))) || 0;
    } catch {
      /* Without storage it shows each time. */
    }
    if (until > Date.now()) continue;
    const layer = document.createElement("section");
    layer.className = "popup-layer";
    layer.setAttribute("aria-label", popup.subject);
    if (!mobile) {
      layer.style.left = `${popup.left}px`;
      layer.style.top = `${popup.top}px`;
    }
    const content = document.createElement("div");
    content.className = "popup-content";
    content.style.width = `min(${popup.width}px, calc(100vw - 32px))`;
    content.style.height = `${popup.height}px`;
    content.append(sanitizedFragment(document, popup.content));
    const footer = document.createElement("div");
    footer.className = "popup-footer";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.textContent = `${popup.disableHours}시간 동안 다시 열람하지 않습니다.`;
    reject.onclick = () => {
      try {
        localStorage.setItem(
          POPUP_KEY(popup.id),
          String(Date.now() + popup.disableHours * 3600 * 1000),
        );
      } catch {
        /* It shows again next time. */
      }
      layer.remove();
    };
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "닫기";
    close.onclick = () => layer.remove();
    footer.append(reject, " ", close);
    layer.append(content, footer);
    box.append(layer);
  }
}
