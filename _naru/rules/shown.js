// Catalogue rows (items, titles, recipes, emoticons, couples, relations,
// outfits) the admin or a site function has not marked deleted.
export function scope() {
  return { ne: ["deleted", true] };
}

export function canWrite() {
  return false;
}
