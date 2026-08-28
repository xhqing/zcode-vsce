/**
 * Markdown rendering for the webview: marked with a hardened sanitize pass
 * (script/iframe/style stripped, on* attributes removed, links forced to
 * https). Streaming text re-renders through this only on rAF ticks.
 */

import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(markdown: string): string {
  if (!markdown.trim()) return "";
  const html = marked.parse(markdown, { async: false }) as string;
  return sanitize(html);
}

function sanitize(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  scrub(template.content);
  return template.innerHTML;
}

const bannedTags = new Set(["script", "iframe", "object", "embed", "style", "link", "meta", "base", "form"]);

function scrub(node: Node): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as Element;
      if (bannedTags.has(element.tagName.toLowerCase())) {
        element.remove();
        continue;
      }
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on") || name === "srcdoc") {
          element.removeAttribute(attribute.name);
        } else if ((name === "href" || name === "src") && !attribute.value.startsWith("https://")
          && !attribute.value.startsWith("#") && !attribute.value.startsWith("data:image/")) {
          element.setAttribute(attribute.name, "#");
        }
      }
      scrub(element);
    } else if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
    }
  }
}
