/**
 * The name the uploader's file had, for display only. Objects are stored
 * under a random name; this is client-supplied metadata, so it is stripped
 * of path and control characters and capped before anyone sees it.
 */
export const displayFileName = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : null;
};
