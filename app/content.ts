// Quests and the site's own pages.

import { renderContent } from "../content-renderer.js";
import { $, query, route, run, showTab, state } from "./core.js";

let questCursor = null;
async function loadQuests(more = false) {
  const page = await query("content/quests:quests", {
    type: $<HTMLSelectElement>("questType").value,
    after: more ? questCursor : null,
  });
  if (!more) $("quests").replaceChildren();
  for (const quest of page.quests) {
    const li = document.createElement("li");
    li.className = "card";
    const heading = document.createElement("h3");
    heading.textContent = quest.name;
    const detail = document.createElement("p");
    detail.textContent = `${quest.type === "weekly" ? "주간" : "일일"} · ${quest.side || "공통"} · ${quest.startsAt?.replace("T", " ") || "시작 제한 없음"} ~ ${quest.endsAt?.replace("T", " ") || "종료 제한 없음"} (한국 시간)`;
    li.append(heading, detail);
    for (const url of quest.images ?? []) {
      if (typeof url !== "string" || !url.startsWith("https://")) continue;
      const image = document.createElement("img");
      image.src = url;
      image.alt = quest.name;
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
  const id = $<HTMLSelectElement>("contentPage").value;
  if (!id) {
    $("contentBody").textContent = "등록된 안내 페이지가 없습니다.";
    return;
  }
  const member = state.member;
  $("contentBody").replaceChildren();
  const result = await query("content/pages:contentPage", {
    id,
    mobile: window.innerWidth <= 700,
  });
  if (
    state.member !== member ||
    $<HTMLSelectElement>("contentPage").value !== id
  )
    return;
  renderContent($("contentBody"), result.page);
}
export async function loadContentPages() {
  const previous = $<HTMLSelectElement>("contentPage").value;
  $("contentPage").replaceChildren();
  const { pages } = await query("content/pages:contentPages");
  for (const page of pages) {
    const option = document.createElement("option");
    option.value = page.id;
    option.textContent = page.name;
    $("contentPage").append(option);
  }
  if (
    [...$<HTMLSelectElement>("contentPage").options].some(
      (option) => option.value === previous,
    )
  )
    $<HTMLSelectElement>("contentPage").value = previous;
  if (!$("contentView").hidden && $<HTMLSelectElement>("contentPage").value)
    route(`content/${$<HTMLSelectElement>("contentPage").value}`, {
      replace: true,
    });
  await loadContentBody();
}
$("tabContent").onclick = () =>
  run(async () => {
    showTab("content");
    await loadContentPages();
  });
$("contentPage").onchange = () =>
  run(async () => {
    route(`content/${$<HTMLSelectElement>("contentPage").value}`, {
      replace: true,
    });
    await loadContentBody();
  });
$("refreshContent").onclick = () => run(() => loadContentPages());
