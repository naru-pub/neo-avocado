// Quests and the site's own pages.

import { renderContent } from "../content-renderer.js";
import { $, caller, route, run, showTab, state } from "./core.js";

let questCursor = null;
async function loadQuests(more = false) {
  const page = await caller().call("content/quests:quests", {
    type: $("questType").value,
    after: more ? questCursor : null,
  });
  if (!more) $("quests").replaceChildren();
  for (const row of page.documents) {
    const li = document.createElement("li");
    li.className = "card";
    const heading = document.createElement("h3");
    heading.textContent = row.data.name;
    const detail = document.createElement("p");
    detail.textContent = `${row.data.type === "weekly" ? "주간" : "일일"} · ${row.data.side || "공통"} · ${row.data.startsAt?.replace("T", " ") || "시작 제한 없음"} ~ ${row.data.endsAt?.replace("T", " ") || "종료 제한 없음"} (한국 시간)`;
    li.append(heading, detail);
    for (const url of row.data.images ?? []) {
      if (typeof url !== "string" || !url.startsWith("https://")) continue;
      const image = document.createElement("img");
      image.src = url;
      image.alt = row.data.name;
      image.loading = "lazy";
      image.style.maxWidth = "100%";
      li.append(image);
    }
    $("quests").append(li);
  }
  questCursor = page.nextCursor;
  $("moreQuests").hidden = !questCursor;
}
$("tabQuests").onclick = () =>
  run(async () => {
    showTab("quests");
    await loadQuests();
  });
$("questType").onchange = () => run(() => loadQuests());
$("refreshQuests").onclick = () => run(() => loadQuests());
$("moreQuests").onclick = () => run(() => loadQuests(true));
export async function loadContentBody() {
  const id = $("contentPage").value;
  if (!id) {
    $("contentBody").textContent = "등록된 안내 페이지가 없습니다.";
    return;
  }
  const member = state.member;
  $("contentBody").replaceChildren();
  const result = await caller().call("content/pages:contentPage", {
    id,
    mobile: window.innerWidth <= 700,
  });
  if (state.member !== member || $("contentPage").value !== id) return;
  renderContent($("contentBody"), result.page);
}
export async function loadContentPages() {
  const previous = $("contentPage").value;
  $("contentPage").replaceChildren();
  let cursor = null;
  do {
    const page = await caller().call("content/pages:contentPages", {
      after: cursor,
    });
    for (const row of page.documents) {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = row.data.name;
      $("contentPage").append(option);
    }
    cursor = page.nextCursor;
  } while (cursor);
  if ([...$("contentPage").options].some((option) => option.value === previous))
    $("contentPage").value = previous;
  if (!$("contentView").hidden && $("contentPage").value)
    route(`content/${$("contentPage").value}`, { replace: true });
  await loadContentBody();
}
$("tabContent").onclick = () =>
  run(async () => {
    showTab("content");
    await loadContentPages();
  });
$("contentPage").onchange = () =>
  run(async () => {
    route(`content/${$("contentPage").value}`, { replace: true });
    await loadContentBody();
  });
$("refreshContent").onclick = () => run(() => loadContentPages());
