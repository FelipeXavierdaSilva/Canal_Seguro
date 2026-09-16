import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
index = (root / 'index.html').read_text(encoding='utf-8')
match = re.search(r'(<footer class="site-footer footer-canal">.*?</footer>)', index, re.S)
if not match:
    raise SystemExit('footer not found')
footer = match.group(1)
(root / 'partials').mkdir(exist_ok=True)
(root / 'partials' / 'footer-public.html').write_text(footer + '\n', encoding='utf-8')

files_replace = [
    'faq.html', 'educacao.html', 'fale-conosco.html',
    'politica-privacidade.html', 'lgpd.html', 'suporte.html',
    'termos-de-uso.html', 'politica-cookies.html',
]
files_insert = ['relato.html', 'protocolo.html']

for name in files_replace:
    path = root / name
    content = path.read_text(encoding='utf-8')
    new_content, n = re.subn(r'<footer class="site-footer".*?</footer>', footer, content, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f'failed replace in {name}: {n}')
    path.write_text(new_content, encoding='utf-8')
    print('replaced', name)

for name in files_insert:
    path = root / name
    content = path.read_text(encoding='utf-8')
    if 'footer-canal' in content:
        print('skip insert', name)
        continue
    if '</main>' not in content:
        raise SystemExit(f'no main close in {name}')
    new_content = content.replace('</main>', '</main>\n\n' + footer, 1)
    path.write_text(new_content, encoding='utf-8')
    print('inserted', name)

print('done')
