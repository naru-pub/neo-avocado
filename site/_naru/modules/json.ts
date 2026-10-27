// What the site keeps as JSON: a settings section, a row's options, a
// record an admin form made. Its readers check each field they use.

/** A JSON object, whose fields its reader checks as it reads them. */
// biome-ignore lint/suspicious/noExplicitAny: JSON whose shape its readers check field by field
export type Data = Record<string, any>;
