// Catalogue rows (items, titles, recipes, emoticons, couples, relations,
// outfits) the admin or a site function has not marked deleted.
export function readable() {
  return { ne: ["deleted", true] };
}

export function canWrite() {
  return false;
}

// Until Naru reads `readable`: rules exported `scope` before 1.1.0 named it so.
export const scope = readable;
