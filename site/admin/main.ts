// The owner's admin page: its addresses (#/<section>/<entry>), the menu,
// signing in, and what opens first.
import { models, menu, sectionLabel, shownSections } from "./forms.js";
import { config } from "../shared/config.js";
import {
  $,
  CALLS,
  itemNames,
  loadNames,
  naru,
  owner,
  reportFilters,
  routing,
  run,
  section,
  setNaru,
  setOwner,
  setReportFilters,
  setRouting,
  setSection,
} from "./core.js";
import { load } from "./list.js";
import { openCharacterForm } from "./characters.js";
import { openForm } from "./editor.js";
import { maintain } from "./members.js";
// Each part of the page, which wires its own controls as it loads.
import "./list.js";
import "./boards.js";
import "./characters.js";
import "./editor.js";
import "./members.js";
import "./views.js";
import "./tools.js";

export function adminRoute(parts, { replace = true } = {}) {
  if (routing) return;
  const hash = `#/${parts
    .filter((part) => part !== "" && part !== null && part !== undefined)
    .map((part) => encodeURIComponent(String(part)))
    .join("/")}`;
  if (location.hash !== hash)
    history[replace ? "replaceState" : "pushState"](null, "", hash);
}
/** The address's parts, decoded. */
export function addressParts() {
  return location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}
/** Opens what the address names: a section, an entry in it, or a report. */
export async function openAddress() {
  const [name, entry, ...filters] = addressParts();
  setRouting(true);
  try {
    // The bare address (the header's title) is 관리자메인.
    if (!name) setSection("main");
    else if (Object.hasOwn(models, name)) {
      // A search is the section's it was made in.
      if (name !== section) $<HTMLInputElement>("recordText").value = "";
      setSection(name);
    }
    renderNav();
    $("adminForm").hidden = true;
    $("characterForm").hidden = true;
    $("titleGrantForm").hidden = true;
    const model = models[section];
    setReportFilters(
      model.report && name === section ? [entry, ...filters] : [],
    );
    await load();
    // A settings form is opened by load(), whatever its address names.
    if (model.report || model.fixedId || name !== section || !entry) return;
    const open = model.review ? openCharacterForm : openForm;
    if (entry === "new") return open();
    if (!CALLS[section]?.get) return;
    const row = await owner.query(CALLS[section].get, { section, id: entry });
    if (!row) {
      $("adminStatus").textContent = "자료를 찾을 수 없습니다.";
      return;
    }
    await open(row);
  } finally {
    setRouting(false);
  }
}
addEventListener("hashchange", () => {
  if (owner) run(openAddress);
});
/**
 * The menu (adm/admin.head.php's side menu): the original's groups, the
 * current one open, the current section marked.
 */
export function renderNav() {
  const groups = menu.map((group) => {
    const details = document.createElement("details");
    details.open = group.sections.includes(section);
    const summary = document.createElement("summary");
    summary.textContent = group.label;
    const list = document.createElement("ul");
    for (const name of shownSections(group, itemNames, section)) {
      const link = document.createElement("a");
      link.href = `#/${name}`;
      link.textContent = sectionLabel(name, itemNames);
      if (name === section) link.setAttribute("aria-current", "page");
      const item = document.createElement("li");
      item.append(link);
      list.append(item);
    }
    details.append(summary, list);
    return details;
  });
  $("adminNav").replaceChildren(...groups);
  $("adminTitle").textContent = sectionLabel(section, itemNames);
}
$("adminSignIn").onclick = () =>
  // The site has no collections: the owner manages it through admin/'s
  // queries and mutations.
  run(() => naru.auth.signIn());
$("adminSignOut").onclick = () =>
  run(async () => {
    await owner.signOut();
    setOwner(null);
    $("adminSignOut").hidden = true;
    $("adminWorkspace").hidden = true;
    $("adminWelcome").hidden = false;
  });
await run(async () => {
  const { createNaru } = await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
  setNaru(createNaru(config.site ? { site: config.site } : undefined));
  renderNav();
  setOwner(await naru.auth.session());
  if (!owner) return;
  $("adminWelcome").hidden = true;
  $("adminSignOut").hidden = false;
  $("adminWorkspace").hidden = false;
  await loadNames();
  await openAddress();
  adminRoute([section]);
  // bbs/db_table.optimize.php, as the owner arrives: in the background.
  maintain().catch(() => {});
});
