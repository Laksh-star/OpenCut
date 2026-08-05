export type ByteRange = { start: number; end: number };

export const parseByteRange = (value: string | undefined, size: number): ByteRange | null => {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || size <= 0) throw new Error("Invalid byte range");
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) throw new Error("Invalid byte range");
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw new Error("Invalid byte range");
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    throw new Error("Range is outside the media asset");
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
};
