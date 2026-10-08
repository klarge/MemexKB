"""Check and rasterize the isolated HTML-to-PDF regression fixture."""
import re
import sys
from pathlib import Path
import fitz

source = Path(sys.argv[1])
document = fitz.open(source)
assert len(document) >= 2, "Long articles must paginate."
text = "\n".join(page.get_text() for page in document)
for phrase in [
    "Headings and lists", "Alphabetic nested item", "Roman nested item",
    "Summary", "Example team", "Attached image and caption",
    "foreign private image", "external image", "Preserve the procedure",
    "Reference title", "readable wikilink",
]:
    assert phrase in text, f"Missing formatted content: {phrase}"
assert "[[related" not in text, "Wikilinks must render their visible label."
assert "```" not in text, "Code must render HTML, not Markdown markers."
for index in range(1, 26):
    assert f"Full-width paragraph {index}:" in text

spans = []
full_width_lines = []
for page in document:
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            spans.extend(line["spans"])
            value = "".join(span["text"] for span in line["spans"])
            if value.startswith("Full-width paragraph"):
                full_width_lines.append(line["bbox"])
assert full_width_lines
assert all(box[0] < 60 for box in full_width_lines), "Paragraphs inherited an infobox's right-hand x position."
assert all(box[2] - box[0] > 350 for box in full_width_lines), "Paragraphs were squeezed into a narrow column."
# Chromium can embed variable fonts as Type3 subsets rather than named
# bold/italic fonts. Distinct font resources verify the actual styled runs.
normal = next(span["font"] for span in spans if "Introductory paragraph" in span["text"])
bold = next(span["font"] for span in spans if span["text"] == "bold text")
italic = next(span["font"] for span in spans if span["text"] == "italic text")
code = next(span["font"] for span in spans if "const example" in span["text"])
assert len({normal, bold, italic}) == 3, "Bold or italic styling was flattened."
assert code != normal, "Code lost its distinct monospace font."
assert "Introductory paragraph" in document[0].get_text(), "A spurious page break separated the title from the content."
assert any(page.get_images() for page in document), "Attached images were not embedded."
for page_index in sorted({0, len(document) - 1}):
    document[page_index].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(
        str(source.parent / f"page-{page_index + 1}.png")
    )
print(f"PDF visual assertions passed: {len(document)} pages; paragraphs use full width; bold, italic, code, images and captions preserved.")
