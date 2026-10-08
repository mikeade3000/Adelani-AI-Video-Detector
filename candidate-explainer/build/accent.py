"""Nudge espeak (en-gb) phonemes toward educated Nigerian English pronunciation.
Nigerian English is non-rhotic, has no TH sounds (θ→t, ð→d), little vowel length,
monophthongs where British English glides (eɪ→e, əʊ→o), ʌ→ɔ, ɜː→ɛ, and full vowels
in many syllables British English reduces (-tion → -shon)."""
import re
RULES = [
    ("ðə", "di"),                       # "the" → "di"
    ("ð", "d"),
    ("ɜː", "ɛ"), ("ɜ", "ɛ"),
    ("əʊ", "o"), ("oʊ", "o"), ("eɪ", "e"), ("eə", "ɛ"), ("ɪə", "ia"), ("ʊə", "ua"),
    ("ʌ", "ɔ"), ("ɒ", "ɔ"), ("ɔː", "ɔ"), ("ɑː", "a"), ("æ", "a"),
    ("iː", "i"), ("uː", "u"), ("ɪ", "i"), ("ᵻ", "i"), ("ʊ", "u"),
    ("ʃən", "ʃɔn"), ("ʒən", "ʒɔn"),
    ("ɾ", "t"), ("ʔ", "t"), ("ɚ", "a"), ("ɐ", "a"), ("ː", ""),
]

def nigerian(ph: str, strength: int = 1) -> str:
    """strength 1: reduced vowels become full only at word ends ("browser" → browsa);
    strength 2: everywhere (stronger accent, but words like "registered" get harder to follow)."""
    ph = re.sub(r"θ(?!ɹ)", "t", ph)     # keep "three" clear: it is the print limit
    for a, b in RULES:
        ph = ph.replace(a, b)
    if strength >= 2:
        return ph.replace("ə", "a")
    return re.sub(r"ə(?=[\s.,!?;:]|$)", "a", ph)
