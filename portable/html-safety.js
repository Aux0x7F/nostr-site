const DROP_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "textarea",
  "select",
  "button",
  "link",
  "meta"
]);

const ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul"
]);

const ATTRIBUTE_ALLOWLIST = Object.freeze({
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title", "loading"]),
  code: new Set(["class"]),
  pre: new Set(["class"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"])
});

const CLASS_ALLOWLIST = Object.freeze({
  code: /^language-[a-z0-9_-]+$/i,
  pre: /^language-[a-z0-9_-]+$/i
});

export function sanitizeUrl(rawValue, mode = "href") {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (/^\/\//.test(value)) return "";
  if (/^#/.test(value)) return value;
  if (/^(?:\.\/|\.\.\/|\/)/.test(value)) return value;

  try {
    const url = new URL(value, window.location.origin);
    const protocol = String(url.protocol || "").trim().toLowerCase();
    const sameOrigin = url.origin === window.location.origin;
    if (mode === "src") {
      if (protocol === "http:" || protocol === "https:" || protocol === "blob:") return value;
      return sameOrigin && (protocol === "http:" || protocol === "https:") ? value : "";
    }
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:" || protocol === "tel:") return value;
    return sameOrigin && (protocol === "http:" || protocol === "https:") ? value : "";
  } catch {
    return "";
  }
}

export function sanitizeTrustedHtml(rawHtml) {
  if (typeof document === "undefined") return String(rawHtml || "");
  const template = document.createElement("template");
  template.innerHTML = String(rawHtml || "");
  sanitizeChildNodes(template.content);
  return template.innerHTML;
}

function sanitizeChildNodes(parent) {
  for (const node of [...parent.childNodes]) {
    sanitizeNode(node);
  }
}

function sanitizeNode(node) {
  if (!(node instanceof Node)) return;
  if (node.nodeType === Node.COMMENT_NODE) {
    node.remove();
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node;
  const tagName = element.tagName.toLowerCase();

  if (DROP_TAGS.has(tagName)) {
    element.remove();
    return;
  }

  if (!ALLOWED_TAGS.has(tagName)) {
    const children = [...element.childNodes];
    for (const child of children) sanitizeNode(child);
    element.replaceWith(...children);
    return;
  }

  sanitizeAttributes(element, tagName);
  sanitizeChildNodes(element);
}

function sanitizeAttributes(element, tagName) {
  const allowed = ATTRIBUTE_ALLOWLIST[tagName] || new Set();
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on") || name === "style" || (!allowed.has(name) && name !== "class")) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (name === "class") {
      const nextClass = sanitizeClassName(attribute.value, tagName);
      if (nextClass) {
        element.setAttribute("class", nextClass);
      } else {
        element.removeAttribute(attribute.name);
      }
      continue;
    }
    if (name === "href" || name === "src") {
      const safeUrl = sanitizeUrl(attribute.value, name === "src" ? "src" : "href");
      if (!safeUrl) {
        element.removeAttribute(attribute.name);
        continue;
      }
      element.setAttribute(attribute.name, safeUrl);
      continue;
    }
  }

  if (tagName === "a") {
    const href = element.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    } else {
      element.removeAttribute("target");
      element.removeAttribute("rel");
    }
  }

  if (tagName === "img" && !element.getAttribute("loading")) {
    element.setAttribute("loading", "lazy");
  }
}

function sanitizeClassName(value, tagName) {
  const pattern = CLASS_ALLOWLIST[tagName];
  if (!pattern) return "";
  return String(value || "")
    .split(/\s+/)
    .map((part) => String(part || "").trim())
    .filter((part) => pattern.test(part))
    .join(" ");
}
