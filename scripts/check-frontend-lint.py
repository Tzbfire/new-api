#!/usr/bin/env python3
"""Reject new oxlint errors while reporting inherited upstream lint debt."""
import collections
import json
import os
from pathlib import Path
import subprocess
import sys

frontend = Path.cwd()
cli = frontend / 'node_modules/oxlint/bin/oxlint'

def diagnostics(directory):
    result = subprocess.run(
        ['node', str(cli), '-c', '.oxlintrc.json', '--format', 'json', '.'],
        cwd=directory, text=True, capture_output=True,
    )
    if result.returncode not in (0, 1):
        sys.exit(result.stderr or result.stdout or f'oxlint exited {result.returncode}')
    data = json.loads(result.stdout)
    # Fail closed if the formatter changes its contract.
    entries = data['diagnostics']
    return [item for item in entries if item['severity'] == 'error']

def signature(item):
    return item['filename'], item.get('code'), item['message']

baseline = diagnostics(Path(os.environ['LINT_BASELINE_DIR']))
current = diagnostics(frontend)
remaining = collections.Counter(signature(item) for item in baseline)
new = []
for item in current:
    key = signature(item)
    if remaining[key]:
        remaining[key] -= 1
    else:
        new.append(item)
print(f'Upstream lint errors: {len(baseline)}; current: {len(current)}; new: {len(new)}')
for item in new:
    print(json.dumps(item, ensure_ascii=False))
sys.exit(bool(new))
