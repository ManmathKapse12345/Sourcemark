"""Text extraction from uploads, and splitting guideline documents into citable clauses."""

from __future__ import annotations

import io
import re

from .contract import ExtractedClause

MAX_BYTES = 15 * 1024 * 1024


class ParseError(ValueError):
    pass


def detect_format(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        if not data.startswith(b"%PDF"):
            raise ParseError("The file is not a valid PDF")
        return "pdf"
    if name.endswith(".docx"):
        if not data.startswith(b"PK\x03\x04"):
            raise ParseError("The file is not a valid DOCX")
        return "docx"
    if name.endswith((".txt", ".md")):
        return "txt"
    raise ParseError("Upload a PDF, DOCX, TXT or MD file")


def extract_text(filename: str, data: bytes) -> tuple[str, str, list[str]]:
    """Returns (text, format, warnings). DOCX headings become '# ' lines so clause splitting can use them."""
    if len(data) > MAX_BYTES:
        raise ParseError("The file is too large")
    fmt = detect_format(filename, data)
    warnings: list[str] = []
    if fmt == "txt":
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError as e:
            raise ParseError("Text files must be UTF-8") from e
    elif fmt == "docx":
        import docx

        try:
            doc = docx.Document(io.BytesIO(data))
        except Exception as e:
            raise ParseError("The DOCX file could not be read") from e
        lines = []
        for p in doc.paragraphs:
            t = p.text.strip()
            if not t:
                lines.append("")
                continue
            style = (p.style.name if p.style is not None else "") or ""
            lines.append(f"# {t}" if style.lower().startswith(("heading", "title")) else t)
        for table in doc.tables:
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    lines.append(" | ".join(dict.fromkeys(cells)))
        text = "\n".join(lines)
    else:
        import pdfplumber

        try:
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                pages = [(page.extract_text() or "") for page in pdf.pages]
        except Exception as e:
            raise ParseError("The PDF file could not be read") from e
        empty = sum(1 for p in pages if not p.strip())
        if empty:
            warnings.append(f"{empty} of {len(pages)} pages had no text layer (scanned pages are not read)")
        text = "\n\n".join(pages)
    text = re.sub(r"[ \t]+\n", "\n", text).strip()
    if not text:
        raise ParseError("No text could be extracted from the file")
    return text, fmt, warnings


_NUMBERED = re.compile(r"^\s*(\d+(?:\.\d+)*)[.)]?\s+(.+)$")
_BULLET = re.compile(r"^\s*(?:[-•*▪–]|\(?[a-z]\))\s+(.+)$")
_HEADING_MD = re.compile(r"^\s*#+\s+(.+)$")


def _looks_like_heading(line: str) -> bool:
    t = line.strip()
    return 0 < len(t) <= 60 and not t.endswith((".", ":", ";", ",")) and len(t.split()) <= 8


def extract_clauses(text: str, prefix: str) -> tuple[list[ExtractedClause], list[str]]:
    """Splits a guideline into clauses with stable codes "<prefix>-<section>.<item>".

    Explicit numbering ("3.2 Do not ...") is kept as the code. Otherwise sections are counted from
    headings and items within them, so a document re-uploaded with small edits keeps its codes.
    """
    clauses: list[dict] = []
    warnings: list[str] = []
    section = 0
    item = 0
    heading: str | None = None
    current: dict | None = None

    def close():
        nonlocal current
        if current is not None:
            current["text"] = re.sub(r"\s+", " ", current["text"]).strip()
            if len(current["text"]) >= 15:
                clauses.append(current)
            elif current["text"]:
                warnings.append(f'Skipped a very short line: "{current["text"]}"')
        current = None

    def start_section(title: str, number: int | None = None):
        nonlocal section, item, heading
        close()
        section = number if number is not None else section + 1
        item = 0
        heading = title.strip()

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            close()
            continue
        if m := _HEADING_MD.match(line):
            start_section(m.group(1))
            continue
        if m := _NUMBERED.match(line):
            number, rest = m.group(1), m.group(2)
            if "." not in number and _looks_like_heading(rest):
                start_section(rest, int(number))
                continue
            close()
            if "." in number:
                major = int(number.split(".")[0])
                if major != section:
                    section, item = major, 0
                item += 1
                current = {"code": f"{prefix}-{number}", "heading": heading, "text": rest}
            else:
                item += 1
                current = {"code": f"{prefix}-{section or 0}.{item}" if section else f"{prefix}-{number}", "heading": heading, "text": rest}
            continue
        if m := _BULLET.match(line):
            close()
            item += 1
            current = {"code": f"{prefix}-{max(section, 1)}.{item}", "heading": heading, "text": m.group(1)}
            continue
        # A short Title Case or CAPITALISED line on its own starts a new section.
        if current is None and _looks_like_heading(line) and (line == line.title() or line.isupper()):
            start_section(line)
            continue
        if current is None:
            item += 1
            current = {"code": f"{prefix}-{max(section, 1)}.{item}", "heading": heading, "text": line}
        else:
            current["text"] += " " + line
    close()

    seen: dict[str, int] = {}
    out = []
    for c in clauses:
        code = c["code"]
        if code in seen:
            seen[code] += 1
            new = f"{code}-{chr(ord('a') + seen[code] - 1)}"
            warnings.append(f"Duplicate clause number {code}; renamed to {new}")
            code = new
        else:
            seen[code] = 0
        out.append(ExtractedClause(code=code, heading=c["heading"], text=c["text"]))
    return out, warnings
