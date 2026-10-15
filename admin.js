import { applyTitles, deleteTitle } from "./admin-titles.js";
import { resumeCleanup } from "./admin-cleanup.js";
import { config } from "./config.js";
import {
  VISIT_BREAKDOWNS,
  activityReport,
  koreanDay,
  visitReport,
} from "./admin-reports.js";
import {
  models,
  scopes,
  buildRecord,
  fieldValue,
  walletWrites,
  characterStateWrites,
  titleHoldings,
} from "./admin-model.js";
const $ = (id) => document.getElementById(id);
let grantTitleId;
let naru,
  owner,
  section = "couples",
  cursor = null,
  selected = null;
let references = {
  fields: [],
  characters: [],
  titles: [],
  stats: [],
  items: [],
  profiles: [],
};
function message(error) {
  // A site function's own ctx.fail message comes with a reason.
  if (error?.details?.reason) return error.message;
  return error?.code === "CONFLICT"
    ? "다른 창에서 바뀌었습니다. 다시 불러온 뒤 수정하세요."
    : error?.code === "NOT_FOUND"
      ? "컬렉션을 먼저 만들거나 삭제된 자료를 확인하세요."
      : error?.code === "ACCESS_DENIED"
        ? "사이트 소유자 권한이 필요합니다."
        : error?.code === "AUTH_REQUIRED"
          ? "운영자 로그인이 끝났습니다. 다시 로그인하세요."
          : (error?.message ?? "처리하지 못했습니다.");
}
async function run(action) {
  try {
    await action();
  } catch (error) {
    $("adminStatus").textContent = message(error);
  }
}
async function all(collection) {
  const rows = [];
  for await (const page of owner.collection(collection).pages({ size: 100 }))
    rows.push(...page.documents);
  return rows;
}
async function load({ more = false } = {}) {
  const requestedSection = section;
  const model = models[section];
  $("adminHelp").textContent = model.help;
  $("adminNew").hidden = Boolean(model.readOnly);
  $("adminReport").hidden = !model.report;
  $("adminRows").hidden = Boolean(model.report);
  if (model.report) {
    $("adminMore").hidden = true;
    $("holdingsSearchLabel").hidden = true;
    return model.report === "visits" ? visitsView() : activityView();
  }
  $("holdingsSearchLabel").hidden = !model.holdings;
  let page;
  if (model.holdings) {
    references.titles = await all("neo_avocado_titles");
    references.characters = await all("neo_avocado_characters");
    const rows = titleHoldings(
      await all(model.collection),
      references.characters,
      references.titles,
      $("holdingsSearch").value,
    );
    const start = more ? Number(cursor) : 0;
    page = {
      documents: rows.slice(start, start + 50),
      nextCursor: start + 50 < rows.length ? String(start + 50) : null,
    };
  } else if (model.review) {
    references.fields = await all("neo_avocado_character_fields");
    page = await owner.collection(model.collection).list({
      size: 50,
      after: more ? cursor : null,
      sort: [[{ metadata: "createdAt" }, "desc"]],
      where: { ne: ["deleted", true] },
    });
  } else
    page = await owner.collection(model.collection).list({
      size: 50,
      after: more ? cursor : null,
      ...(model.cleanup ? { filter: { deleted: true } } : {}),
    });
  if (requestedSection !== section || !owner) return;
  if (!more) $("adminRows").replaceChildren();
  for (const row of page.documents) {
    const li = document.createElement("li");
    if (model.holdings) {
      li.append(
        `${row.character} · ${row.title}${row.active ? " · 착용 중" : ""} `,
      );
      if (typeof row.image === "string" && row.image.startsWith("https://")) {
        const image = document.createElement("img");
        image.src = row.image;
        image.alt = row.title;
        image.loading = "lazy";
        image.className = "title-image";
        li.prepend(image);
      }
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "회수";
      revoke.onclick = () =>
        run(async () => {
          revoke.disabled = true;
          try {
            const previous = row.state;
            await owner.collection("neo_avocado_character_state").set(
              previous.id,
              {
                ...previous.data,
                titles: (previous.data.titles ?? []).filter(
                  (id) => id !== row.titleId,
                ),
                ...(previous.data.activeTitle === row.titleId
                  ? { activeTitle: null }
                  : {}),
              },
              { condition: { revision: previous.revision } },
            );
            $("adminStatus").textContent = "타이틀을 회수했습니다.";
            await load();
          } finally {
            revoke.disabled = false;
          }
        });
      li.append(revoke);
      $("adminRows").append(li);
      continue;
    }
    if (model.review) {
      li.append(reviewRow(row));
      $("adminRows").append(li);
      continue;
    }
    if (model.cleanup) {
      li.append(`${row.data.name ?? row.data.title ?? row.id} · 삭제 정리 중 `);
      const resume = document.createElement("button");
      resume.type = "button";
      resume.textContent = "정리 계속";
      resume.onclick = () =>
        run(async () => {
          resume.disabled = true;
          try {
            const result = await resumeCleanup(owner, model.cleanup, row.id);
            $("adminStatus").textContent = result.done
              ? "정리를 완료했습니다."
              : "일부 자료를 정리했습니다. 정리 계속을 눌러 이어가세요.";
            await load();
          } finally {
            resume.disabled = false;
          }
        });
      li.append(resume);
      $("adminRows").append(li);
      continue;
    }
    if (model.readOnly) {
      li.textContent = `${new Date(row.data.at).toLocaleString("ko-KR")} · ${row.data.owner} · ${row.data.kind}${row.data.delta !== undefined ? ` · ${row.data.delta} 아보` : ""}${row.data.memo ? ` · ${row.data.memo}` : ""}`;
      $("adminRows").append(li);
      continue;
    }
    li.append(
      row.data.name ??
        references.characters.find((character) => character.id === row.id)?.data
          .name ??
        references.profiles.find((profile) => profile.id === row.id)?.data
          .nick ??
        row.id,
      " ",
    );
    if (section === "wallets") li.append(`${row.data.balance} 아보 `);
    if (section === "inventory")
      li.append(
        `${references.profiles.find((profile) => profile.id === row.data.owner)?.data.nick ?? row.data.owner} · ${references.characters.find((character) => character.id === row.data.character)?.data.name ?? "회원 인벤토리"} `,
      );
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "수정";
    edit.onclick = () => run(() => openForm(row));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.hidden = Boolean(model.noDelete);
    remove.textContent = "삭제";
    remove.onclick = () =>
      run(async () => {
        if (!confirm("이 자료를 삭제할까요?")) return;
        if (section === "titles") {
          await deleteTitle(owner, row.id, ({ completed }) => {
            $("adminStatus").textContent =
              `${completed}명의 타이틀을 회수했습니다.`;
          });
          await load();
          return;
        }
        // Uploads the row used go with it (managed uploads).
        await owner
          .collection(model.collection)
          .delete(row.id, { condition: { revision: row.revision } });
        await load();
      });
    li.append(edit, " ", remove);
    if (section === "titles") {
      const grant = document.createElement("button");
      grant.type = "button";
      grant.textContent = "지급·회수";
      grant.disabled = Boolean(row.data.deleted);
      if (row.data.deleted)
        li.append(" (삭제 정리 중: 삭제를 다시 눌러 재개) ");
      grant.onclick = () =>
        run(async () => {
          grantTitleId = row.id;
          $("titleGrantHeading").textContent = `${row.data.name} 지급·회수`;
          $("titleGrantStatus").textContent = "";
          $("titleGrantCharacters").replaceChildren();
          for (const character of await all("neo_avocado_characters")) {
            if (character.data.deleted) continue;
            const option = document.createElement("option");
            option.value = character.id;
            option.textContent = `${character.data.name} (${character.id})`;
            $("titleGrantCharacters").append(option);
          }
          $("titleGrantForm").hidden = false;
        });
      li.append(" ", grant);
    }
    $("adminRows").append(li);
  }
  cursor = page.nextCursor;
  $("adminMore").hidden = !cursor;
}
const STATES = {
  editing: "수정 중",
  submitted: "신청(수정 완료)",
  approved: "승인",
};
const TYPES = [
  ["main", "메인"],
  ["sub", "서브"],
  ["npc", "NPC"],
];
/** One application: its sheet with every field, the decision and admin-only values. */
function reviewRow(row) {
  const form = document.createElement("form");
  form.className = "review";
  const nick =
    references.profiles.find(
      (profile) => profile.id === (row.createdBy ?? row.data.owner),
    )?.data.nick ?? "알 수 없는 회원";
  const heading = document.createElement("strong");
  heading.textContent = `${row.data.name} · ${nick} · ${STATES[row.data.state] ?? "상태 없음(이전 캐릭터)"}`;
  const sheet = document.createElement("dl");
  const definitions = references.fields
    .filter((field) => !field.data.deleted)
    .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0));
  const adminInputs = [];
  for (const field of definitions) {
    const term = document.createElement("dt");
    term.textContent = `${field.data.label ?? field.id}${field.data.visibility === "admin" ? " (운영자만)" : field.data.visibility === "owner" ? " (오너+운영자)" : ""}`;
    const detail = document.createElement("dd");
    const value = row.data.fields?.[field.id] ?? "";
    if (field.data.visibility === "admin") {
      const input = document.createElement("input");
      input.name = field.id;
      input.value = value;
      input.maxLength = 2000;
      input.setAttribute("aria-label", field.data.label ?? field.id);
      adminInputs.push(input);
      detail.append(input);
    } else detail.textContent = value || "—";
    sheet.append(term, detail);
  }
  const type = document.createElement("select");
  type.setAttribute("aria-label", "캐릭터 종류");
  for (const [value, label] of TYPES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    type.append(option);
  }
  type.value = row.data.type ?? "main";
  const decide = (state) =>
    run(async () => {
      for (const control of form.querySelectorAll("button,input,select"))
        control.disabled = true;
      try {
        await owner.call("characters/review:reviewCharacter", {
          character: row.id,
          revision: row.revision,
          type: type.value,
          ...(state ? { state } : {}),
          fields: Object.fromEntries(
            adminInputs.map((input) => [input.name, input.value]),
          ),
        });
        $("adminStatus").textContent = state
          ? `${row.data.name}: ${STATES[state]}`
          : "저장했습니다.";
        await load();
      } finally {
        for (const control of form.querySelectorAll("button,input,select"))
          control.disabled = false;
      }
    });
  const buttons = [
    ["approved", "승인"],
    ["editing", "수정 요청"],
    ["submitted", "신청 상태로"],
    [null, "종류·운영자 항목 저장"],
  ].map(([state, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.onclick = () => decide(state);
    return button;
  });
  form.onsubmit = (event) => event.preventDefault();
  form.append(heading, " ", type, sheet, ...buttons);
  return form;
}
/**
 * An ID for a new row: the section's name and four random characters, which
 * every section's ID rules accept (a lowercase letter first, then lowercase
 * letters, digits and underscores).
 */
function suggestedId(section) {
  const prefix = section.replace(/s$/, "").replace(/[^a-z0-9_]/g, "") || "id";
  const random = crypto
    .getRandomValues(new Uint32Array(1))[0]
    .toString(36)
    .padStart(4, "0")
    .slice(-4);
  return `${prefix}_${random}`;
}
async function openForm(row = null) {
  const requestedSection = section;
  references = {
    characters: await all("neo_avocado_characters"),
    titles: (await all("neo_avocado_titles")).filter(
      (row) => !row.data.deleted,
    ),
    stats: await all("neo_avocado_stat_config"),
    items: await all("neo_avocado_items"),
    profiles: await all("neo_avocado_profiles"),
    sides: await all("neo_avocado_sides"),
    classes: await all("neo_avocado_classes"),
    groups: await all("neo_avocado_board_groups"),
  };
  if (requestedSection !== section || !owner) return;
  selected = row;
  const model = models[section];
  $("adminFormTitle").textContent = `${model.label} ${row ? "수정" : "등록"}`;
  $("adminFormStatus").textContent = "";
  $("adminFields").replaceChildren();
  const fields = [
    {
      key: "id",
      label: model.characterKey
        ? "캐릭터"
        : model.memberKey
          ? "회원"
          : "ID (등록 후 변경 불가, 미리 정해 둔 값을 바꿔도 됩니다)",
      type: model.characterKey
        ? "character"
        : model.memberKey
          ? "profile"
          : "text",
      required: true,
      // A new row gets an ID ready to use; it only has to be unique.
      ...(!row && !model.characterKey && !model.memberKey
        ? { default: suggestedId(section) }
        : {}),
    },
    ...model.fields,
  ];
  if (model.characterKey)
    for (const definition of references.stats)
      fields.push(
        {
          key: `allocated:${definition.id}`,
          label: `${definition.data.name} 배분 포인트`,
          type: "number",
          default: row?.data.stats?.[definition.id]?.allocated ?? 0,
        },
        {
          key: `damage:${definition.id}`,
          label: `${definition.data.name} 받은 피해량`,
          type: "number",
          default:
            row?.data.stats?.[definition.id]?.damage ??
            (row?.data.stats?.[definition.id]?.max ?? definition.data.initial) -
              (row?.data.stats?.[definition.id]?.current ??
                definition.data.initial),
        },
      );
  for (const field of fields) {
    const value =
      field.key === "id"
        ? (row?.id ?? model.fixedId ?? field.default)
        : section === "quests" && field.key === "images"
          ? (row?.data.images?.join("\n") ?? "")
          : (fieldValue(row?.data, field.key) ?? field.default);
    if (field.type === "ingredients") {
      const group = document.createElement("fieldset");
      group.dataset.ingredients = field.key;
      const legend = document.createElement("legend");
      legend.textContent = field.label;
      group.append(legend);
      const addRow = (entry = {}) => {
        const line = document.createElement("div");
        line.className = "ingredient-row";
        const item = document.createElement("select");
        item.className = "ingredient-item";
        item.setAttribute("aria-label", "재료 아이템");
        item.required = true;
        for (const reference of references.items) {
          const option = document.createElement("option");
          option.value = reference.id;
          option.textContent = reference.data.name;
          item.append(option);
        }
        if (
          entry.item &&
          !references.items.some((reference) => reference.id === entry.item)
        ) {
          const option = document.createElement("option");
          option.value = entry.item;
          option.textContent = `${entry.item} (삭제됨: 다시 선택하세요)`;
          item.append(option);
        }
        if (entry.item) item.value = entry.item;
        const count = document.createElement("input");
        count.className = "ingredient-count";
        count.type = "number";
        count.min = "1";
        count.step = "1";
        count.value = entry.count ?? 1;
        count.required = true;
        count.setAttribute("aria-label", "재료 개수");
        line.append(item, count);
        if (field.consumes) {
          const consumeLabel = document.createElement("label");
          const consume = document.createElement("input");
          consume.type = "checkbox";
          consume.className = "ingredient-consume";
          consume.checked = Boolean(entry.consume);
          consumeLabel.append(consume, "소모");
          line.append(consumeLabel);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "재료 빼기";
        remove.onclick = () => line.remove();
        line.append(remove);
        group.insertBefore(line, add);
      };
      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "재료 추가";
      add.onclick = () => addRow();
      group.append(add);
      for (const entry of value ?? []) addRow(entry);
      $("adminFields").append(group);
      continue;
    }
    const label = document.createElement("label");
    label.textContent = field.label;
    // A pick from an owner's list; free text while that list is empty.
    const pickRows =
      field.type === "pick"
        ? (references[field.from] ?? []).filter((row) => !row.data.deleted)
        : null;
    const isSelect =
      [
        "character",
        "titles",
        "item",
        "stat",
        "title",
        "choice",
        "profile",
      ].includes(field.type) ||
      (field.type === "pick" && (pickRows.length || !field.fallbackText));
    const input = document.createElement(
      isSelect ? "select" : field.type === "textarea" ? "textarea" : "input",
    );
    input.name = field.key;
    // An image field may be filled by an upload instead; buildRecord checks.
    input.required = Boolean(field.required) && !field.image;
    if (!isSelect && field.type !== "textarea")
      input.type = ["optional-number", "decimal"].includes(field.type)
        ? "number"
        : ["tokens", "pick"].includes(field.type)
          ? "text"
          : (field.type ?? "text");
    if (["number", "optional-number", "decimal"].includes(field.type)) {
      input.min = "0";
      input.step = field.type === "decimal" ? "any" : "1";
    }
    if (isSelect) {
      input.multiple = field.type === "titles" || Boolean(field.multiple);
      if (field.optional) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "선택하지 않음";
        input.append(option);
      }
      const choices = pickRows
        ? pickRows.map((row) => ({
            id: field.valueBy === "name" ? row.data.name : row.id,
            data: { name: row.data.name },
          }))
        : field.options
          ? field.options.map(([id, name]) => ({ id, data: { name } }))
          : references[
              field.type === "character"
                ? "characters"
                : field.type === "stat"
                  ? "stats"
                  : ["title", "titles"].includes(field.type)
                    ? "titles"
                    : field.type === "profile"
                      ? "profiles"
                      : "items"
            ];
      for (const optionRow of choices) {
        const option = document.createElement("option");
        option.value = optionRow.id;
        option.textContent = optionRow.data.name ?? optionRow.data.nick;
        option.selected = input.multiple
          ? (value ?? []).includes(optionRow.id)
          : value === optionRow.id;
        input.append(option);
      }
      if (
        !input.multiple &&
        value &&
        !choices.some((optionRow) => optionRow.id === value)
      ) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = `${value} (삭제됨: 다시 선택하세요)`;
        input.append(option);
      }
      if (!input.multiple && value !== undefined && value !== null)
        input.value = value;
    } else if (field.type === "checkbox") input.checked = Boolean(value);
    else
      input.value =
        field.type === "tokens" ? (value ?? []).join(", ") : (value ?? "");
    if (field.max) input.maxLength = field.max;
    if (field.key === "id" && (row || model.fixedId)) {
      input.value = row?.id ?? model.fixedId;
      input.disabled = true;
    }
    if (field.image) input.placeholder = "https://";
    label.append(input);
    $("adminFields").append(label);
    if (field.image || field.images)
      $("adminFields").append(imageUpload(field, value));
  }
  $("adminForm").hidden = false;
}

/**
 * A file picker beside an image field: saving uploads the file to Naru Media
 * and its address takes the field's place (quest images: joins the list). The
 * upload is managed, so Naru keeps it while a document names it and deletes it
 * once none does: replacing an image or deleting the row frees its file.
 */
function imageUpload(field, value) {
  const upload = document.createElement("label");
  upload.className = "image-upload";
  if (
    field.image &&
    typeof value === "string" &&
    value.startsWith("https://")
  ) {
    const preview = document.createElement("img");
    preview.src = value;
    preview.alt = "";
    preview.loading = "lazy";
    upload.append(preview);
  }
  upload.append(field.images ? "이미지 파일 올리기 (여러 장)" : "파일 올리기");
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";
  file.multiple = Boolean(field.images);
  file.dataset.uploadFor = field.key;
  upload.append(file);
  return upload;
}
$("adminForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("adminForm").querySelector('[type="submit"]');
  button.disabled = true;
  $("adminSection").disabled = true;
  $("adminNew").disabled = true;
  try {
    const values = {};
    for (const input of $("adminFields").querySelectorAll(
      "input,select,textarea",
    ))
      if (input.name)
        values[input.name] =
          input.type === "checkbox"
            ? input.checked
            : input.multiple
              ? [...input.selectedOptions].map((option) => option.value)
              : input.value;
    for (const group of $("adminFields").querySelectorAll("[data-ingredients]"))
      values[group.dataset.ingredients] = [
        ...group.querySelectorAll(".ingredient-row"),
      ].map((line) => ({
        item: line.querySelector(".ingredient-item").value,
        count: line.querySelector(".ingredient-count").value,
        consume: line.querySelector(".ingredient-consume")?.checked ?? false,
      }));
    for (const file of $("adminFields").querySelectorAll("[data-upload-for]")) {
      if (!file.files?.length) continue;
      $("adminFormStatus").textContent = "이미지를 올리는 중…";
      const urls = [];
      for (const chosen of file.files)
        urls.push((await owner.media.upload(chosen, { managed: true })).url);
      const key = file.dataset.uploadFor;
      values[key] = file.multiple
        ? [values[key], ...urls].filter(Boolean).join("\n")
        : urls[0];
    }
    $("adminFormStatus").textContent = "";
    const record = buildRecord(section, values, selected, references);
    let saved;
    if (section === "wallets") {
      const results = await owner.batch(
        walletWrites(
          record,
          selected,
          values.note,
          Date.now(),
          crypto.randomUUID(),
        ),
      );
      saved = { ...record, ...results[0] };
    } else if (section === "character_state") {
      const results = await owner.batch(
        characterStateWrites(
          record,
          selected,
          values.expNote,
          Date.now(),
          crypto.randomUUID(),
        ),
      );
      saved = { ...record, ...results[0] };
    } else
      saved = await owner
        .collection(models[section].collection)
        .set(record.id, record.data, {
          condition: selected
            ? { revision: selected.revision }
            : { absent: true },
        });
    selected = saved;
    $("adminForm").hidden = true;
    $("adminStatus").textContent = "저장했습니다.";
    await load();
  } catch (error) {
    $("adminFormStatus").textContent = message(error);
  } finally {
    button.disabled = false;
    $("adminSection").disabled = false;
    $("adminNew").disabled = false;
  }
};
$("adminCancel").onclick = () => {
  $("adminForm").hidden = true;
};
$("adminNew").onclick = () => run(() => openForm());
$("adminMore").onclick = () => run(() => load({ more: true }));
$("adminSection").onchange = () =>
  run(async () => {
    section = $("adminSection").value;
    $("adminForm").hidden = true;
    $("titleGrantForm").hidden = true;
    await load();
  });
$("adminSignIn").onclick = () =>
  run(() => naru.auth.signIn({ collections: scopes }));
$("adminSignOut").onclick = () =>
  run(async () => {
    await owner.signOut();
    owner = null;
    $("adminWorkspace").hidden = true;
    $("adminWelcome").hidden = false;
  });
await run(async () => {
  const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
  naru = createNaru(config.site ? { site: config.site } : undefined);
  for (const [name, model] of Object.entries(models)) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = model.label;
    $("adminSection").append(option);
  }
  $("adminSection").value = section;
  owner = await naru.auth.session();
  if (!owner) return;
  $("adminWelcome").hidden = true;
  $("adminWorkspace").hidden = false;
  references.characters = await all("neo_avocado_characters");
  references.profiles = await all("neo_avocado_profiles");
  await load();
});

$("titleGrantCancel").onclick = () => {
  $("titleGrantForm").hidden = true;
};
$("titleGrantForm").onsubmit = async (event) => {
  event.preventDefault();
  const controls = [
    ...$("titleGrantForm").querySelectorAll("button,input,select"),
    $("adminSection"),
    $("adminSignOut"),
  ];
  controls.forEach((control) => {
    control.disabled = true;
  });
  try {
    const result = await applyTitles(
      owner,
      grantTitleId,
      {
        action: $("titleGrantAction").value,
        allApproved: $("titleGrantAll").checked,
        characterIds: $("titleGrantAll").checked
          ? []
          : [...$("titleGrantCharacters").selectedOptions].map(
              (option) => option.value,
            ),
      },
      ({ completed, total }) => {
        $("titleGrantStatus").textContent =
          `${completed}/${total}명 처리했습니다.`;
      },
    );
    $("titleGrantStatus").textContent =
      `${result.completed}명에게 적용했습니다.`;
  } catch (error) {
    $("titleGrantStatus").textContent = error.message ?? message(error);
  } finally {
    controls.forEach((control) => {
      control.disabled = false;
    });
  }
};

$("holdingsFind").onclick = () => run(() => load());
$("holdingsSearch").onkeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    run(() => load());
  }
};

/* ---------------------------------------------------------- reports --- */

/** A labelled control for a report's filter bar. */
function control(text, element) {
  const label = document.createElement("label");
  label.append(text, element);
  return label;
}
function dateInput(value) {
  const input = document.createElement("input");
  input.type = "date";
  input.value = value;
  return input;
}
/** A plain table of `rows` under `headings`. */
function table(headings, rows) {
  const element = document.createElement("table");
  element.className = "report";
  const head = element.createTHead().insertRow();
  for (const heading of headings) {
    const cell = document.createElement("th");
    cell.textContent = heading;
    head.append(cell);
  }
  const body = element.createTBody();
  for (const cells of rows) {
    const row = body.insertRow();
    for (const value of cells) {
      const cell = row.insertCell();
      if (value instanceof Node) cell.append(value);
      else cell.textContent = String(value);
    }
  }
  if (!rows.length) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = headings.length;
    cell.textContent = "자료가 없습니다.";
  }
  return element;
}
const today = () => koreanDay(Date.now());
const daysAgo = (days) => koreanDay(Date.now() - days * 24 * 3600 * 1000);

/** 접속자 집계 (adm/visit_list.php and its tabs), and deleting old days. */
function visitsView() {
  const from = dateInput(daysAgo(6));
  const to = dateInput(today());
  const by = document.createElement("select");
  for (const [value, text] of VISIT_BREAKDOWNS)
    by.append(new Option(text, value));
  const show = document.createElement("button");
  show.type = "button";
  show.textContent = "보기";
  const prune = document.createElement("button");
  prune.type = "button";
  prune.textContent = "시작일 이전 기록 삭제";
  const output = document.createElement("div");
  const draw = async () => {
    const days = await all("neo_avocado_visits");
    const report = visitReport(days, {
      from: from.value,
      to: to.value,
      by: by.value,
    });
    const top = Math.max(1, ...report.rows.map((row) => row.count));
    const bar = (count) => {
      const meter = document.createElement("meter");
      meter.max = top;
      meter.value = count;
      return meter;
    };
    const summary = document.createElement("p");
    summary.textContent = `접속 ${report.total}회 · 회원 ${report.members}명 · 손님 접속 ${report.guests}회`;
    output.replaceChildren(
      summary,
      table(
        ["구분", "접속 수", ""],
        report.rows.map((row) => [row.label, row.count, bar(row.count)]),
      ),
    );
  };
  show.onclick = () => run(draw);
  prune.onclick = () =>
    run(async () => {
      if (!from.value) return;
      const old = (await all("neo_avocado_visits")).filter(
        (row) => row.data.day < from.value,
      );
      if (!old.length) {
        $("adminStatus").textContent = "지울 기록이 없습니다.";
        return;
      }
      if (
        !confirm(`${from.value} 이전 ${old.length}일의 접속 기록을 지울까요?`)
      )
        return;
      for (const row of old)
        await owner.collection("neo_avocado_visits").delete(row.id);
      $("adminStatus").textContent =
        `${old.length}일의 접속 기록을 지웠습니다.`;
      await draw();
    });
  const bar = document.createElement("div");
  bar.className = "report-filters";
  bar.append(
    control("시작일", from),
    control("종료일", to),
    control("보기", by),
    show,
    prune,
  );
  $("adminReport").replaceChildren(bar, output);
  return draw();
}

/** 활동량 관리 (adm/action_list.php): counts per member, warnings editable. */
async function activityView() {
  const boards = await all("neo_avocado_boards");
  const board = document.createElement("select");
  board.append(
    new Option("모든 게시판", ""),
    new Option("로그 (기본)", "default"),
    ...boards
      .filter((row) => row.id !== "default")
      .map((row) => new Option(row.data.name, row.id)),
  );
  const from = dateInput(daysAgo(29));
  const to = dateInput(today());
  const show = document.createElement("button");
  show.type = "button";
  show.textContent = "보기";
  const output = document.createElement("div");
  const draw = async () => {
    const [profiles, members, characters, logs, comments, presence] =
      await Promise.all([
        all("neo_avocado_profiles"),
        all("neo_avocado_members"),
        all("neo_avocado_characters"),
        all("neo_avocado_logs"),
        all("neo_avocado_comments"),
        all("neo_avocado_presence"),
      ]);
    const rows = activityReport(
      { profiles, members, characters, logs, comments, presence },
      { board: board.value, from: from.value, to: to.value },
    );
    output.replaceChildren(
      table(
        [
          "닉네임",
          "대표 캐릭터",
          "로그",
          "댓글",
          "최종 접속",
          "누적 경고",
          "경고 내용",
          "",
        ],
        rows.map((row) => {
          const warnings = document.createElement("input");
          warnings.type = "number";
          warnings.min = "0";
          warnings.value = String(row.warnings);
          const note = document.createElement("input");
          note.maxLength = 1000;
          note.value = row.warningNote;
          const save = document.createElement("button");
          save.type = "button";
          save.textContent = "저장";
          save.onclick = () =>
            run(async () => {
              const count = Number(warnings.value);
              if (!Number.isSafeInteger(count) || count < 0)
                throw new Error("누적 경고는 0 이상의 정수입니다.");
              await owner.collection("neo_avocado_members").set(
                row.id,
                {
                  role: "member",
                  ...row.member?.data,
                  warnings: count,
                  warningNote: note.value.trim(),
                },
                row.member
                  ? { condition: { revision: row.member.revision } }
                  : { condition: { absent: true } },
              );
              $("adminStatus").textContent =
                `${row.nick}의 경고를 저장했습니다.`;
              await draw();
            });
          return [
            row.nick,
            row.mainCharacter,
            row.logs,
            row.comments,
            row.lastSeen ? new Date(row.lastSeen).toLocaleString("ko-KR") : "",
            warnings,
            note,
            save,
          ];
        }),
      ),
    );
  };
  show.onclick = () => run(draw);
  const bar = document.createElement("div");
  bar.className = "report-filters";
  bar.append(
    control("게시판", board),
    control("시작일", from),
    control("종료일", to),
    show,
  );
  $("adminReport").replaceChildren(bar, output);
  return draw();
}
