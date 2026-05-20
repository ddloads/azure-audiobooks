const htmlEntityPattern = /&(?:#\d+|#x[\da-f]+|[a-z]+);/i;

const decodeHtmlEntities = (value: string) => {
  if (!htmlEntityPattern.test(value) || typeof document === "undefined") {
    return value;
  }

  const textarea = document.createElement("textarea");
  let decoded = value;

  for (let i = 0; i < 2 && htmlEntityPattern.test(decoded); i += 1) {
    textarea.innerHTML = decoded;
    const next = textarea.value;
    if (next === decoded) break;
    decoded = next;
  }

  return decoded;
};

export const formatBookDescription = (description?: string | null) => {
  if (!description) return "";

  const decodedDescription = decodeHtmlEntities(description);

  return decodeHtmlEntities(
    decodedDescription
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
};
