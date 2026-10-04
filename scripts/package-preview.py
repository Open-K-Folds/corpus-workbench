"""Stage a synthetic-only native preview with retained dependency notices.

Run on a clean reviewed checkout after exact-commit tests. This creates a package,
not a release: the manifest, checksum audit and independent review are separate.
"""
import argparse
import hashlib
import json
import platform
import re
from pathlib import Path
import shutil
import subprocess
import tomllib
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--binary', required=True, type=Path)
parser.add_argument('--cargo-metadata', required=True, type=Path)
parser.add_argument('--rust-notices', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
args = parser.parse_args()
if platform.system() != 'Windows' or args.binary.suffix != '.exe':
    raise SystemExit('This first package recipe targets tested Windows x86-64 only.')
root = Path(__file__).resolve().parents[1]
def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()
if git('status', '--porcelain', '--untracked-files=no'):
    raise SystemExit('Tracked changes exist; commit and review before packaging.')
if args.out.exists():
    raise SystemExit('Output exists; choose a fresh package directory.')
version = tomllib.loads((root / 'Cargo.toml').read_text())['package']['version']
commit = git('rev-parse', 'HEAD')
stage = args.out / f'corpus-workbench-{version}'
stage.mkdir(parents=True)
(stage / 'bin').mkdir()
shutil.copy2(args.binary, stage / 'bin' / args.binary.name)
tracked = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z']).decode().split('\0')
allowed = {'scripts/prepare-synthetic.py', 'scripts/prepare-structural-synthetic.py', 'scripts/start-workbench.ps1', 'LICENSE', 'NOTICE',
           'README.md', 'CHANGELOG.md', 'MILESTONES.md', 'Open-Workbench.cmd',
           'evidence/dependency-inventory.json'}
for name in tracked:
    if name in allowed or name.startswith(('docs/', 'fixtures/synthetic/', 'assets/teitok-reader/')):
        source = root / name
        if source.is_symlink():
            raise SystemExit('Symlinks are not accepted in this preview recipe.')
        destination = stage / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
ui = root / 'ui/dist'
ui_files = [p for p in ui.rglob('*') if p.is_file()]
if (len(ui_files) != 3 or not (ui / 'index.html').is_file() or
        sum(p.suffix == '.js' for p in ui_files) != 1 or
        sum(p.suffix == '.css' for p in ui_files) != 1):
    raise SystemExit('Expected exactly the index, one JS bundle and one CSS bundle.')
for file in ui_files:
    name = file.relative_to(ui).as_posix()
    if file.is_symlink() or (name != 'index.html' and not re.fullmatch(r'assets/index-[A-Za-z0-9_-]+\.(js|css)', name)):
        raise SystemExit('Unexpected compiled UI output; perform a fresh reviewed build.')
    destination = stage / 'ui/dist' / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file, destination)
(stage / 'PACKAGE.md').write_text(f'''# Engineering preview {version}

Corresponding source: https://github.com/Open-K-Folds/corpus-workbench/tree/{commit}
Build and dependency instructions are in README.md. The native binary is supplied
in bin/ and the compiled UI in ui/dist/. This package contains no research data.

Windows: run `powershell -File scripts/start-workbench.ps1 -Binary bin/corpus-workbench.exe`.
Then open Open-Workbench.cmd. Python is needed to generate the synthetic tone.
The native binary targets Windows x86-64 and requires its supported system C runtime.

For an authorized corpus, protect a new authority, import a complete package copy,
and serve with the CLI options described in README.md. Never use the demo authority
as the research authority. Production and Raspberry Pi validation remain gates.
''', encoding='utf-8')
licenses = stage / 'third-party-licenses'
licenses.mkdir()
index = []
def notice_files(path):
    return [p for p in path.rglob('*') if p.is_file() and
            (any(p.name.lower().startswith(v) for v in ['license', 'licence', 'copying', 'copyright', 'notice']) or
             any(parent.name.lower() in ['licenses', 'license'] for parent in p.relative_to(path).parents))]
metadata = json.loads(args.cargo_metadata.read_text(encoding='utf-8-sig'))
if metadata['resolve'] is None:
    raise SystemExit('Cargo metadata must include the platform-filtered dependency graph.')
nodes = {node['id']: node for node in metadata['resolve']['nodes']}
active = set()
def visit(identity):
    if identity in active:
        return
    active.add(identity)
    for dependency in nodes[identity]['deps']:
        if any(kind['kind'] != 'dev' for kind in dependency['dep_kinds']):
            visit(dependency['pkg'])
visit(metadata['resolve']['root'])
for package in metadata['packages']:
    if package['source'] is None or package['id'] not in active:
        continue
    source = Path(package['manifest_path']).parent
    destination = licenses / 'cargo' / f"{package['name']}-{package['version']}"
    files = notice_files(source)
    if not files:
        raise SystemExit(f"No retained license file found for Cargo package {package['name']}")
    for file in files:
        relative = file.relative_to(source)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target)
    if package['name'] == 'libsqlite3-sys':
        sqlite = source / 'sqlite3/sqlite3.c'
        if sqlite.exists():
            content = sqlite.read_text(encoding='utf-8')
            (destination / 'SQLITE-PUBLIC-DOMAIN.txt').write_text(content[:content.index('*/')+2], encoding='utf-8')
    index.append({'ecosystem':'cargo','name':package['name'],'version':package['version'],
                  'license':package['license'],'files':[p.relative_to(source).as_posix() for p in files]})
lock = json.loads((root / 'ui/package-lock.json').read_text())
for location, package in lock['packages'].items():
    if not location:
        continue
    source = root / 'ui' / location
    if not source.is_dir():
        continue  # Optional platform-specific packages absent from this actual build.
    files = notice_files(source)
    notice_source = location
    if not files and location.startswith(('node_modules/@esbuild/', 'node_modules/@rollup/')):
        # Official platform-specific build tools share their parent project's
        # license but omit the text in these small platform packages.
        parent = 'esbuild' if '/@esbuild/' in location else 'rollup'
        source = root / 'ui/node_modules' / parent
        files = notice_files(source)
        notice_source = 'node_modules/' + parent
    if not files:
        raise SystemExit(f'No retained license file found for npm package {location}')
    name = location.removeprefix('node_modules/').replace('/', '__')
    destination = licenses / 'npm' / (name + '-' + package['version'])
    for file in files:
        target = destination / file.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target)
    index.append({'ecosystem':'npm','name':location.removeprefix('node_modules/'),
                  'version':package['version'],'license':package.get('license'),
                  'notice_source':notice_source,
                  'files':[p.relative_to(source).as_posix() for p in files]})
shutil.copytree(args.rust_notices / 'licenses', licenses / 'rust-standard-library/licenses')
for name in ['COPYRIGHT.html', 'COPYRIGHT-library.html']:
    shutil.copy2(args.rust_notices / name, licenses / 'rust-standard-library' / name)
(licenses / 'INDEX.json').write_text(json.dumps(index, indent=2), encoding='utf-8')
archive = args.out / f'corpus-workbench-{version}-windows-x86_64.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, strict_timestamps=False) as z:
    for file in sorted(stage.rglob('*')):
        if file.is_file():
            z.write(file, file.relative_to(args.out).as_posix())
print(json.dumps({'source_commit':commit, 'version':version, 'file_count':sum(p.is_file() for p in stage.rglob('*')),
                  'package':archive.name, 'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
