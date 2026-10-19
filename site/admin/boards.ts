// 게시판관리: the boards' list with 선택수정·선택삭제, 그룹적용·전체적용, and a group's 접근회원.
import { models } from "./forms.js";
import { $, CALLS, owner, references, run } from "./core.js";
import { openForm } from "./editor.js";
import { load } from "./list.js";
import { control } from "./views.js";

/**
 * A board group's 접근회원 (boardgroupmember_list.php, _form, _update): who
 * has its access, each with 삭제, and a nickname to add.
 */
export async function groupMembers(group) {
  const box = document.createElement("div");
  box.className = "group-members";
  const list = document.createElement("ul");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const show = async () => {
    list.replaceChildren();
    status.textContent = "읽는 중…";
    let after = "";
    let count = 0;
    do {
      const page = await owner.query("admin/board_groups:members", {
        group: group.id,
        after,
      });
      for (const member of page.members) {
        count += 1;
        const item = document.createElement("li");
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.className = "danger";
        remove.onclick = () =>
          run(async () => {
            await owner.mutate("admin/board_groups:setMember", {
              group: group.id,
              nick: member.nick,
              remove: true,
            });
            await show();
          });
        item.append(`${member.nick} `, remove);
        list.append(item);
      }
      after = page.nextCursor;
    } while (after);
    status.textContent = `접근회원 ${count}명`;
  };
  const form = document.createElement("form");
  const nick = document.createElement("input");
  nick.required = true;
  nick.maxLength = 20;
  nick.placeholder = "회원 닉네임";
  nick.setAttribute("aria-label", "추가할 회원 닉네임");
  const add = document.createElement("button");
  add.type = "submit";
  add.textContent = "추가";
  form.append(nick, " ", add);
  form.onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      await owner.mutate("admin/board_groups:setMember", {
        group: group.id,
        nick: nick.value.trim(),
      });
      nick.value = "";
      await show();
    });
  };
  box.append(status, list, form);
  await show();
  return box;
}
/** The 글 형식 choices, as the board form names them. */
export const boardKinds = () =>
  models.boards.fields.find((field) => field.key === "kind").options;
/**
 * A board in adm/board_list.php's list: chosen for 선택수정 or 선택삭제, with
 * the fields the list edits in place (그룹, 제목, 스킨 as 글 형식, and the
 * 글쓰기·댓글쓰기 rewards), 수정 for the whole form, 삭제, and 복사
 * (board_copy.php): a new ID and name, its settings alone (구조만) or with
 * its posts (구조와 데이터).
 */
export function boardRow(row) {
  const select = document.createElement("input");
  select.type = "checkbox";
  select.className = "board-select";
  select.value = row.id;
  select.setAttribute("aria-label", `${row.data.name} 선택`);
  const field = (name, label, input: HTMLInputElement | HTMLSelectElement) => {
    input.name = name;
    input.dataset.board = row.id;
    input.setAttribute("aria-label", `${row.data.name} ${label}`);
    return input;
  };
  const name = field("name", "제목", document.createElement("input"));
  name.value = row.data.name ?? "";
  (name as HTMLInputElement).maxLength = 120;
  const group = field("group", "그룹", document.createElement("select"));
  group.append(
    new Option("그룹 없음", ""),
    ...(references.groups ?? []).map(
      (entry) => new Option(entry.data.name, entry.id),
    ),
  );
  group.value = row.data.group ?? "";
  const kind = field("kind", "글 형식", document.createElement("select"));
  kind.append(...boardKinds().map(([id, text]) => new Option(text, id)));
  kind.value = row.data.kind ?? "image";
  const reward = (key, label) => {
    const input = field(key, label, document.createElement("input"));
    // Each may be negative: a charge (bo_*_point).
    (input as HTMLInputElement).type = "number";
    (input as HTMLInputElement).step = "1";
    input.value = String(row.data[key] ?? 0);
    input.title = label;
    return input;
  };
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "수정";
  edit.onclick = () => run(() => openForm(row));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "삭제";
  remove.className = "danger";
  remove.onclick = () =>
    run(async () => {
      if (!confirm("이 게시판을 삭제할까요?")) return;
      await removeBoards([row.id], postsGo());
      await load();
    });
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "복사";
  const copyForm = document.createElement("span");
  copyForm.className = "board-copy";
  copyForm.hidden = true;
  const target = document.createElement("input");
  target.maxLength = 20;
  target.placeholder = "복사 게시판 ID";
  target.setAttribute("aria-label", "복사할 게시판 ID (영문자, 숫자, _)");
  const title = document.createElement("input");
  title.maxLength = 120;
  title.value = `[복사본] ${row.data.name ?? ""}`;
  title.setAttribute("aria-label", "복사할 게시판 제목");
  const both = document.createElement("select");
  both.setAttribute("aria-label", "복사 유형");
  both.append(new Option("구조만", ""), new Option("구조와 데이터", "data"));
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "복사하기";
  go.onclick = () =>
    run(async () => {
      go.disabled = true;
      try {
        const result = await owner.mutate("admin/boards:copy", {
          id: row.id,
          target: target.value.trim(),
          name: title.value.trim(),
          data: both.value === "data",
        });
        $("adminStatus").textContent =
          `${result.id} 게시판으로 복사했습니다${both.value === "data" ? ` (글 ${result.posts}개)` : ""}.`;
        await load();
      } finally {
        go.disabled = false;
      }
    });
  copyForm.append(target, title, both, go);
  copy.onclick = () => {
    copyForm.hidden = !copyForm.hidden;
  };
  return [
    select,
    ` ${row.id} `,
    name,
    group,
    kind,
    // board_list.php's 읽기P, 쓰기P, 댓글P and 다운P.
    reward("readReward", "글읽기 포인트"),
    reward("writeReward", "글쓰기 포인트"),
    reward("commentReward", "댓글쓰기 포인트"),
    reward("downloadPoint", "다운로드 포인트"),
    " ",
    edit,
    " ",
    remove,
    " ",
    copy,
    copyForm,
  ];
}
/** The boards chosen in the list. */
export const chosenBoards = () =>
  [
    ...$("adminRows").querySelectorAll<HTMLInputElement>(
      ".board-select:checked",
    ),
  ].map((box) => box.value);
// 선택수정 (board_list_update.php): each chosen board's listed fields, saved
// one at a time as the form saves them.
$("boardsSave").onclick = () =>
  run(async () => {
    const chosen = chosenBoards();
    if (!chosen.length)
      throw new Error("선택수정 하실 항목을 하나 이상 체크하세요.");
    let saved = 0;
    try {
      for (const id of chosen) {
        const values: Record<string, unknown> = {};
        for (const input of $("adminRows").querySelectorAll<
          HTMLInputElement | HTMLSelectElement
        >(`[data-board="${CSS.escape(id)}"]`))
          values[input.name] =
            input.type === "number" ? Number(input.value) : input.value;
        await owner.mutate(CALLS.boards.save, { id, values });
        saved++;
      }
    } finally {
      $("adminStatus").textContent = `게시판 ${saved}개를 수정했습니다.`;
      await load();
    }
  });
/**
 * board_delete.inc.php drops a board's posts with it; here the owner says
 * whether they go, or stay to be moved later.
 */
const postsGo = () =>
  confirm(
    "게시판의 글과 댓글도 함께 삭제할까요?\n확인: 글도 삭제 (되돌릴 수 없음)\n취소: 글은 남김",
  );
/** Deletes boards, and their posts first when `withPosts`. */
async function removeBoards(ids: string[], withPosts: boolean) {
  let removed = 0;
  try {
    for (const id of ids) {
      if (withPosts) await owner.mutate("admin/boards:clear", { id });
      await owner.mutate(CALLS.boards.remove, { section: "boards", id });
      removed++;
    }
  } finally {
    $("adminStatus").textContent =
      `게시판 ${removed}개를 삭제했습니다${withPosts ? " (글 포함)" : ""}.`;
  }
}
// 선택삭제 (board_list_update.php): the chosen boards.
$("boardsRemove").onclick = () =>
  run(async () => {
    const chosen = chosenBoards();
    if (!chosen.length)
      throw new Error("선택삭제 하실 항목을 하나 이상 체크하세요.");
    if (!confirm(`선택한 게시판 ${chosen.length}개를 삭제할까요?`)) return;
    try {
      await removeBoards(chosen, postsGo());
    } finally {
      await load();
    }
  });

/**
 * board_form.php's 그룹적용 and 전체적용: the settings ticked here are
 * saved to every board of this board's group, or to every board, too.
 */
export function boardApply(model) {
  const fieldset = document.createElement("fieldset");
  fieldset.id = "boardApply";
  const legend = document.createElement("legend");
  legend.textContent = "그룹적용 · 전체적용";
  const to = document.createElement("select");
  to.dataset.applyTo = "";
  to.append(
    new Option("이 게시판에만 저장", ""),
    new Option("같은 그룹의 게시판에도 적용", "group"),
    new Option("모든 게시판에도 적용", "all"),
  );
  const list = document.createElement("p");
  list.className = "apply-fields";
  for (const field of model.fields) {
    if (!field.key || ["name", "group"].includes(field.key)) continue;
    if (field.type === "heading" || field.type === "group") continue;
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.applyField = field.key;
    label.append(box, ` ${field.label}`);
    list.append(label);
  }
  fieldset.append(legend, control("적용 범위", to), list);
  return fieldset;
}
