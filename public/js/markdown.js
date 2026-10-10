// Markdown → HTML string for model output (discussions, chat). Ported from
// weatherchat's renderMarkdown. Every text run is escaped before markup is
// added, and links/images only accept http(s) URLs, so the result is safe for
// innerHTML.
//
// It runs on every streamed paint, so it sees half-written text (a table
// header with no separator yet, a bare "## "). Every branch of the line loop
// must consume at least one line; the paragraph fallback guarantees it.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#");

function inline(s) {
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, u) => `<img alt="${alt}" src="${safeUrl(u)}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return s;
}

const cells = (line) => line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

export function renderMarkdown(text) {
  if (!text) return "";
  const code = [];
  text = String(text).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, body) => {
    code.push(body);
    return `\u0001CB${code.length - 1}\u0001`;
  });
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const cb = /^\u0001CB(\d+)\u0001$/.exec(line);
    if (cb) {
      out.push(`<pre><code>${escapeHtml(code[+cb[1]])}</code></pre>`);
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && /^\|.+\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
          "</tbody></table>",
      );
      continue;
    }
    if (/^>\s*/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s*/.test(lines[i])) q.push(lines[i++].replace(/^>\s*/, ""));
      out.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^[-*+]\s+/, ""))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\d+\.\s+/, ""))}</li>`);
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,4}\s+|[-*+]\s+|\d+\.\s+|>|\|.+\|\s*$|---+$|\u0001CB)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    // A line every rule above declined (a table row with no separator yet, a
    // bare "## ") still has to be consumed or the loop never advances.
    if (!para.length) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("");
}
