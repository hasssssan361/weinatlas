#!/usr/bin/env python3
"""Baut aus den Quelldateien in app/src eine einzelne, eigenständige HTML-Datei (app/dist/index.html).
Aufruf:  python app/build.py            (Ausgabe: app/dist/index.html)
         python app/build.py --out ../index.html
         python app/build.py --test         (zusätzlich app/dist/test.html für den lokalen Testserver)
"""
import sys, pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
css = ''.join((src / f).read_text(encoding='utf-8') + '\n' for f in ['base.css', 'app.css'])
js = ''.join('/* ---- ' + f + ' ---- */\n' + (src / f).read_text(encoding='utf-8') + '\n'
             for f in ['borders.js', 'atlas.js', 'api.js', 'searchcore.js', 'search.js', 'learn.js', 'admin.js', 'tableparse.js', 'importer.js', 'app.js'])
if '</script' in js.lower():
    sys.exit('FEHLER: "</script" im JavaScript gefunden')
html = (root / 'template.html').read_text(encoding='utf-8')
html = html.replace('/*{{CSS}}*/', css).replace('/*{{JS}}*/', js)
out = root / 'dist' / 'index.html'
if '--out' in sys.argv:
    out = (root / sys.argv[sys.argv.index('--out') + 1]).resolve()
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'{out}  ({len(html)//1024} KB)')

if '--test' in sys.argv:   # Testfassung gegen den lokalen Testserver (datenbank/tests/ui-server.mjs)
    marker = '<script>' + chr(10) + '/* ---- borders.js'
    cfg = '<script>window.WEINATLAS_CONFIG={url:"http://localhost:54321",key:"test"};</script>' + chr(10)
    (root / 'dist' / 'test.html').write_text(html.replace(marker, cfg + marker, 1), encoding='utf-8')
    print('Testfassung: app/dist/test.html')
