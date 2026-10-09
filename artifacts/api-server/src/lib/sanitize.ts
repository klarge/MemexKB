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
      div: ["data-title", "data-rows", "data-image"],
      a: ["href", "target", "rel", "id", "aria-label"],
      sup: ["data-citation-id", "data-citation-description", "data-citation-url", "data-citation-number"],
      li: ["id"],
      ol: ["type", "start", "data-list-style"],
      img: ["src", "alt", "title", "width", "height", "style", "data-caption", "data-diagram"],
      th: ["colspan", "rowspan", "colwidth"],
      td: ["colspan", "rowspan", "style"],
      p: ["style"],
      h1: ["style"], h2: ["style"], h3: ["style"],
      h4: ["style"], h5: ["style"], h6: ["style"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^(left|center|right|justify)$/],
      },
      img: {
        "max-width": [/^\d+(%|px|rem|em)$/],
        "max-height": [/^\d+(%|px|rem|em)$/],
        "object-fit": [/^(contain|cover|fill|none|scale-down)$/],
      },
      td: {
        "padding": [/^[\d.\s]+(px|rem|em|%)(\s[\d.\s]+(px|rem|em|%))*$/],
      },
    },
    disallowedTagsMode: "discard",
    transformTags: {
      img: (tagName, attribs) => {
        if (attribs["data-diagram"] !== "drawio") delete attribs["data-diagram"];
        return { tagName, attribs };
      },
      ol: (tagName, attribs) => {
        if (attribs.type && !["1", "a", "A", "i", "I"].includes(attribs.type)) delete attribs.type;
        if (attribs["data-list-style"] !== attribs.type) delete attribs["data-list-style"];
        if (attribs.start && !/^-?\d+$/.test(attribs.start)) delete attribs.start;
        return { tagName, attribs };
      },
      a: (tagName, attribs) => {
        if (attribs.id && !/^cite-ref-c-[a-zA-Z0-9-]{1,64}$/.test(attribs.id)) delete attribs.id;
        return { tagName, attribs };
      },
      li: (tagName, attribs) => {
        if (attribs.id && !/^cite-source-[1-9][0-9]*$/.test(attribs.id)) delete attribs.id;
        return { tagName, attribs };
      },
      sup: (tagName, attribs) => {
        const url = attribs["data-citation-url"];
        if (url) {
          try {
            if (!["http:", "https:"].includes(new URL(url).protocol) || /[\u0000-\u0020]/.test(url)) delete attribs["data-citation-url"];
          } catch { delete attribs["data-citation-url"]; }
        }
        return { tagName, attribs };
      },
    },
  });
}
