import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "ul", "ol", "li",
  "table", "caption", "thead", "tbody", "tr", "th", "td",
  "figure", "figcaption", "hr", "br", "div",
  "a", "strong", "em", "u", "s", "code",
  "mark", "sub", "sup", "span", "img",
];

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowedAttributes: {
      "*": ["class", "data-type", "data-wikilink"],
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      th: ["colspan", "rowspan", "colwidth"],
      td: ["colspan", "rowspan"],
      p: ["style"],
      h1: ["style"], h2: ["style"], h3: ["style"],
      h4: ["style"], h5: ["style"], h6: ["style"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^(left|center|right|justify)$/],
      },
    },
    disallowedTagsMode: "discard",
  });
}
