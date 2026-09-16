"""Terceiro passe: corrige ícones/emojis UTF-8 regravados como CP1252."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Sequências típicas de mojibake (UTF-8 lido como CP1252)
MOJIBAKE_MARKERS = (
    "ðŸ",
    "â—",
    "â˜",
    "â–",
    "â¬",
    "âœ",
    "Ã§",
    "Ã£",
    "Ãº",
    "Ã¡",
    "â€",
    "â†",
    "\u00e2\u2020",
)

# Tags/conteúdos onde aplicar correção automática cp1252→utf-8
INNER_TEXT_PATTERNS = [
    re.compile(r'(<span class="nav-icon">)(.*?)(</span>)', re.DOTALL),
    re.compile(r'(<button[^>]*data-toggle-theme[^>]*>)(.*?)(</button>)', re.DOTALL),
    re.compile(r'(<button[^>]*mobile-menu-btn[^>]*>)(.*?)(</button>)', re.DOTALL),
    re.compile(r'(<button[^>]*notif-btn[^>]*>)(.*?)(</button>)', re.DOTALL),
    re.compile(r'(<div class="action-card__icon">)(.*?)(</div>)', re.DOTALL),
    re.compile(r'(<option value="(?:high|moderate|low)">)(.*?)(</option>)', re.DOTALL),
]

# Mapa explícito (passes anteriores + símbolos)
EXPLICIT_REPL = {
    "\u00e2\u2020\u0090": "\u2190",
    "\u00e2\u2020\u0092": "\u2192",
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
    # Símbolos com bytes CP1252 inválidos (0x90, 0x81) — cp1252→utf-8 falha
    "\u00e2\u2014\u0090": "\u25d0",  # ◐ tema
    "\u00e2\u02dc\u0081": "\u2601",  # ☁ nuvem
}


def has_mojibake(text: str) -> bool:
    return any(m in text for m in MOJIBAKE_MARKERS)


def try_cp1252_to_utf8(text: str) -> str | None:
    try:
        return text.encode("cp1252").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return None


def apply_explicit(text: str) -> str:
    for src, dst in EXPLICIT_REPL.items():
        text = text.replace(src, dst)
    return text


def fix_inner_text(inner: str) -> str:
    if not has_mojibake(inner):
        return inner
    fixed = try_cp1252_to_utf8(inner)
    if fixed is not None and fixed != inner:
        return fixed
    return apply_explicit(inner)


def fix_html(text: str) -> str:
    text = apply_explicit(text)
    for pattern in INNER_TEXT_PATTERNS:
        def repl(match: re.Match[str]) -> str:
            start, inner, end = match.group(1), match.group(2), match.group(3)
            if inner.strip() in ("API", "SSO"):
                return match.group(0)
            return start + fix_inner_text(inner) + end

        text = pattern.sub(repl, text)

    # Linhas com mojibake restante (ex.: texto solto)
    lines_out: list[str] = []
    for line in text.splitlines(keepends=True):
        if has_mojibake(line):
            candidate = try_cp1252_to_utf8(line)
            if candidate is not None:
                line = apply_explicit(candidate)
            else:
                line = apply_explicit(line)
        lines_out.append(line)
    return "".join(lines_out)


def main() -> None:
    fixed: list[str] = []
    still_bad: list[str] = []

    for path in sorted(ROOT.rglob("*.html")):
        if "node_modules" in path.parts:
            continue
        original = path.read_text(encoding="utf-8")
        if not has_mojibake(original):
            continue
        updated = fix_html(original)
        rel = str(path.relative_to(ROOT)).replace("\\", "/")
        if updated != original:
            path.write_text(updated, encoding="utf-8", newline="\n")
            fixed.append(rel)
        check = path.read_text(encoding="utf-8")
        if has_mojibake(check):
            still_bad.append(rel)

    print(f"FIXED {len(fixed)}")
    for f in fixed:
        print(f"  {f}")
    print(f"REMAINING {len(still_bad)}")
    for f in still_bad:
        print(f"  {f}")


if __name__ == "__main__":
    main()
