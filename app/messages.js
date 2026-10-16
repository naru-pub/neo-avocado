// Private messages between members.

import {
  $,
  caller,
  COLLECTION,
  collection,
  formatTime,
  nickOf,
  run,
  say,
  showTab,
  state,
  route,
} from "./core.js";
import { moneyText } from "./names.js";
import { showUnread } from "./live.js";

$("tabMessages").onclick = () =>
  run(async () => {
    showTab("messages");
    await Promise.all([loadMessageCost(), loadMailbox()]);
  });
$("messageBox").onchange = () => run(() => loadMailbox());
$("refreshMessages").onclick = () => run(() => loadMailbox());
$("moreMessages").onclick = () => run(() => loadMailbox({ more: true }));
$("messageForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("messageForm").querySelector('[type="submit"]');
  button.disabled = true;
  await run(async () => {
    const recipients = await recipientsNamed($("messageTo").value);
    await caller().call("community/messages:sendMessage", {
      recipients,
      body: $("messageBody").value,
    });
    $("messageBody").value = "";
    $("messageTo").value = "";
    $("messageBox").value = "sent";
    await loadMailbox();
    state.shopLoaded = false;
    say("쪽지를 보냈습니다.");
  });
  button.disabled = false;
};
/**
 * The members named by nickname, as the original's memo form takes member IDs
 * (bbs/memo_form.php): one read for up to 20, instead of listing everyone.
 */
async function recipientsNamed(text) {
  const nicks = [
    ...new Set(
      text
        .split(",")
        .map((nick) => nick.trim())
        .filter(Boolean),
    ),
  ];
  // Worded for the page as a function's refusal is (run() shows it).
  const refuse = (message) =>
    Object.assign(new Error(message), { details: { reason: "recipients" } });
  if (!nicks.length || nicks.length > 20)
    throw refuse("받는 회원 닉네임을 1~20개 적어 주세요.");
  const { documents } = await collection(COLLECTION.profiles).list({
    where: { in: ["nick", nicks] },
    size: 20,
  });
  const missing = nicks.filter(
    (nick) => !documents.some((profile) => profile.data.nick === nick),
  );
  if (missing.length)
    throw refuse(`닉네임을 찾을 수 없습니다: ${missing.join(", ")}`);
  return documents.map((profile) => profile.id);
}
async function loadMessageCost() {
  const settings = await collection(COLLECTION.settings)
    .get("community")
    .catch((error) => {
      if (error.code === "NOT_FOUND") return null;
      throw error;
    });
  $("messageCost").textContent =
    `회원 한 명당 ${moneyText(state.names, settings?.data.messageCost ?? 0)}`;
}
async function loadMailbox({ more = false } = {}) {
  const page = await caller().call("community/messages:mailbox", {
    box: $("messageBox").value,
    after: more ? state.messageCursor : null,
    size: 20,
  });
  showUnread(page.unread);
  if (!more) {
    $("messages").replaceChildren();
    $("messageDetail").hidden = true;
  }
  for (const row of page.documents) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = `${row.data.readAt === null ? "[안 읽음] " : ""}${await nickOf($("messageBox").value === "inbox" ? row.data.from : row.data.to)} · ${formatTime(row.data.sentAt)} · ${row.data.preview}`;
    open.onclick = () =>
      run(async () => {
        const message = await openMessage(row.id);
        if (message.data.to === state.member.id)
          open.textContent = open.textContent.replace(/^\[안 읽음\] /, "");
      });
    li.append(open);
    $("messages").append(li);
  }
  state.messageCursor = page.nextCursor;
  $("moreMessages").hidden = !page.nextCursor;
}

/** 쪽지 to one member (the member list's button, memo_form.php?me_recv_mb_id). */
export async function writeTo(member) {
  showTab("messages");
  await Promise.all([loadMessageCost(), loadMailbox()]);
  $("messageTo").value = await nickOf(member);
  $("messageBody").focus();
}

/** One message (memo_view.php), at its address #/messages/<id>. */
export async function openMessage(id) {
  const result = await caller().call("community/messages:readMessage", {
    id,
  });
  const message = result.document;
  showUnread(result.unread);
  $("messageDetail").replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = `${await nickOf(message.data.from)} → ${await nickOf(message.data.to)}`;
  const body = document.createElement("p");
  const receipt = document.createElement("p");
  receipt.textContent = `보낸 시간 ${formatTime(message.data.sentAt)} · ${message.data.readAt === null ? "아직 읽지 않음" : `읽은 시간 ${formatTime(message.data.readAt)}`}`;
  body.className = "message-body";
  body.textContent = message.data.body;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "쪽지 삭제";
  remove.onclick = () =>
    run(async () => {
      if (
        !confirm(
          "이 쪽지를 내 보관함에서 삭제할까요? 상대의 보관함에는 그대로 남습니다.",
        )
      )
        return;
      await caller().call("community/messages:removeMessage", {
        id: message.id,
      });
      await loadMailbox();
    });
  $("messageDetail").append(heading, receipt, body, remove);
  if (message.data.to === state.member.id) {
    const reply = document.createElement("button");
    reply.type = "button";
    reply.textContent = "답장";
    reply.onclick = () =>
      run(async () => {
        $("messageTo").value = await nickOf(message.data.from);
        $("messageBody").focus();
      });
    $("messageDetail").append(" ", reply);
  }
  $("messageDetail").hidden = false;
  route(["messages", id], { replace: true });
  return message;
}
