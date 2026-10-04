"""Package existing Cargo test executables for the production OS/loader test.

Only a separate test image receives these binaries. Absolute Cargo executable
paths are preserved because process-recovery tests embed the native CLI path.
"""
import argparse
import json
from pathlib import Path
import shlex
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--manifest', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
args = parser.parse_args()
if args.out.exists():
    raise SystemExit('A fresh runtime contract package is required.')
executables = set()
for line in args.manifest.read_text(encoding='utf-8').splitlines():
    artifact = json.loads(line)
    if artifact.get('reason') == 'compiler-artifact' and artifact.get('profile', {}).get('test') and artifact.get('executable'):
        executable = Path(artifact['executable'])
        if not executable.is_relative_to('/source/target/debug') or '..' in executable.parts or not executable.is_file() or executable.is_symlink():
            raise SystemExit('Unexpected Cargo test executable path.')
        executables.add(executable)
if not executables:
    raise SystemExit('Cargo did not report any compiled test executables.')
native = Path('/source/target/debug/corpus-workbench')
if not native.is_file() or native.is_symlink():
    raise SystemExit('The process-recovery CLI binary is required.')
for executable in executables | {native}:
    destination = args.out / executable.relative_to('/')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(executable, destination)
script = args.out / 'run-runtime-contracts.sh'
script.write_text('#!/bin/sh\nset -eu\n' + '\n'.join(shlex.quote(str(path)) for path in sorted(executables)) + '\n', encoding='utf-8')
script.chmod(0o555)
(args.out / 'runtime-contracts.json').write_text(json.dumps({
    'executables': [str(path) for path in sorted(executables)],
    'native_cli': str(native), 'scope': 'Existing compiled contracts under actual runtime OS/loader; no compiler needed.',
}, indent=2) + '\n', encoding='utf-8')
