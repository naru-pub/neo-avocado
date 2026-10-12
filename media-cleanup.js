const ASSETS = "neo_avocado_media_assets";

/** Retry only assets atomically claimed as unreferenced by the server. */
export async function retryMemberMedia(member) {
  const page = await member.read("neo-avocado/mediaCleanup");
  if (!page.ok) throw new Error("미디어 정리 목록을 읽지 못했습니다.");
  let completed = 0;
  for (const file of page.files) {
    const claim = await member.call("neo-avocado/claimMedia", { id: file.id });
    if (!claim.ok) continue;
    await member.media.delete(file.id);
    const done = await member.call("neo-avocado/completeMedia", {
      id: file.id,
    });
    if (!done.ok) throw new Error("미디어 정리 기록을 저장하지 못했습니다.");
    completed++;
  }
  return { completed, remaining: Boolean(page.nextCursor) };
}

export async function retryOwnerMedia(owner, id) {
  const handle = owner.collection(ASSETS);
  let file;
  try {
    file = await handle.get(id);
  } catch (error) {
    if (error.code === "NOT_FOUND") return { done: true, processed: 0 };
    throw error;
  }
  if (typeof file.data.owner !== "string" || !file.data.owner)
    throw new Error("파일 업로더 기록을 확인할 수 없습니다.");
  if (file.data.refs.length || (file.data.cleanupAfter ?? 0) > Date.now())
    throw new Error("사용 중인 파일은 정리할 수 없습니다.");
  await owner.batch([
    {
      collection: ASSETS,
      set: {
        id,
        data: { ...file.data, status: "deleting", cleanup: true },
        condition: { revision: file.revision },
      },
    },
  ]);
  await owner.media.delete(id, { uploadedBy: file.data.owner });
  const claimed = await handle.get(id);
  await owner.batch([
    {
      collection: ASSETS,
      delete: { id, condition: { revision: claimed.revision } },
    },
  ]);
  return { done: true, processed: 1 };
}

/** Add ledger changes to the same revision-guarded batch as document removal. */
export async function releaseMediaReferences(owner, documents, operations) {
  const changes = new Map();
  for (const { collection, document } of documents) {
    const id = document.data.imageId;
    if (!id) continue;
    let entry = changes.get(id);
    if (!entry) {
      try {
        entry = await owner.collection(ASSETS).get(id);
      } catch (error) {
        if (error.code === "NOT_FOUND") continue;
        throw error;
      }
      entry = { ...entry, data: { ...entry.data, refs: [...entry.data.refs] } };
      changes.set(id, entry);
    }
    entry.data.refs = entry.data.refs.filter(
      (key) => key !== `${collection}/${document.id}`,
    );
  }
  for (const [id, entry] of changes)
    operations.push({
      collection: ASSETS,
      set: {
        id,
        data: {
          ...entry.data,
          status: entry.data.refs.length ? "active" : "pending",
          cleanup: entry.data.refs.length === 0,
          cleanupAfter: Date.now(),
        },
        condition: { revision: entry.revision },
      },
    });
}

const pendingKey = (member) => `neo-avocado:media:${member.id}`;
export function pendingUploads(member) {
  try {
    const parsed = JSON.parse(localStorage.getItem(pendingKey(member)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (file) =>
            file && typeof file.id === "string" && typeof file.url === "string",
        )
      : [];
  } catch {
    return [];
  }
}
export function rememberUpload(member, file) {
  try {
    localStorage.setItem(
      pendingKey(member),
      JSON.stringify([
        ...pendingUploads(member).filter((old) => old.id !== file.id),
        { id: file.id, url: file.url },
      ]),
    );
  } catch {
    /* Server ledger remains the durable path once registration succeeds. */
  }
}
export function forgetUpload(member, id) {
  try {
    localStorage.setItem(
      pendingKey(member),
      JSON.stringify(pendingUploads(member).filter((file) => file.id !== id)),
    );
  } catch {
    /* Storage can be blocked. */
  }
}
export async function recoverPendingUploads(member) {
  for (const file of pendingUploads(member).slice(0, 5)) {
    const result = await member.call("neo-avocado/registerMedia", file);
    if (!result.ok) throw new Error("미디어 기록을 복구하지 못했습니다.");
    forgetUpload(member, file.id);
  }
}
