"""Generate a portable HTML file. No server, ports, fetches, or background process."""
import base64
import json
import os
from pathlib import Path
import re
import uuid

from .storage import data_dir, write_text

WEB = Path(__file__).resolve().parent.parent / 'web'
MODULES = ('replay.js', 'rain.js', 'code-view.js', 'effects.js', 'app.js')


def render_html(session):
    # Serialize source into inert JSON. Escaping '<' prevents source containing
    # </script>, comments, or HTML from ever closing its data element.
    data = json.dumps(session, ensure_ascii=True, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    modules = []
    for name in MODULES:
        script = (WEB / name).read_text(encoding='utf-8')
        script = re.sub(r'^import [^\n]+;\r?\n', '', script, flags=re.M)
        script = re.sub(r'^export (?=(?:class|function|const|let)\b)', '', script, flags=re.M)
        # Each original module keeps its own scope; only its public API escapes.
        exports = re.findall(r'^export (?:class|function|const|let) (\w+)', (WEB / name).read_text(encoding='utf-8'), re.M)
        if exports:
            modules.append('const {' + ', '.join(exports) + '} = (() => {\n' + script + '\nreturn {' + ', '.join(exports) + '};\n})();')
        else:
            modules.append(script)
    script = "'use strict';\n(() => {\n" + '\n'.join(modules) + '\n})();'
    if re.search(r'</script', script, re.I):
        raise ValueError('Viewer JavaScript contains an unsafe HTML closing tag.')
    style = (WEB / 'style.css').read_text(encoding='utf-8')
    icon = base64.b64encode((WEB / 'favicon.svg').read_bytes()).decode('ascii')
    document = (WEB / 'index.html').read_text(encoding='utf-8')
    document = document.replace('href="favicon.svg"', f'href="data:image/svg+xml;base64,{icon}"')
    document = document.replace('<link rel="stylesheet" href="style.css">', f'<style>\n{style}\n</style>')
    document = document.replace('<script type="module" src="app.js"></script>', '')
    # For file:// pages, inline scripts avoid browser restrictions on local ES
    # module imports. Source data never enters executable JavaScript.
    document = document.replace('</body>', f'<script id="session-data" type="application/json">{data}</script>\n<script>\n{script}\n</script>\n</body>')
    return document


def launch(session, *, open_browser=True, root=None):
    # Use our own filename rather than trusting imported session metadata.
    path = data_dir(root) / f'session-{uuid.uuid4()}.html'
    write_text(path, render_html(session))
    if open_browser:
        os.startfile(str(path))
    return str(path)
