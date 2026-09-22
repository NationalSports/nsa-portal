// OMG sometimes serializes numeric sizes (for example, shoe sizes) as JSON
// numbers. Normalize to text before applying string cleanup so one numeric row
// cannot abort an entire store import.
export const normalizeOmgSize = (size) => String(size ?? 'OS').trim().replace(/["'″]+$/, '') || 'OS';
