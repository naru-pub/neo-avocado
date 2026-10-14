// Loads scripts/avocado-import.mjs output with the owner's handle. Naru has no
// import API, so documents go in ordinary atomic batches; each is created only
// if absent, and documents already present are skipped, so an interrupted
// import is resumed by loading the same file again.
import { scopes } from "./admin-model.js";

export const IMPORT_BATCH = 25;

/** The documents of an import file, checked before anything is written. */
export function importDocuments(file) {
  if (file?.format !== "neo-avocado-import" || file.version !== 1)
    throw new Error("neo-avocado 가져오기 파일이 아닙니다.");
  const seen = new Set();
  for (const entry of file.documents ?? []) {
    if (
      !scopes.includes(entry.collection) ||
      typeof entry.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id) ||
      !entry.data ||
      typeof entry.data !== "object"
    )
      throw new Error(`가져올 수 없는 문서: ${entry.collection}/${entry.id}`);
    const key = `${entry.collection}/${entry.id}`;
    if (seen.has(key)) throw new Error(`중복된 문서: ${key}`);
    seen.add(key);
  }
  return file.documents ?? [];
}

/** Writes absent documents in order; reports progress after each batch. */
export async function runImport(owner, documents, onProgress = () => {}) {
  let written = 0;
  let skipped = 0;
  for (let start = 0; start < documents.length; start += IMPORT_BATCH) {
    const chunk = documents.slice(start, start + IMPORT_BATCH);
    const present = new Set();
    const byCollection = new Map();
    for (const entry of chunk)
      byCollection.set(entry.collection, [
        ...(byCollection.get(entry.collection) ?? []),
        entry.id,
      ]);
    for (const [collection, ids] of byCollection) {
      const found = await owner.collection(collection).getMany(ids);
      found.forEach((row, index) => {
        if (row) present.add(`${collection}/${ids[index]}`);
      });
    }
    const writes = chunk
      .filter((entry) => !present.has(`${entry.collection}/${entry.id}`))
      .map((entry) => ({
        collection: entry.collection,
        set: { id: entry.id, data: entry.data, condition: { absent: true } },
      }));
    if (writes.length) await owner.batch(writes);
    written += writes.length;
    skipped += chunk.length - writes.length;
    onProgress({ written, skipped, total: documents.length });
  }
  return { written, skipped };
}
