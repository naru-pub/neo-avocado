// Writing a log: the form, its pictures and files, 답변, the speaker and the
// item or materials it uses.
import {
  $,
  state,
  run,
  showTab,
  guestCredentials,
  say,
  uploadMedia,
  mutate,
} from "./core.js";
import { showNewPost } from "./live.js";
import { wireItemChoice, postInventory, wireSpeakerChoice } from "./posts.js";
import {
  boardSetting,
  configureBoard,
  kindOf,
  loadLogs,
  uploadCountOf,
} from "./logs.js";
import { forgetInventory, logItem } from "./log-item.js";

// bo_use_file_content: a 설명 box for each file chosen.
$("logAttachments").addEventListener("change", () => {
  const board = state.boards.find((row) => row.id === state.board);
  const notes = $("logAttachmentNotes");
  const files = [...($<HTMLInputElement>("logAttachments").files ?? [])];
  notes.replaceChildren(
    ...(board?.data.fileContent
      ? files.map((file) => {
          const label = document.createElement("label");
          const input = document.createElement("input");
          input.maxLength = 255;
          label.append(`${file.name} 설명 `, input);
          return label;
        })
      : []),
  );
  notes.hidden = !notes.childElementCount;
});
/** Opens the log form to answer `log` (bbs/write.php?w=r), titled Re:. */
export function startReply(log) {
  state.replyTo = log.id;
  $("logReplying").hidden = false;
  $("logReplyingTitle").textContent =
    `답변: ${log.data.title || `${log.data.number ?? ""}번 글`}`;
  const title = $<HTMLInputElement>("logTitle");
  if (!title.value.trim()) title.value = `Re: ${log.data.title ?? ""}`.trim();
  $("logForm").scrollIntoView?.();
  $<HTMLTextAreaElement>("logText").focus();
}
export function endReply() {
  state.replyTo = null;
  $("logReplying").hidden = true;
}
$("cancelReply").onclick = () => {
  if ($<HTMLInputElement>("logTitle").value.startsWith("Re:"))
    $<HTMLInputElement>("logTitle").value = "";
  endReply();
};
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
    // bo_upload_count: a plain board's post takes that many pictures.
    const chosen = guest
      ? []
      : [...($<HTMLInputElement>("logImage").files ?? [])];
    const most = kindOf() === "text" ? uploadCountOf() : 1;
    if (chosen.length > most)
      return say(
        most
          ? `그림은 ${most}개까지 올릴 수 있습니다.`
          : "이 게시판은 그림을 올릴 수 없습니다.",
      );
    const file = chosen[0] ?? null;
    // write.skin.php's UPLOAD or URL: a picture's address in place of a file.
    const address = $<HTMLInputElement>("logImageUrl").value.trim();
    if (file && address)
      return say("그림은 파일과 주소 중 하나만 정해 주세요.");
    if (!file && !address && kindOf() === "image")
      return say("그림을 골라 주세요.");
    say("올리는 중…");
    const image = file ? await uploadMedia(file) : null;
    const files = [];
    for (const more of chosen.slice(1))
      files.push((await uploadMedia(more)).url);
    // 첨부파일: a plain board's files, counted with its pictures.
    const attaching = guest
      ? []
      : [...($<HTMLInputElement>("logAttachments").files ?? [])];
    if (attaching.length && chosen.length + attaching.length > most)
      return say(`파일은 그림과 합쳐 ${most}개까지 올릴 수 있습니다.`);
    // 파일 업로드 용량 (bo_upload_size), checked before anything goes up.
    const most_mb = boardSetting(state.board, "uploadSize", 0);
    if (
      most_mb &&
      [...chosen, ...attaching].some((file) => file.size > most_mb * 1048576)
    )
      return say(`파일은 ${most_mb}MB까지 올릴 수 있습니다.`);
    const notes = [
      ...$("logAttachmentNotes").querySelectorAll<HTMLInputElement>("input"),
    ].map((input) => input.value.trim());
    const attachments = [];
    for (const [n, file] of attaching.entries()) {
      const stored = await uploadMedia(file);
      attachments.push({
        url: stored.url,
        name: stored.name ?? file.name,
        size: stored.size ?? file.size,
        type: stored.contentType ?? file.type,
        ...(notes[n] ? { note: notes[n] } : {}),
      });
    }
    const links = [
      $<HTMLInputElement>("logLink1").value.trim(),
      $<HTMLInputElement>("logLink2").value.trim(),
    ].filter(Boolean);
    const character = guest ? "" : $<HTMLSelectElement>("logCharacter").value;
    const action = guest ? "" : $<HTMLSelectElement>("logAction").value;
    const materials =
      action === "combine"
        ? [...$<HTMLSelectElement>("logMaterials").selectedOptions].map(
            (option) => option.value,
          )
        : [];
    if (action === "combine" && !materials.length)
      return say("조합 재료를 골라 주세요.");
    if (materials.length > 3)
      return say("조합 재료는 3개까지 고를 수 있습니다.");
    const used = guest ? "" : $<HTMLSelectElement>("logItem").value;
    const options =
      kindOf() === "image"
        ? {
            wide: $<HTMLInputElement>("logWide").checked,
            fold: $<HTMLInputElement>("logFold").checked,
            ...(guest
              ? {}
              : {
                  membersOnly: $<HTMLInputElement>("logMembersOnly").checked,
                  adult: $<HTMLInputElement>("logAdult").checked,
                  anonymous: $<HTMLInputElement>("logAnonymous").checked,
                }),
          }
        : {};
    const { document: log } = await mutate("community/posts:write", {
      data: {
        image: image?.url ?? (address || null),
        text: $<HTMLTextAreaElement>("logText").value.trim(),
        board: state.board,
        title: $<HTMLInputElement>("logTitle").value.trim(),
        category: $<HTMLSelectElement>("logCategory").value,
        secret: $<HTMLInputElement>("logSecret").checked,
        ...(character ? { character } : {}),
        ...($<HTMLInputElement>("logDice").checked ? { dice: true } : {}),
        ...(links.length ? { links } : {}),
        ...(files.length ? { files } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...options,
        ...(action === "combine" ? { action, materials } : {}),
        ...(action === "explore" ? { action } : {}),
        ...(used ? { item: used } : {}),
        ...(state.replyTo ? { replyTo: state.replyTo } : {}),
      },
      ...(guest ? { guest } : {}),
    });
    endReply();
    if (action || used) forgetInventory();
    state.ownPosts.add(log.id);
    if (state.newPost === log.id) showNewPost(null);
    const added = await logItem(log);
    $("logs").prepend(added);
    $<HTMLFormElement>("logForm").reset?.();
    $("logAttachmentNotes").replaceChildren();
    $("logAttachmentNotes").hidden = true;
    $<HTMLSelectElement>("logCharacter").value = character;
    configureBoard();
    say("로그를 올렸습니다.");
    // 췩: the picture holds its place; its words follow at once
    // (mmb/write_update.skin.php sends the writer to write.php?w=u).
    if (log.data.writing) {
      say("자리를 잡았습니다. 이어서 글을 써 주세요.");
      added.querySelector<HTMLButtonElement>(".edit")?.click();
    }
  });
};
wireItemChoice($("logItem"));
// 조합 takes the inventory's craft materials (it_use_recepi), up to three.
$("logMaterials").onfocus = $("logMaterials").onpointerdown = () =>
  run(async () => {
    if ($("logMaterials").dataset.loaded) return;
    $("logMaterials").dataset.loaded = "1";
    for (const { row, item, owner } of await postInventory())
      if (owner && item?.craftMaterial === true)
        $("logMaterials").append(
          new Option(`${row.data.name ?? row.data.item} (${owner})`, row.id),
        );
  });
wireSpeakerChoice($("logCharacter"));
