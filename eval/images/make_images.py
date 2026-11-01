"""Generates the image test set: a Northfern logo and 15 labelled social posts.

    python eval/images/make_images.py

Each post plants at most a few known problems (an off-palette colour, low-contrast text, a stretched,
rotated or recoloured logo, a wrong price, missing alt text) so the image checks can be scored.
Labels are in eval/testset_images.jsonl.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
GREEN, CREAM, GOLD, INK = "#1F4D3A", "#F4EFE6", "#C9A66B", "#2B2B2B"
SIZE = (1080, 1080)


# Fonts that have the rupee sign (the built-in default draws a box for "₹"). Nirmala UI also covers Devanagari.
FONTS = ["C:/Windows/Fonts/Nirmala.ttc", "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/Library/Fonts/Arial Unicode.ttf"]


def font(size: int) -> ImageFont.ImageFont:
    for path in FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    print("warning: no font with the rupee sign found; prices will not render correctly")
    return ImageFont.load_default(size=size)


def logo() -> Image.Image:
    """A fern frond and the word mark, on a transparent background."""
    img = Image.new("RGBA", (560, 200), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.line([(60, 180), (100, 20)], fill=GREEN, width=10)  # stem
    for i, y in enumerate(range(40, 170, 22)):
        reach = 20 + i * 6
        d.polygon([(100 - (y - 20) / 4, y), (100 - (y - 20) / 4 - reach, y - 18), (100 - (y - 20) / 4 - reach + 10, y + 6)], fill=GREEN)
        d.polygon([(100 - (y - 20) / 4, y), (100 - (y - 20) / 4 + reach, y - 22), (100 - (y - 20) / 4 + reach - 6, y + 4)], fill=GOLD)
    d.text((150, 52), "Northfern", font=font(84), fill=GREEN)
    d.rectangle([152, 150, 520, 160], fill=GOLD)
    return img


def post(bg: str, lines: list[tuple[str, str, int]], logo_img: Image.Image | None = None,
         logo_at: tuple[int, int] = (80, 860), block: tuple[str, tuple[int, int, int, int]] | None = None) -> Image.Image:
    img = Image.new("RGB", SIZE, bg)
    d = ImageDraw.Draw(img)
    if block:
        d.rectangle(block[1], fill=block[0])
    y = 140
    for text, colour, size in lines:
        d.text((80, y), text, font=font(size), fill=colour)
        y += int(size * 1.5)
    if logo_img is not None:
        img.paste(logo_img, logo_at, logo_img)
    return img


def main() -> None:
    mark = logo()
    mark.save(HERE / "northfern-logo.png")
    small = mark.resize((360, 129))
    stretched = mark.resize((540, 129))                                     # 50% wider than tall
    rotated = small.rotate(15, expand=True, resample=Image.Resampling.BICUBIC)
    recoloured = _recolour(small, "#D81B60")                                 # the shape in flat pink

    headline = [("Calm Barrier Moisturiser", GREEN, 64), ("Keeps dry skin comfortable", INK, 48), ("Now ₹549", GREEN, 72)]
    posts = {
        "i01": post(CREAM, headline, small),
        "i02": post("#E0317A", [("Calm Barrier Moisturiser", "#FFFFFF", 64), ("Now ₹549", "#FFFFFF", 72)], small),
        "i03": post(CREAM, headline, small, block=("#1E88E5", (0, 600, 1080, 820))),
        "i04": post(CREAM, [("Calm Barrier Moisturiser", "#E3DACB", 64), ("Now ₹549", GREEN, 72)], small),
        "i05": post(CREAM, [("Calm Barrier Moisturiser", GREEN, 64), ("Gentle on dry skin", GOLD, 40)], small),
        "i06": post(CREAM, [("Calm Barrier Moisturiser", GREEN, 64), ("Now just ₹499", GREEN, 72)], small),
        "i07": post(CREAM, [("Calm Barrier Moisturiser", GREEN, 64), ("A MIRACLE for dry skin", GREEN, 56)], small),
        "i08": post(CREAM, headline, stretched),
        "i09": post(CREAM, headline, rotated, logo_at=(80, 800)),
        "i10": post(CREAM, headline, recoloured),
        "i11": post(CREAM, headline, small),
        "i12": post(GREEN, [("Calm Barrier Moisturiser", CREAM, 64), ("Now ₹549", CREAM, 72)]),
        "i13": post(CREAM, [("Calm Barrier Cream", GREEN, 64), ("Now ₹549", GREEN, 72)], small),
        "i14": post("#FFFFFF", [("Gentle Oat Cleanser", "#111111", 64), ("100 ml, ₹349", "#111111", 56)]),
        "i15": post("#7CB342", [("Gentle Oat Cleanser", "#FFFFFF", 64), ("100 ml, ₹349", "#FFFFFF", 56)]),
    }
    for name, img in posts.items():
        img.save(HERE / f"{name}.png")

    alt = "Calm Barrier Moisturiser poster with the Northfern logo."
    labels = {
        "i01": ([], alt), "i02": ([{"check": "colour", "cite": "A-1"},
                 # White on this pink is 4.3:1: fails as normal text, passes as large text. Either answer is fair.
                 {"check": "contrast", "cite": "WCAG-1.4.3", "quote": "Calm Barrier Moisturiser", "needs": "ai", "acceptable": True},
                 {"check": "contrast", "cite": "WCAG-1.4.3", "quote": "Now ₹549", "needs": "ai", "acceptable": True}], alt),
        "i03": ([{"check": "colour", "cite": "A-1"}], alt),
        "i04": ([{"check": "contrast", "cite": "WCAG-1.4.3", "quote": "Calm Barrier Moisturiser", "needs": "ai"}], alt),
        "i05": ([{"check": "contrast", "cite": "WCAG-1.4.3", "quote": "Gentle on dry skin", "needs": "ai"}], alt),
        "i06": ([{"check": "text", "cite": "F-2", "quote": "₹499", "needs": "ai"}], alt),
        "i07": ([{"check": "text", "cite": "G-3.1", "quote": "MIRACLE", "needs": "ai"},
                 {"check": "text", "cite": "G-1.2", "quote": "MIRACLE", "needs": "ai"}], alt),
        "i08": ([{"check": "logo", "cite": "A-2", "quote": "stretched"}], alt),
        "i09": ([{"check": "logo", "cite": "A-2", "quote": "rotated"}], alt),
        "i10": ([{"check": "logo", "cite": "A-2", "quote": "recoloured"}], alt),
        "i11": ([{"check": "alt", "cite": "WCAG-1.1.1"}], ""),
        "i12": ([], alt), "i13": ([{"check": "text", "cite": "G-2.1", "quote": "Calm Barrier Cream", "needs": "ai"}], alt),
        "i14": ([], "Gentle Oat Cleanser, 100 ml, ₹349."),
        "i15": ([{"check": "colour", "cite": "A-1"}, {"check": "alt", "cite": "WCAG-1.1.1"},
                 # White on light green is 2.5:1, unreadable at any size.
                 {"check": "contrast", "cite": "WCAG-1.4.3", "quote": "Gentle Oat Cleanser", "needs": "ai"},
                 {"check": "contrast", "cite": "WCAG-1.4.3", "quote": "100 ml", "needs": "ai"}], ""),
    }
    with open(HERE.parent / "testset_images.jsonl", "w", encoding="utf-8", newline="\n") as fh:
        for name, (expected, alt_text) in labels.items():
            fh.write(json.dumps({"id": name, "file": f"images/{name}.png", "channel": "instagram", "alt_text": alt_text,
                                 "expected": expected}, ensure_ascii=False) + "\n")
    print(f"Wrote {len(posts)} posts, the logo and testset_images.jsonl")


def _recolour(img: Image.Image, colour: str) -> Image.Image:
    """The same logo shape in one flat colour."""
    flat = Image.new("RGBA", img.size, colour)
    flat.putalpha(img.getchannel("A"))
    return flat


if __name__ == "__main__":
    main()
