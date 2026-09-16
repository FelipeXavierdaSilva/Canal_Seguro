"""Corrige mojibake UTF-8->Latin-1 nos HTML afetados pelo Set-Content PowerShell."""
from pathlib import Path

ROOT = Path(r'c:\Sites\Sistema_Canal_de_Assédio')
MARKERS = ('Ã§', 'Ã£', 'Ãº', 'Ã¡', 'Ã©', 'Ã­', 'Ã³', 'Ã±', 'Ã‰', 'Ãš', 'Ã¢', 'Ãª', 'Ã´',
           'â€“', 'â€”', 'â€œ', 'â€', 'â†', 'Â·', 'Âº', 'Â«', 'Â»', 'Ã ', 'Ã§Ã£')

# Apenas HTML/partials da UI (não mexer em docs nem lógica JS sem necessidade)
TARGETS = []
for p in ROOT.rglob('*.html'):
    if 'node_modules' in p.parts or '.git' in p.parts:
        continue
    TARGETS.append(p)

def looks_mojibake(text: str) -> bool:
    return any(m in text for m in MARKERS)

def fix_text(text: str) -> str:
    """Reverte UTF-8 lido como Latin-1/CP1252."""
    for enc in ('latin-1', 'cp1252'):
        try:
            return text.encode(enc).decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    # Fallback: corrige só trechos problemáticos linha a linha
    out = []
    for line in text.splitlines(keepends=True):
        if looks_mojibake(line):
            fixed = None
            for enc in ('latin-1', 'cp1252'):
                try:
                    fixed = line.encode(enc).decode('utf-8')
                    break
                except (UnicodeEncodeError, UnicodeDecodeError):
                    continue
            out.append(fixed if fixed is not None else line)
        else:
            out.append(line)
    return ''.join(out)

fixed_files = []
skipped = []
failed = []

for path in TARGETS:
    raw = path.read_bytes()
    # Detect BOM
    if raw.startswith(b'\xef\xbb\xbf'):
        text = raw[3:].decode('utf-8')
        had_bom = True
    else:
        text = raw.decode('utf-8')
        had_bom = False

    if not looks_mojibake(text):
        skipped.append(str(path.relative_to(ROOT)))
        continue

    new_text = fix_text(text)
    if new_text == text:
        failed.append((str(path.relative_to(ROOT)), 'fix produced no change'))
        continue
    if looks_mojibake(new_text):
        # ainda tem markers — tentar segunda passagem se ficou parcialmente ok
        second = fix_text(new_text)
        if not looks_mojibake(second):
            new_text = second
        elif looks_mojibake(new_text):
            failed.append((str(path.relative_to(ROOT)), 'still has markers after fix'))
            # ainda grava se melhorou (menos markers)
            before = sum(text.count(m) for m in MARKERS)
            after = sum(new_text.count(m) for m in MARKERS)
            if after >= before:
                continue

    path.write_bytes(new_text.encode('utf-8'))  # sem BOM
    fixed_files.append(str(path.relative_to(ROOT)).replace('\\', '/'))

print('FIXED', len(fixed_files))
for f in fixed_files:
    print(' ', f)
print('SKIPPED_OK', len(skipped))
print('FAILED', len(failed))
for f, reason in failed:
    print(' ', f, reason)
