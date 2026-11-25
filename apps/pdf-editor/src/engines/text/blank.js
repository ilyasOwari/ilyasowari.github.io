// Text a reader would not see: whitespace, zero-width / format characters,
// replacement or private-use placeholders (e.g. a Symbol-font list mark with no
// usable Unicode) and empty-box "tofu" squares. Such a group must not become an
// editor cell or column of its own.
const INVISIBLE = /[\s\u00AD\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFFC\uFFFD\uE000-\uF8FF\u25A1\u25AF]/g;
export const isBlankText = (t) => !String(t || '').replace(INVISIBLE, '').length;
