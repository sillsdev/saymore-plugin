/**
 * Tiny localization seam. No Lingui initially (plan decision): every UI string
 * goes through `t(id, default)` with a stable dotted id so Lingui — or host
 * message-passing when we run inside the lameta plugin iframe — can be retrofitted
 * mechanically later by swapping this implementation.
 *
 * For now `t` just returns the default English text. Do NOT concatenate strings
 * to build messages; pass interpolation values via `vars` so a future
 * message-format backend can reorder them.
 */
export function t(
  _id: string,
  defaultText: string,
  vars?: Record<string, string | number>
): string {
  if (!vars) return defaultText;
  return defaultText.replace(/\{(\w+)\}/g, (whole, key) =>
    key in vars ? String(vars[key]) : whole
  );
}
