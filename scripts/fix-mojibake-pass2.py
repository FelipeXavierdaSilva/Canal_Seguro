"""Segundo passe: corrige leftovers (setas e acentos) que o latin-1 puro não cobre."""
from pathlib import Path

ROOT = Path(r"c:\Sites\Sistema_Canal_de_Assédio")

# Mapa explícito (evita depender do terminal)
REPL = {
    "\u00e2\u2020\u0090": "\u2190",  # â † C1 -> ←
    "\u00e2\u2020\u0092": "\u2192",  # -> →
    "Ãº": "ú",
    "Ã¡": "á",
    "Ã©": "é",
    "Ã­": "í",
    "Ã³": "ó",
    "Ã£": "ã",
    "Ãµ": "õ",
    "Ã¢": "â",
    "Ãª": "ê",
    "Ã´": "ô",
    "Ã§": "ç",
    "Ã ": "à",
    "Ã¨": "è",
    "Ã¬": "ì",
    "Ã²": "ò",
    "Ã¼": "ü",
    "Ã±": "ñ",
    "Ã": "Á",
    "Ã‰": "É",
    "Ãš": "Ú",
    "Ã“": "Ó",
    "ÃŠ": "Ê",
    "Ã‡": "Ç",
    "Ãƒ": "Ã",
    "â€œ": "“",
    "â€": "”",
    "â€˜": "‘",
    "â€™": "’",
    "â€“": "–",
    "â€”": "—",
    "â€¦": "…",
    "Âº": "º",
    "Âª": "ª",
    "Â·": "·",
    "Â°": "°",
    "Â«": "«",
    "Â»": "»",
}

CP1252_EXTRA = {
    "\u2020": 0x86,  # dagger
    "\u2026": 0x85,
    "\u2018": 0x91,
    "\u2019": 0x92,
    "\u201c": 0x93,
    "\u201d": 0x94,
    "\u2013": 0x96,
    "\u2014": 0x97,
    "\u02dc": 0x98,
    "\u2122": 0x99,
}


def apply_repl(text: str) -> str:
    for a, b in REPL.items():
        text = text.replace(a, b)
    return text


def try_cp1252_line(line: str) -> str:
    raw = bytearray()
    for ch in line:
        o = ord(ch)
        if o < 256:
            raw.append(o)
        elif ch in CP1252_EXTRA:
            raw.append(CP1252_EXTRA[ch])
        else:
            return line
    try:
        return bytes(raw).decode("utf-8")
    except UnicodeDecodeError:
        return line


def fix_file(text: str) -> str:
    text = apply_repl(text)
    out = []
    for line in text.splitlines(keepends=True):
        if any(tok in line for tok in ("Ã", "â€", "Â", "\u00e2\u2020")):
            line = try_cp1252_line(line)
            line = apply_repl(line)
        out.append(line)
    return "".join(out)


def still_bad(text: str) -> bool:
    return any(tok in text for tok in ("Ã§", "Ã£", "Ãº", "Ã¡", "Ã©", "â€", "\u00e2\u2020", "pÃº", "demonstraÃ"))


fixed = []
remaining = []
for path in ROOT.rglob("*.html"):
    if "node_modules" in path.parts or ".git" in path.parts:
        continue
    original = path.read_text(encoding="utf-8")
    if not still_bad(original) and "\u00e2\u2020\u0090" not in original and "â†" not in original:
        # também pega seta quebrada solta
        if "\u00e2\u2020" not in original and "Ã" not in original:
            continue
    updated = fix_file(original)
    if updated != original:
        path.write_text(updated, encoding="utf-8", newline="\n")
        fixed.append(str(path.relative_to(ROOT)).replace("\\", "/"))
    check = path.read_text(encoding="utf-8")
    if still_bad(check) or "\u00e2\u2020" in check:
        remaining.append(str(path.relative_to(ROOT)).replace("\\", "/"))

print("FIXED", len(fixed))
for f in fixed:
    print(" ", f)
print("REMAINING", len(remaining))
for f in remaining:
    print(" ", f)

login = (ROOT / "login.html").read_text(encoding="utf-8")
for i, line in enumerate(login.splitlines(), 1):
    if "Voltar" in line or "demonstra" in line:
        print(f"LOGIN {i}: {line}")
