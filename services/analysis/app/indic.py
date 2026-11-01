"""Hindi and Hinglish support: language detection, Devanagari transliteration and matching that
works across scripts and common spelling variants.

Matching compares words by a phonetic key rather than by spelling, so a banned term written as
"chamatkar" also matches "chamatkaar" and "चमत्कार". Keys only decide equality of whole words; there
is no fuzzy similarity, which keeps false matches rare. A looser consonant-only comparison is used
for long words (four or more consonants), where accidental collisions are unlikely: it lets the
English "miracle" match the Devanagari spelling "मिरेकल".
"""

from __future__ import annotations

import re
import unicodedata

# Devanagari letters, vowel signs, virama and nukta, without the danda (।, ॥) that ends sentences.
DEVA = "ऀ-ॣ०-ॿ"
WORD_CHARS = rf"\w{DEVA}"
TOKEN = re.compile(rf"[A-Za-z]+(?:'[A-Za-z]+)?|[{DEVA}]+")

_CONSONANTS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v",
    "श": "sh", "ष": "sh", "स": "s", "ह": "h",
}
_NUKTA = {"क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "r", "ढ": "rh", "फ": "f", "य": "y"}
_PRECOMPOSED_NUKTA = ["q", "kh", "g", "z", "r", "rh", "f", "y"]  # U+0958 to U+095F
_VOWELS = {
    "अ": "a", "आ": "aa", "इ": "i", "ई": "ii", "उ": "u", "ऊ": "uu", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o",
    "औ": "au", "ऑ": "o", "ऍ": "e",
}
_SIGNS = {
    "ा": "aa", "ि": "i", "ी": "ii", "ु": "u", "ू": "uu", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
    "ॉ": "o", "ॅ": "e",
}
_VIRAMA, _NUKTA_SIGN = "्", "़"
_NASAL = {"ं": "n", "ँ": "n", "ः": "h"}
DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

# Common Hindi function words written in Roman letters; their share tells Hinglish from English.
_HINGLISH = {
    "hai", "hain", "ho", "hoga", "hogi", "hota", "hoti", "tha", "thi", "aur", "ke", "ki", "ka", "ko", "se", "mein",
    "nahi", "nahin", "bhi", "yeh", "ye", "woh", "wo", "apni", "apna", "apne", "kya", "bahut", "sirf", "abhi",
    "liye", "wala", "wali", "wale", "karo", "kare", "karein", "karta", "karti", "raha", "rahi", "rahe", "hum",
    "aap", "tum", "mera", "meri", "tera", "teri", "sab", "kuch", "ab", "toh", "bas", "ekdum", "bilkul", "acha",
    "accha", "achha", "lagao", "paao", "milega", "milegi", "chahiye", "jaisa", "jaisi", "par", "pe", "tak",
}


def transliterate(word: str) -> str:
    """Devanagari to plain Roman letters, close to how people spell Hindi in Roman script.

    The inherent vowel is dropped at the end of a word ("कमल" -> "kamal"), as in spoken Hindi.
    """
    word = unicodedata.normalize("NFC", word)
    out: list[str] = []
    inherent = False  # the last consonant still carries its implicit "a"
    for i, ch in enumerate(word):
        if ch in _CONSONANTS:
            if inherent:
                out.append("a")
            nukta = i + 1 < len(word) and word[i + 1] == _NUKTA_SIGN
            out.append(_NUKTA.get(ch, _CONSONANTS[ch]) if nukta else _CONSONANTS[ch])
            inherent = True
        elif "क़" <= ch <= "य़":  # precomposed nukta consonants (क़ ख़ ग़ ज़ ड़ ढ़ फ़ य़)
            if inherent:
                out.append("a")
            out.append(_PRECOMPOSED_NUKTA[ord(ch) - 0x958])
            inherent = True
        elif ch in _SIGNS:
            out.append(_SIGNS[ch])
            inherent = False
        elif ch == _VIRAMA:
            inherent = False
        elif ch == _NUKTA_SIGN:
            continue
        elif ch in _VOWELS:
            if inherent:
                out.append("a")
            out.append(_VOWELS[ch])
            inherent = False
        elif ch in _NASAL:
            if inherent:
                out.append("a")
            out.append(_NASAL[ch])
            inherent = False
        elif ch.isdigit():
            if inherent:
                out.append("a")
            out.append(ch.translate(DIGITS))
            inherent = False
    return "".join(out)


_STEPS = [
    ("chh", "C"), ("ch", "C"), ("sh", "s"), ("ph", "f"), ("kh", "k"), ("gh", "g"), ("th", "t"), ("dh", "d"),
    ("bh", "b"), ("jh", "j"), ("rh", "r"), ("ck", "k"), ("c", "k"), ("q", "k"), ("x", "ks"), ("w", "v"), ("z", "j"),
    ("ee", "i"), ("ea", "i"), ("ii", "i"), ("oo", "u"), ("uu", "u"), ("aa", "a"), ("ai", "e"), ("ay", "e"),
    ("ei", "e"), ("au", "o"), ("aw", "o"), ("ow", "o"),
]


def phonetic_key(word: str) -> str:
    """A spelling-independent key: "Chamatkaar", "chamatkar" and "चमत्कार" share one."""
    s = transliterate(word) if re.search(f"[{DEVA}]", word) else word.lower()
    s = re.sub(r"[^a-z]", "", s)
    for a, b in _STEPS:
        s = s.replace(a, b)
    s = re.sub(r"(.)\1+", r"\1", s)
    if s.endswith("y") and len(s) > 2:
        s = s[:-1] + "i"
    if len(s) > 4 and s.endswith(("a", "e")):
        s = s[:-1]  # silent or inherent final vowel: "chamatkara", "miracle"
    return s.lower()


def skeleton(key: str) -> str:
    """The key without vowels (keeping a leading one): "mirakl" -> "mrkl". A "y" after the first letter
    is a glide between vowels in Devanagari spellings of English words ("फेयरनेस"), so it goes too."""
    return key[:1] + re.sub(r"[aeiouy]", "", key[1:]) if key else key


def _same(term_key: str, word_key: str) -> bool:
    if term_key == word_key:
        return True
    sk = skeleton(term_key)
    return len(sk) >= 4 and sk == skeleton(word_key)


def find_term_any_script(text: str, term: str) -> list[tuple[int, int]]:
    """Whole-word matches of a term in Roman or Devanagari script, tolerant of common spelling variants."""
    keys = [phonetic_key(t.group()) for t in TOKEN.finditer(term)]
    keys = [k for k in keys if k]
    if not keys:
        return []
    tokens = list(TOKEN.finditer(text))
    words = [phonetic_key(t.group()) for t in tokens]
    out = []
    for i in range(len(tokens) - len(keys) + 1):
        if all(_same(k, words[i + j]) for j, k in enumerate(keys)):
            out.append((tokens[i].start(), tokens[i + len(keys) - 1].end()))
    return out


def detect_language(text: str) -> str:
    """"hi" for Devanagari Hindi, "hinglish" for Hindi in Roman letters (often mixed with English), else "en"."""
    deva = len(re.findall(f"[{DEVA}]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    if deva and deva >= 0.2 * (deva + latin):
        return "hi"
    words = [w.lower() for w in re.findall(r"[A-Za-z]+", text)]
    hindi = sum(w in _HINGLISH for w in words)
    if hindi >= 2 and hindi >= 0.15 * len(words):
        return "hinglish"
    return "en"


LANGUAGE_NAMES = {"en": "English", "hi": "Hindi (Devanagari script)", "hinglish": "Hinglish (Hindi in Roman letters, mixed with English)"}
