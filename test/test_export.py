import copy
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from src.demo import demo_session
from src.storage import write_json
from src.viewer import launch, render_html


class ExportParser(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=False)
        self.tags = []
        self.scripts = []
        self.script = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append((tag, attrs))
        if tag == 'script':
            self.script = dict(attrs=attrs, data='')
            self.scripts.append(self.script)

    def handle_endtag(self, tag):
        if tag == 'script':
            self.script = None

    def handle_data(self, data):
        if self.script is not None:
            self.script['data'] += data


class ExportTests(unittest.TestCase):
    def test_export_contains_only_inline_assets_and_inert_source(self):
        session = demo_session()
        original = copy.deepcopy(session)
        parsed = ExportParser(render_html(session))
        self.assertEqual(session, original)
        self.assertEqual(len(parsed.scripts), 2)
        self.assertEqual(parsed.scripts[0]['attrs']['type'], 'application/json')
        self.assertEqual(json.loads(parsed.scripts[0]['data']), session)
        code = parsed.scripts[1]['data']
        self.assertNotRegex(code, r'(?m)^import |^export |\bfetch\s*\(')
        for tag, attrs in parsed.tags:
            self.assertNotIn('src', attrs)
            if 'href' in attrs:
                self.assertTrue(attrs['href'].startswith(('data:', '#')))
        policy = next(attrs['content'] for tag, attrs in parsed.tags if tag == 'meta' and attrs.get('http-equiv') == 'Content-Security-Policy')
        self.assertIn("connect-src 'none'", policy)
        self.assertIn("default-src 'none'", policy)

    def test_source_cannot_escape_json_or_create_html_elements(self):
        attack = '</script><script>alert("source")</script><img src=x onerror=alert(1)><!-- & 🦊\r\n\u2028\u2029'
        session = demo_session()
        file = session['files'][0]
        file.update(path=attack, before=attack, after=attack + 'safe', parts=[dict(type='equal', text=attack), dict(type='add', text='safe')])
        session['repo'] = attack
        session['skipped'] = [attack]
        parsed = ExportParser(render_html(session))
        self.assertEqual(len(parsed.scripts), 2)
        self.assertEqual(json.loads(parsed.scripts[0]['data']), session)
        self.assertNotIn('<', parsed.scripts[0]['data'])
        self.assertFalse(any(tag == 'img' for tag, attrs in parsed.tags))
        self.assertNotIn('alert("source")', parsed.scripts[1]['data'])

    def test_saved_html_is_the_only_file_needed_and_open_is_optional(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, SLOPPYTYPER_HOME=directory):
                with patch('src.viewer.os.startfile', create=True) as open_file:
                    path = Path(launch(demo_session(), open_browser=False))
                    open_file.assert_not_called()
                    self.assertEqual(list(Path(directory).iterdir()), [path])
                    copied = Path(directory) / 'copied.html'
                    copied.write_bytes(path.read_bytes())
                    path.unlink()
                    self.assertEqual(len(ExportParser(copied.read_text(encoding='utf-8')).scripts), 2)
                    opened = launch(demo_session())
                    open_file.assert_called_once_with(opened)

    def test_untrusted_session_id_cannot_choose_output_path(self):
        session = demo_session()
        session['id'] = '../../outside'
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, SLOPPYTYPER_HOME=directory):
                path = Path(launch(session, open_browser=False))
                self.assertEqual(path.parent, Path(directory).resolve())
                self.assertTrue(path.name.startswith('session-'))


if __name__ == '__main__':
    unittest.main()
