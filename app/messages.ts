// Private messages between members.

import {
  $,
  formatTime,
  nickOf,
  run,
  say,
  showTab,
  state,
  route,
  renderPages,
  query,
  mutate,
  suggestNames,
} from "./core.js";
import { moneyText } from "./names.js";

$("tabMessages").onclick = () =>
  run(async () => {
    showTab("messages");
    await Promise.all([loadMessageCost(), loadMailbox()]);
  });
$("refreshMessages").onclick = () => run(() => loadMailbox());
$("messageForm").onsubmit = async (event) => {
  event.preventDefault();
  const button =
    $("messageForm").querySelector<HTMLButtonElement>('[type="submit"]');
  button.disabled = true;
  await run(async () => {
    const recipients = await recipientsNamed(
      $<HTMLInputElement>("messageTo").value,
    );
    await mutate("community/messages:sendMessage", {
      recipients,
      body: $<HTMLTextAreaElement>("messageBody").value,
    });
    $<HTMLTextAreaElement>("messageBody").value = "";
    $<HTMLInputElement>("messageTo").value = "";
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
  const { profiles } = await query("community/profiles:find", { nicks });
  const missing = nicks.filter(
    (nick) => !profiles.some((profile) => profile.nick === nick),
  );
  if (missing.length)
    throw refuse(`닉네임을 찾을 수 없습니다: ${missing.join(", ")}`);
  return profiles.map((profile) => profile.id);
}
async function loadMessageCost() {
  const settings = await query("content/site:settings");
  $("messageCost").textContent =
    `회원 한 명당 ${moneyText(state.names, settings.messageCost ?? 0)}`;
}
/**
 * 쪽지함 (mypage/memo/index.php): one entry a correspondent, newest first,
 * with their last message, how many, and N while one is unread.
 */
async function loadMailbox(page = 1) {
  const result = await query("community/messages:conversations", { page });
  $("messages").replaceChildren();
  $("messageDetail").hidden = true;
  for (const entry of result.documents) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "conversation-entry";
    const name = document.createElement("strong");
    name.textContent = await nickOf(entry.partner);
    const info = document.createElement("span");
    info.className = "info";
    info.textContent = ` ${formatTime(entry.last.sentAt)} · ${entry.count}통`;
    open.append(name, info);
    if (entry.unread)
      open.append(
        " ",
        Object.assign(document.createElement("i"), {
          className: "new",
          textContent: "N",
        }),
      );
    open.append(
      Object.assign(document.createElement("p"), {
        className: `preview${entry.last.mine ? " mine" : ""}`,
        textContent: entry.last.preview,
      }),
    );
    open.onclick = () => run(() => openConversation(entry.partner));
    li.append(open);
    $("messages").append(li);
  }
  if (!result.documents.length)
    $("messages").append(
      Object.assign(document.createElement("li"), {
        textContent: "주고받은 쪽지가 없습니다.",
      }),
    );
  renderPages($("messagePages"), page, Math.ceil(result.total / 5), (next) =>
    run(() => loadMailbox(next)),
  );
}

/** One message of a conversation, with its 삭제 button. */
function messageItem(message) {
  const mine = message.data.from === state.member.id;
  const item = document.createElement("li");
  item.className = mine ? "mine" : "theirs";
  item.id = `message-${message.id}`;
  const body = document.createElement("p");
  body.className = "message-body";
  body.textContent = message.data.body;
  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = `${formatTime(message.data.sentAt)}${mine ? (message.data.readAt === null ? " · 안 읽음" : " · 읽음") : ""}`;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "삭제";
  remove.onclick = () =>
    run(async () => {
      if (
        !confirm(
          "이 쪽지를 내 보관함에서 삭제할까요? 상대의 보관함에는 그대로 남습니다.",
        )
      )
        return;
      await mutate("community/messages:removeMessage", {
        id: message.id,
      });
      item.remove();
    });
  meta.append(" ", remove);
  item.append(body, meta);
  return item;
}

/**
 * The messages with one member (memo_view.php), oldest first, theirs on one
 * side and the member's on the other, with a reply box below. The newest 50
 * show; 이전 쪽지 더 보기 reads the 50 before the oldest shown. Opening it
 * reads what they sent.
 */
async function openConversation(partner, focus = null) {
  const result = await query("community/messages:conversation", { partner });
  if (result.unread)
    await mutate("community/messages:readConversation", { partner });
  const nick = await nickOf(partner);
  const heading = document.createElement("h3");
  heading.textContent = `${nick}님과의 쪽지`;
  const list = document.createElement("ol");
  list.className = "messages-thread";
  list.append(...result.documents.map(messageItem));
  let oldest = result.documents[0]?.id ?? null;
  const older = document.createElement("button");
  older.type = "button";
  older.className = "older-messages";
  older.textContent = "이전 쪽지 더 보기";
  // ui-btn etc, as the original's 이전대화보기.
  older.classList.add("etc");
  older.hidden = !result.more;
  const readOlder = async () => {
    older.disabled = true;
    try {
      const page = await query("community/messages:conversation", {
        partner,
        before: oldest,
      });
      list.prepend(...page.documents.map(messageItem));
      oldest = page.documents[0]?.id ?? oldest;
      older.hidden = !page.more || !page.documents.length;
    } finally {
      older.disabled = false;
    }
  };
  older.onclick = () => run(readOlder);
  const reply = document.createElement("form");
  reply.className = "reply";
  const text = document.createElement("textarea");
  text.maxLength = 5000;
  text.rows = 3;
  text.required = true;
  text.setAttribute("aria-label", `${nick}님에게 보낼 쪽지`);
  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = "보내기";
  reply.append(text, send);
  reply.onsubmit = (event) => {
    event.preventDefault?.();
    run(async () => {
      await mutate("community/messages:sendMessage", {
        recipients: [partner],
        body: text.value,
      });
      state.shopLoaded = false;
      say("쪽지를 보냈습니다.");
      await openConversation(partner);
    });
  };
  $("messageDetail").replaceChildren(heading, older, list, reply);
  $("messageDetail").hidden = false;
  // A linked message older than the newest 50: read back to it, a few times.
  for (
    let tries = 0;
    tries < 5 &&
    focus &&
    !document.getElementById(`message-${focus}`) &&
    !older.hidden;
    tries++
  )
    await readOlder();
  document.getElementById(`message-${focus}`)?.scrollIntoView?.();
}

/** 쪽지 to one member (the member list's button, memo_form.php?me_recv_mb_id). */
export async function writeTo(member) {
  showTab("messages");
  await Promise.all([loadMessageCost(), loadMailbox()]);
  $<HTMLInputElement>("messageTo").value = await nickOf(member);
  $("messageBody").focus();
}

/**
 * A message's address (/messages/<id>): its conversation, at it.
 */
export async function openMessage(id) {
  showTab("messages");
  await loadMessageCost();
  const { document: message } = await mutate("community/messages:readMessage", {
    id,
  });
  const partner =
    message.data.from === state.member.id ? message.data.to : message.data.from;
  await openConversation(partner, message.id);
  route(["messages", id], { replace: true });
  return message;
}
// memo_form.php's 받는 회원 search (ajax/_search_member.php).
suggestNames($<HTMLInputElement>("messageTo"), "member", { list: true });
