export function normalizeArabic(value) {
  return value
    .normalize("NFKC")
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/gu, "")
    .replace(/\u0640/gu, "")
    .replace(/[\u0622\u0623\u0625\u0671]/gu, "\u0627")
    .replace(/\u0649/gu, "\u064a")
    .replace(/[^\p{Script=Arabic}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function levenshtein(left, right) {
  let previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (
      let rightIndex = 1;
      rightIndex <= right.length;
      rightIndex += 1
    ) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

export function measureCharacterError(expected, recognized) {
  const normalizedExpected = normalizeArabic(expected);
  const normalizedRecognized = normalizeArabic(recognized);
  const expectedCharacters = Array.from(normalizedExpected);
  const recognizedCharacters = Array.from(normalizedRecognized);
  const characterErrors = levenshtein(
    expectedCharacters,
    recognizedCharacters,
  );
  return {
    normalizedExpected,
    normalizedRecognized,
    expectedCharacterCount: expectedCharacters.length,
    recognizedCharacterCount: recognizedCharacters.length,
    recognizedNonWhitespaceCharacterCount: Array.from(
      normalizedRecognized.replace(/\s/gu, ""),
    ).length,
    characterErrors,
    characterErrorRate:
      characterErrors / Math.max(1, expectedCharacters.length),
  };
}

export function round(value) {
  return Math.round(value * 10_000) / 10_000;
}
