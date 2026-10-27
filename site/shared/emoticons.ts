/** Replace literal keywords once; HTML-looking text stays plain text. */
export function emoticonParts(text, definitions) {
  const entries = definitions
    .filter((row) => {
      try {
        const url = new URL(row.data.image);
        return (
          typeof row.data.name === "string" &&
          row.data.name.length > 0 &&
          !row.data.deleted &&
          url.protocol === "https:" &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        b.data.name.length - a.data.name.length || a.id.localeCompare(b.id),
    );
  const parts = [];
  let plain = "";
  for (let position = 0; position < text.length; ) {
    const found = entries.find((row) =>
      text.startsWith(row.data.name, position),
    );
    if (!found) {
      plain += text[position++];
      continue;
    }
    if (plain) {
      parts.push({ text: plain });
      plain = "";
    }
    parts.push({ image: found.data.image, keyword: found.data.name });
    position += found.data.name.length;
  }
  if (plain) parts.push({ text: plain });
  return parts;
}
export function emoticonContent(document, text, definitions) {
  const fragment = document.createDocumentFragment();
  for (const part of emoticonParts(text, definitions)) {
    if (part.text !== undefined) fragment.append(part.text);
    else {
      const image = document.createElement("img");
      image.src = part.image;
      image.alt = part.keyword;
      image.title = part.keyword;
      image.className = "emoticon";
      image.loading = "lazy";
      fragment.append(image);
    }
  }
  return fragment;
}
