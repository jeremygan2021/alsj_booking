export function parseClueCode(value, origin) {
  if (typeof value !== "string" || value.length > 2048) return null;
  const raw = value.trim();
  if (/^E-\d{2}$/i.test(raw)) return raw.toUpperCase();
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || !["/play", "/play/"].includes(url.pathname))
      return null;
    const id = url.searchParams.get("clue");
    return /^E-\d{2}$/i.test(id || "") ? id.toUpperCase() : null;
  } catch {
    return null;
  }
}
let decoder;
export async function decodeQrPixels({ data, width, height }) {
  decoder ||= import("jsqr")
    .then((m) => m.default)
    .catch((error) => {
      decoder = null;
      throw error;
    });
  const jsQR = await decoder;
  return (
    jsQR(data, width, height, { inversionAttempts: "attemptBoth" })?.data ||
    null
  );
}
