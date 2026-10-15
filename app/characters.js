// Characters: the list, profile fields, relations, outfits and stats.

import {
  $,
  allDocuments,
  caller,
  CHARACTER_PAGE,
  COLLECTION,
  communityCollection,
  edit,
  mine,
  nickOf,
  preloadNicks,
  run,
  say,
  show,
  showTab,
  state,
  STATE_NAMES,
  TYPE_NAMES,
  uploadManaged,
} from "./core.js";

const CHARACTER_FILTERS = {
  // member/ready.php: characters not yet approved, in either state.
  applicants: { in: ["state", ["editing", "submitted"]] },
  approved: { eq: ["state", "approved"] },
};
export async function loadCharacters({ more = false } = {}) {
  const where = CHARACTER_FILTERS[$("characterFilter").value];
  const [, page] = await Promise.all([
    loadFieldCatalogue(),
    communityCollection(COLLECTION.characters).list({
      sort: [[{ metadata: "createdAt" }, "desc"]],
      size: CHARACTER_PAGE,
      after: more ? state.characterCursor : null,
      ...(where ? { where } : {}),
    }),
  ]);
  await preloadNicks(page.documents);
  if (!more) $("characters").replaceChildren();
  for (const character of page.documents)
    $("characters").append(await characterItem(character));
  state.characterCursor = page.nextCursor;
  state.charactersLoaded = true;
  $("moreCharacters").hidden = !page.nextCursor;
}
/** The owner's custom profile fields (adm/character_article_list.php), read once. */
async function loadFieldCatalogue() {
  if (state.fieldCatalogue) return state.fieldCatalogue;
  const member = state.member;
  const rows = (await allDocuments(COLLECTION.characterFields))
    .filter((row) => /^[a-z][a-z0-9_]{0,31}$/.test(row.id))
    .sort(
      (a, b) =>
        (a.data.order ?? 0) - (b.data.order ?? 0) || (a.id < b.id ? -1 : 1),
    );
  if (state.member !== member) return [];
  state.fieldCatalogue = rows;
  $("characterFields").replaceChildren(
    ...rows.flatMap((row) => {
      const [label, input] = fieldInput(row, "");
      input.dataset.field = row.id;
      label.append(input);
      if (row.data.type !== "image") return [label];
      const upload = document.createElement("label");
      upload.textContent = `${row.data.label ?? row.id} 파일 올리기`;
      const file = document.createElement("input");
      file.type = "file";
      file.accept = "image/*";
      file.dataset.fieldUpload = row.id;
      upload.append(file);
      return [label, upload];
    }),
  );
  return rows;
}
/** A label and control for one custom field definition. */
function fieldInput(row, value) {
  const label = document.createElement("label");
  label.textContent = `${row.data.label ?? row.id}${row.data.required ? " (신청 시 필수)" : ""}${row.data.visibility === "owner" ? " · 오너와 운영자만 봄" : ""}`;
  if (row.data.help) label.title = row.data.help;
  const type = row.data.type ?? "text";
  const input = document.createElement(
    type === "select" ? "select" : type === "textarea" ? "textarea" : "input",
  );
  if (type === "select")
    for (const option of ["", ...(row.data.options ?? [])]) {
      const element = document.createElement("option");
      element.value = option;
      element.textContent = option || "선택 안 함";
      input.append(element);
    }
  else {
    input.maxLength = type === "textarea" ? 2000 : type === "text" ? 200 : 2000;
    if (type === "url" || type === "image") input.type = "url";
    if (type === "image" || type === "url") input.placeholder = "https://";
  }
  input.value = value ?? "";
  return [label, input];
}
/** Custom values of a character the characters rule let the caller see, in catalogue order. */
function renderFields(list, character) {
  list.replaceChildren();
  for (const row of state.fieldCatalogue ?? []) {
    const value = character.data.fields?.[row.id];
    if (typeof value !== "string" || !value) continue;
    const term = document.createElement("dt");
    term.textContent = row.data.label ?? row.id;
    const detail = document.createElement("dd");
    if (row.data.type === "image" && value.startsWith("https://")) {
      const image = document.createElement("img");
      image.src = value;
      image.alt = row.data.label ?? row.id;
      image.loading = "lazy";
      image.className = "field-image";
      detail.append(image);
    } else if (row.data.type === "url" && value.startsWith("https://")) {
      const link = document.createElement("a");
      link.href = value;
      link.textContent = value;
      link.rel = "noopener noreferrer";
      detail.append(link);
    } else detail.textContent = value;
    list.append(term, detail);
  }
}
async function characterItem(character) {
  const item = $("characterTemplate").content.firstElementChild.cloneNode(true);
  const image = item.querySelector(".character-image");
  if (character.data.image) image.src = character.data.image;
  else image.remove();
  item.querySelector(".character-name").textContent = character.data.name;
  item.querySelector(".character-side").textContent = character.data.side ?? "";
  item.querySelector(".character-state").textContent = [
    TYPE_NAMES[character.data.type],
    STATE_NAMES[character.data.state],
  ]
    .filter(Boolean)
    .join(" · ");
  item.querySelector(".character-profile").textContent =
    character.data.profile ?? "";
  item.querySelector(".author").textContent =
    `오너: ${await nickOf(character.createdBy ?? character.data.owner)}`;
  const remove = item.querySelector(".delete");
  remove.hidden = !mine(character);
  const change = item.querySelector(".edit");
  change.hidden = !mine(character);
  // Lists carry no custom values, so an edit starts from the full sheet.
  change.onclick = () =>
    run(async () => {
      const catalogue = await loadFieldCatalogue();
      const current = await communityCollection(COLLECTION.characters).get(
        character.id,
      );
      const fields = [
        {
          name: "name",
          label: "이름",
          value: current.data.name,
          required: true,
          max: 40,
        },
        { name: "side", label: "소속", value: current.data.side, max: 40 },
        {
          name: "profile",
          label: "프로필",
          value: current.data.profile,
          multiline: true,
          max: 4000,
        },
      ];
      if (current.data.type !== "npc")
        fields.push({
          name: "type",
          label: "종류",
          value: current.data.type ?? "main",
          options: [
            ["main", "메인"],
            ["sub", "서브"],
          ],
        });
      if (current.data.state !== "approved")
        fields.push({
          name: "state",
          label: "상태",
          value: current.data.state ?? "editing",
          options: [
            ["editing", "수정 중"],
            ["submitted", "신청 (수정 완료)"],
          ],
        });
      for (const row of catalogue) {
        if (row.data.type === "image")
          fields.push({
            name: `upload:${row.id}`,
            label: `${row.data.label ?? row.id} 파일 올리기 (선택)`,
            type: "file",
            accept: "image/*",
          });
        fields.push({
          name: `field:${row.id}`,
          label: `${row.data.label ?? row.id}${row.data.required ? " (신청 시 필수)" : ""}`,
          value: current.data.fields?.[row.id] ?? "",
          ...(row.data.type === "select"
            ? {
                options: [
                  ["", "선택 안 함"],
                  ...(row.data.options ?? []).map((option) => [option, option]),
                ],
              }
            : row.data.type === "textarea"
              ? { multiline: true, max: 2000 }
              : { max: row.data.type === "text" ? 200 : 2000 }),
        });
      }
      edit("캐릭터 수정", fields, async (values) => {
        if (!values.name) throw new Error("이름을 입력해 주세요.");
        const data = { ...current.data, fields: {} };
        delete data.fieldMedia;
        for (const [name, value] of Object.entries(values))
          if (name.startsWith("field:")) {
            if (value) data.fields[name.slice(6)] = value;
          } else if (!name.startsWith("upload:")) data[name] = value;
        // An uploaded file replaces the field's address with its own.
        for (const [name, file] of Object.entries(values))
          if (name.startsWith("upload:") && file) {
            const uploaded = await uploadManaged(file);
            data.fields[name.slice(7)] = uploaded.url;
          }
        const saved = await communityCollection(COLLECTION.characters).set(
          character.id,
          data,
          { condition: { revision: current.revision } },
        );
        state.speakers = null;
        item.replaceWith(await characterItem(saved));
      });
    });
  remove.onclick = () =>
    run(async () => {
      if (!confirm(`${character.data.name}을(를) 지울까요?`)) return;
      await communityCollection(COLLECTION.characters).delete(character.id);
      state.speakers = null;
      item.remove();
    });
  const main = item.querySelector(".main-character");
  main.hidden = !mine(character);
  main.onclick = () =>
    run(async () => {
      const result = await caller().call("characters/profile:mainCharacter", {
        character: character.id,
      });
      show(result.document);
      say(`${character.data.name}이(가) 대표 캐릭터입니다.`);
    });
  wireCharacterDetails(item, character);
  return item;
}
// Which functions only read is declared in their modules (readOnly), so Naru
// gives them the read budget; the page calls them all the same way.
function wireCharacterDetails(item, character) {
  const details = item.querySelector(".character-details");
  const addRelation = item.querySelector(".add-relation");
  const addOutfit = item.querySelector(".add-outfit");
  const defaultOutfit = item.querySelector(".default-outfit");
  const allocate = item.querySelector(".allocate-stats");
  for (const button of [addRelation, addOutfit, defaultOutfit])
    button.hidden = !mine(character);
  let loaded = false;
  const refresh = async () => {
    await loadFieldCatalogue();
    if (state.fieldCatalogue.length)
      renderFields(
        item.querySelector(".character-fields"),
        await communityCollection(COLLECTION.characters).get(character.id),
      );
    const status = await caller().call(
      "characters/progression:characterStatus",
      {
        character: character.id,
      },
    );
    item.querySelector(".progression").textContent =
      `경험치 ${status.state.exp}${status.rank ? ` · ${status.rank}` : ""} · 능력치 포인트 ${status.state.points}`;
    item.querySelector(".stats").replaceChildren();
    for (const definition of status.definitions) {
      const li = document.createElement("li");
      const stat = status.state.stats[definition.id];
      li.textContent = `${definition.data.name ?? definition.id}: ${stat.current} / ${stat.max}`;
      item.querySelector(".stats").append(li);
    }
    allocate.hidden = !mine(character) || !status.definitions.length;
    allocate.onclick = () =>
      edit(
        "능력치 포인트 배분",
        status.definitions.map((definition) => ({
          name: definition.id,
          label: `${definition.data.name ?? definition.id}에 배분할 포인트`,
          type: "number",
          value: status.state.stats[definition.id].allocated,
        })),
        async (allocation) => {
          await caller().call("characters/progression:allocateStats", {
            character: character.id,
            revision: status.revision,
            allocation: Object.fromEntries(
              Object.entries(allocation).map(([key, value]) => [
                key,
                Number(value),
              ]),
            ),
          });
          await refresh();
        },
      );
    // Only the character's titles are read (at most 100 per query).
    const owned = [...new Set(status.state.titles ?? [])];
    const titles = [];
    for (let i = 0; i < owned.length; i += 100)
      titles.push(
        ...(await allDocuments(COLLECTION.titles, undefined, {
          in: [{ metadata: "id" }, owned.slice(i, i + 100)],
        })),
      );
    const titleChoice = item.querySelector(".title-choice");
    item.querySelector(".titles").replaceChildren();
    titleChoice.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "타이틀 없음";
    titleChoice.append(none);
    for (const title of titles) {
      const span = document.createElement("span");
      span.textContent = `${title.data.name}${status.state.activeTitle === title.id ? " (표시 중)" : ""}`;
      if (title.data.image?.startsWith("https://")) {
        const image = document.createElement("img");
        image.src = title.data.image;
        image.alt = title.data.name;
        image.className = "title-image";
        span.prepend(image);
      }
      item.querySelector(".titles").append(span, " ");
      const option = document.createElement("option");
      option.value = title.id;
      option.textContent = title.data.name;
      titleChoice.append(option);
    }
    titleChoice.value = status.state.activeTitle ?? "";
    titleChoice.hidden = !mine(character) || !titles.length;
    titleChoice.onchange = () =>
      run(async () => {
        await caller().call("characters/progression:equipTitle", {
          character: character.id,
          title: titleChoice.value || null,
        });
        await refresh();
      });
    const couples = await allDocuments(COLLECTION.couples, undefined, {
      any: [{ eq: ["first", character.id] }, { eq: ["second", character.id] }],
    });
    item.querySelector(".couples").replaceChildren();
    for (const couple of couples.sort(
      (a, b) => (a.data.order ?? 0) - (b.data.order ?? 0),
    )) {
      const partnerId =
        couple.data.first === character.id
          ? couple.data.second
          : couple.data.first;
      const partner = await communityCollection(COLLECTION.characters)
        .get(partnerId)
        .catch((error) => {
          if (error.code === "NOT_FOUND") return null;
          throw error;
        });
      const li = document.createElement("li");
      li.textContent = `${partner?.data.name ?? "삭제된 캐릭터"}${couple.data.since ? ` · ${couple.data.since}부터` : ""}`;
      item.querySelector(".couples").append(li);
    }
    const relations = await allDocuments(COLLECTION.relations, {
      character: character.id,
    });
    const clothes = await allDocuments(COLLECTION.wardrobe, {
      character: character.id,
    });
    item.querySelector(".relations").replaceChildren();
    for (const row of relations.sort((a, b) => a.data.order - b.data.order)) {
      const li = document.createElement("li");
      const target = await communityCollection(COLLECTION.characters)
        .get(row.data.target)
        .catch((error) => {
          if (error.code === "NOT_FOUND") return null;
          throw error;
        });
      li.textContent = `${target?.data.name ?? "삭제된 캐릭터"} · 호감도 ${row.data.affinity}: ${row.data.memo}`;
      if (row.data.link && row.data.link.startsWith("https://")) {
        const link = document.createElement("a");
        link.href = row.data.link;
        link.textContent = "관계 링크";
        link.rel = "noopener noreferrer";
        li.append(" ", link);
      }
      if (mine(character)) {
        const change = document.createElement("button");
        change.type = "button";
        change.textContent = "수정";
        change.onclick = () => relationEditor(row);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.onclick = () =>
          run(async () => {
            if (!confirm("이 관계를 지울까요?")) return;
            await caller().call("characters/relations:removeRelation", {
              id: row.id,
            });
            await refresh();
          });
        li.append(" ", change, " ", remove);
      }
      item.querySelector(".relations").append(li);
    }
    item.querySelector(".wardrobe").replaceChildren();
    for (const clothing of clothes) {
      const li = document.createElement("li");
      const image = document.createElement("img");
      image.src = clothing.data.image;
      image.alt = clothing.data.name;
      image.className = "outfit-image";
      li.append(image, clothing.data.name);
      if (mine(character)) {
        const wear = document.createElement("button");
        wear.type = "button";
        wear.textContent =
          character.data.outfit === clothing.id ? "사용 중" : "사용";
        wear.disabled = character.data.outfit === clothing.id;
        wear.onclick = () =>
          run(async () => {
            const result = await caller().call("characters/wardrobe:wear", {
              character: character.id,
              outfit: clothing.id,
            });
            character = result.document;
            await refresh();
          });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.onclick = () =>
          run(async () => {
            if (!confirm("이 의상을 지울까요?")) return;
            await caller().call("characters/wardrobe:removeOutfit", {
              id: clothing.id,
            });
            await refresh();
          });
        li.append(" ", wear, " ", remove);
      }
      item.querySelector(".wardrobe").append(li);
    }
    const active = clothes.find((row) => row.id === character.data.outfit);
    let portrait = item.querySelector(".character-image");
    const src = active?.data.image ?? character.data.image;
    if (src && !portrait) {
      portrait = document.createElement("img");
      portrait.className = "character-image";
      portrait.alt = character.data.name;
      item.prepend(portrait);
    }
    if (portrait && src) portrait.src = src;
    else if (portrait) portrait.remove();
    loaded = true;
  };
  const relationEditor = (row) =>
    run(async () => {
      const characters = await allDocuments(COLLECTION.characters);
      const options = characters
        .filter((target) => target.id !== character.id)
        .map((target) => [target.id, target.data.name]);
      if (!options.length) return say("관계를 맺을 다른 캐릭터가 없습니다.");
      edit(
        "캐릭터 관계",
        [
          {
            name: "target",
            label: "상대 캐릭터",
            value: row?.data.target ?? options[0][0],
            required: true,
            options,
          },
          {
            name: "affinity",
            label: "호감도 (-100 ~ 100)",
            value: row?.data.affinity ?? 0,
            type: "number",
          },
          {
            name: "memo",
            label: "관계 설명",
            value: row?.data.memo,
            multiline: true,
            max: 2000,
          },
          {
            name: "link",
            label: "관계 링크 (HTTPS)",
            value: row?.data.link,
            max: 2000,
          },
          {
            name: "order",
            label: "정렬 순서",
            value: row?.data.order ?? 0,
            type: "number",
          },
        ],
        async (data) => {
          await caller().call("characters/relations:relation", {
            ...data,
            ...(row ? { id: row.id, revision: row.revision } : {}),
            character: character.id,
            affinity: Number(data.affinity),
            order: Number(data.order),
          });
          await refresh();
        },
      );
    });
  addRelation.onclick = () => relationEditor();
  addOutfit.onclick = () =>
    edit(
      "의상 등록",
      [
        { name: "name", label: "의상 이름", required: true, max: 80 },
        { name: "image", label: "이미지 주소 (HTTPS)", max: 2000 },
        {
          name: "file",
          label: "또는 이미지 파일",
          type: "file",
          accept: "image/*",
        },
      ],
      async ({ name, image, file }) => {
        const uploaded = file ? await uploadManaged(file) : null;
        if (uploaded) image = uploaded.url;
        await caller().call("characters/wardrobe:outfit", {
          character: character.id,
          name,
          image,
        });
        await refresh();
      },
    );
  defaultOutfit.onclick = () =>
    run(async () => {
      const result = await caller().call("characters/wardrobe:wear", {
        character: character.id,
        outfit: null,
      });
      character = result.document;
      await refresh();
    });
  details.ontoggle = () => {
    if (details.open && !loaded) run(refresh);
  };
  if (character.data.outfit)
    run(async () => {
      const clothing = await communityCollection(COLLECTION.wardrobe).get(
        character.data.outfit,
      );
      if (clothing.data.character === character.id) {
        let portrait = item.querySelector(".character-image");
        if (!portrait) {
          portrait = document.createElement("img");
          portrait.className = "character-image";
          portrait.alt = character.data.name;
          item.prepend(portrait);
        }
        portrait.src = clothing.data.image;
      }
    });
}
$("tabCharacters").onclick = () =>
  run(async () => {
    showTab("characters");
    if (!state.charactersLoaded) await loadCharacters();
  });
$("moreCharacters").onclick = () => run(() => loadCharacters({ more: true }));
$("characterFilter").onchange = () => run(() => loadCharacters());
$("characterForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const name = $("characterName").value.trim();
    if (!name) return;
    const file = $("characterImage").files?.[0];
    const uploaded = file ? await uploadManaged(file) : null;
    const image = uploaded?.url ?? null;
    const fields = Object.fromEntries(
      [...$("characterFields").querySelectorAll("[data-field]")]
        .map((input) => [input.dataset.field, input.value.trim()])
        .filter(([, value]) => value),
    );
    for (const input of $("characterFields").querySelectorAll(
      "[data-field-upload]",
    )) {
      const chosen = input.files?.[0];
      if (!chosen) continue;
      const uploaded = await uploadManaged(chosen);
      fields[input.dataset.fieldUpload] = uploaded.url;
    }
    const character = await communityCollection(COLLECTION.characters).add({
      name,
      side: $("characterSide").value.trim(),
      profile: $("characterProfile").value.trim(),
      image,
      type: $("characterType").value,
      state: $("characterState").value,
      ...(Object.keys(fields).length ? { fields } : {}),
    });
    state.speakers = null;
    $("characters").prepend(await characterItem(character));
    $("characterForm").reset?.();
    say(`${name}을(를) 등록했습니다.`);
  });
};
