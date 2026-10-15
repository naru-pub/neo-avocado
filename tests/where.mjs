// The `where` predicate language of Naru SDK 1.1.0, for the in-memory fakes:
// values match only their own JSON type, a missing field matches only `ne`, and
// ranges compare strings or numbers. contains folds A–Z only, as Naru does;
// toLowerCase folds more, which no test here depends on.
const RANGE = {
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
};
const kind = (value) => (value === null ? "null" : typeof value);
const field = (row, name) =>
  typeof name === "object"
    ? name.metadata === "id"
      ? row.id
      : name.metadata === "createdBy"
        ? (row.createdBy ?? null)
        : undefined
    : Object.hasOwn(row.data, name)
      ? row.data[name]
      : undefined;
const same = (a, b) => a !== undefined && kind(a) === kind(b) && a === b;
export function matches(row, where) {
  if (where === undefined || where === true) return true;
  if (where === false) return false;
  if (where.all) return where.all.every((part) => matches(row, part));
  if (where.any) return where.any.some((part) => matches(row, part));
  const [operator, [name, value]] = Object.entries(where)[0];
  const actual = field(row, name);
  if (operator === "eq") return same(actual, value);
  if (operator === "ne") return !same(actual, value);
  if (operator === "in") return value.some((option) => same(actual, option));
  if (operator === "has")
    return Array.isArray(actual) && actual.some((item) => same(item, value));
  if (operator === "contains")
    return (
      typeof actual === "string" &&
      actual.toLowerCase().includes(value.toLowerCase())
    );
  if (!Object.hasOwn(RANGE, operator))
    throw new Error(`Unknown operator ${operator}`);
  return (
    actual !== undefined &&
    kind(actual) === kind(value) &&
    ["string", "number"].includes(kind(value)) &&
    RANGE[operator](actual, value)
  );
}
