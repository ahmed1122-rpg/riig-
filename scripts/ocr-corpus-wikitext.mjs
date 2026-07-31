export function cleanProofreadWikitext(value) {
  const footnotes = [];
  let text = String(value).replace(
    /<noinclude>[\s\S]*?<\/noinclude>/gu,
    "\n",
  );
  text = text.replace(
    /<ref\b[^>]*>([\s\S]*?)<\/ref>/giu,
    (_match, body) => {
      footnotes.push(body);
      return " ";
    },
  );
  for (
    let index = 0;
    index < 12 && /\{\{حا\|[^{}]*\}\}/u.test(text);
    index += 1
  ) {
    text = text.replace(/\{\{حا\|([^{}]*)\}\}/gu, (_match, body) => {
      footnotes.push(body);
      return " ";
    });
  }

  const mainText = cleanWikitextFragment(text);
  const footnoteText = footnotes
    .map((footnote) => cleanWikitextFragment(footnote))
    .filter(Boolean);
  return footnoteText.length > 0
    ? `${mainText}\n\n${footnoteText.join("\n")}`
    : mainText;
}

function cleanWikitextFragment(value) {
  let text = String(value)
    .replace(/<noinclude>[\s\S]*?<\/noinclude>/gu, "\n")
    .replace(/<section\b[^>]*\/>/gu, "\n")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gu, " ")
    .replace(/<ref\b[^>]*\/>/gu, " ")
    .replace(/<references\b[^>]*\/>/gu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/\[\[(?:ملف|صورة|File|Image):[^\]]+\]\]/giu, " ")
    .replace(/\\\\/gu, "\n");

  for (
    let index = 0;
    index < 12 && /\{\{[^{}]*\}\}/u.test(text);
    index += 1
  ) {
    text = text.replace(/\{\{([^{}]*)\}\}/gu, (_match, body) => {
      const fields = String(body).split("|");
      const templateName = fields.shift()?.trim();
      if (templateName === "ربط بصفحة") {
        return fields.at(-1) ?? " ";
      }
      if (templateName === "سطر") return " ";
      return fields.length > 1
        ? fields
            .filter(
              (field) => !/^[^=]{1,40}=/u.test(field.trim()),
            )
            .join(" ")
        : (fields[0] ?? " ");
    });
  }

  text = text
    .replace(/\[\[[^|\]]+\|([^\]]+)\]\]/gu, (_match, label) =>
      String(label).split("|").at(-1),
    )
    .replace(/\[\[([^\]]+)\]\]/gu, "$1")
    .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]+)\]/gu, "$1")
    .replace(/'{2,5}/gu, "")
    .replace(/<[^>]+>/gu, " ");

  const lines = [];
  for (const sourceLine of text.split(/\r?\n/gu)) {
    const trimmed = sourceLine.trim();
    if (trimmed === "" || /^\{\||^\|\}|^\|-|^\|\+/u.test(trimmed)) {
      if (trimmed === "" && lines.at(-1) !== "") lines.push("");
      continue;
    }
    let line = trimmed;
    if (/^[|!]/u.test(line)) line = line.slice(1);
    line = line
      .replace(
        /\s+(?:rowspan|colspan|style|class)="[^"]*"\s*\|/giu,
        " ",
      )
      .replace(/\|\||!!/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (line) lines.push(line);
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
