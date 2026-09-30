"""Exact Unicode diffs with bounded refinement, using only difflib."""
from difflib import SequenceMatcher
import uuid

from .snapshot import timestamp

# Avoid SequenceMatcher's quadratic worst case on large, repetitive rewrites.
DIFF_WORK = 250_000


def diff_parts(before, after):
    parts = []

    def emit(kind, text):
        if not text:
            return
        if parts and parts[-1]['type'] == kind:
            parts[-1]['text'] += text
        else:
            parts.append(dict(type=kind, text=text))

    def compare(old, new, lines=True):
        prefix = 0
        limit = min(len(old), len(new))
        while prefix < limit and old[prefix] == new[prefix]:
            prefix += 1
        suffix = 0
        while suffix < limit - prefix and old[-suffix - 1] == new[-suffix - 1]:
            suffix += 1
        emit('equal', old[:prefix])
        old_middle = old[prefix:len(old) - suffix if suffix else len(old)]
        new_middle = new[prefix:len(new) - suffix if suffix else len(new)]
        if not old_middle or not new_middle:
            emit('remove', old_middle)
            emit('add', new_middle)
        else:
            a = old_middle.splitlines(keepends=True) if lines else old_middle
            b = new_middle.splitlines(keepends=True) if lines else new_middle
            if len(a) * len(b) > DIFF_WORK:
                emit('remove', old_middle)
                emit('add', new_middle)
            else:
                for kind, i, j, k, l in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
                    left, right = ''.join(a[i:j]), ''.join(b[k:l])
                    if kind == 'equal':
                        emit('equal', left)
                    elif kind == 'replace' and lines:
                        compare(left, right, lines=False)
                    else:
                        emit('remove', left)
                        emit('add', right)
        if suffix:
            emit('equal', old[-suffix:])

    compare(before, after)
    return parts


def make_session(before, after, source='manual'):
    if before['root'] != after['root']:
        raise ValueError('Snapshots belong to different repositories.')
    skipped = set(before['skipped']) | set(after['skipped'])
    files = []
    for name in sorted(before['files'].keys() | after['files'].keys()):
        if name in skipped:
            continue
        old, new = before['files'].get(name, ''), after['files'].get(name, '')
        existed, exists = name in before['files'], name in after['files']
        if old == new and existed == exists:
            continue
        parts = diff_parts(old, new)
        added = sum(len(p['text']) for p in parts if p['type'] == 'add')
        removed = sum(len(p['text']) for p in parts if p['type'] == 'remove')
        files.append(dict(path=name, kind='added' if not existed else 'deleted' if not exists else 'modified',
                          before=old, after=new, parts=parts, added=added, removed=removed, total=max(1, added + removed)))
    return dict(id=str(uuid.uuid4()), repo=after['name'], branch=after['branch'], source=source,
                createdAt=timestamp(), files=files, skipped=sorted(skipped), total=sum(f['total'] for f in files))
