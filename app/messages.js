// Private messages between members.

import {
  $,
  allDocuments,
  caller,
  COLLECTION,
  collection,
  formatTime,
  nickOf,
  run,
  say,
  showTab,
  state,
} from "./core.js";
import { showUnread } from "./live.js";

$("tabMessages").onclick = () =>
  run(async () => {
    showTab("messages");
    await Promise.all([loadMessageRecipients(), loadMailbox()]);
  });
$("messageBox").onchange = () => run(() => loadMailbox());
$("refreshMessages").onclick = () => run(() => loadMailbox());
$("moreMessages").onclick = () => run(() => loadMailbox({ more: true }));
$("messageForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("messageForm").querySelector('[type="submit"]');
  button.disabled = true;
  await run(async () => {
    const recipients = [...$("messageRecipients").selectedOptions].map(
      (option) => option.value,
    );
    await caller().call("community/messages:sendMessage", {
      recipients,
      body: $("messageBody").value,
    });
    $("messageBody").value = "";
    $("messageBox").value = "sent";
    await loadMailbox();
    state.shopLoaded = false;
    say("쪽지를 보냈습니다.");
  });
  button.disabled = false;
};
async function loadMessageRecipients() {
  const profiles = await allDocuments(COLLECTION.profiles, undefined, {
    all: [
      { ne: [{ metadata: "id" }, state.member.id] },
      { ne: ["acceptMessages", false] },
    ],
  });
  $("messageRecipients").replaceChildren();
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.data.nick;
    $("messageRecipients").append(option);
  }
  const settings = await collection(COLLECTION.settings)
    .get("community")
    .catch((error) => {
      if (error.code === "NOT_FOUND") return null;
      throw error;
    });
  $("messageCost").textContent =
    `회원 한 명당 ${settings?.data.messageCost ?? 0} 아보`;
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
        const result = await caller().call("community/messages:readMessage", {
          id: row.id,
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
                "쪽지를 삭제하면 보낸 사람과 받는 사람 모두의 보관함에서 사라집니다. 삭제할까요?",
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
          reply.onclick = () => {
            const options = [...$("messageRecipients").options];
            if (!options.some((option) => option.value === message.data.from))
              return say("상대가 지금은 쪽지를 받지 않습니다.");
            for (const option of options)
              option.selected = option.value === message.data.from;
            $("messageBody").focus();
          };
          $("messageDetail").append(" ", reply);
        }
        $("messageDetail").hidden = false;
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
  await Promise.all([loadMessageRecipients(), loadMailbox()]);
  for (const option of $("messageRecipients").options)
    option.selected = option.value === member;
  $("messageBody").focus();
}
