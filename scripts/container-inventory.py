"""Package corresponding source, retained notices and an SPDX component inventory.

Build-stage helper only. Includes runtime, build and test dependencies with scopes;
this inventory is neither a vulnerability scan nor a license clearance opinion.
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

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--commit', required=True)
parser.add_argument('--out', required=True, type=Path)
parser.add_argument('--cargo', required=True, type=Path)
parser.add_argument('--os', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = args.out
version = tomllib.loads((root / 'Cargo.toml').read_text())['package']['version']
components = []
notices = out / 'third-party-licenses'

def copy_notices(source, destination):
    found = []
    for file in source.rglob('*'):
        relative = file.relative_to(source)
        if file.is_file() and not file.is_symlink() and (
                any(file.name.lower().startswith(word) for word in ('license', 'licence', 'copying', 'copyright', 'notice')) or
                any(part.lower() in ('licenses', 'license') for part in relative.parts[:-1])):
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)
            found.append(relative.as_posix())
    return sorted(found)

metadata = json.loads(args.cargo.read_text())
active = {node['id'] for node in metadata['resolve']['nodes']}
for package in sorted(metadata['packages'], key=lambda p: (p['name'], p['version'])):
    if package['source'] is None or package['id'] not in active:
        continue
    source = Path(package['manifest_path']).parent
    destination = notices / 'cargo' / f"{package['name']}-{package['version']}"
    files = copy_notices(source, destination)
    if not files:
        raise SystemExit(f"No license notice for {package['name']}")
    if package['name'] == 'libsqlite3-sys':
        sqlite = (source / 'sqlite3/sqlite3.c').read_text()
        sqlite_public_domain = sqlite[:sqlite.index('*/') + 2]
        (destination / 'SQLITE-PUBLIC-DOMAIN.txt').write_text(sqlite_public_domain)
        sqlite_version = re.search(r'#define SQLITE_VERSION\s+"([0-9.]+)"', sqlite).group(1)
        components.append({'ecosystem': 'bundled-c', 'name': 'sqlite', 'version': sqlite_version,
            'license': 'LicenseRef-SQLite-Public-Domain', 'scope': 'linked runtime via libsqlite3-sys',
            'notices': ['cargo/' + destination.name + '/SQLITE-PUBLIC-DOMAIN.txt']})
    components.append({'ecosystem': 'cargo', 'name': package['name'], 'version': package['version'],
                       'license': package['license'], 'scope': 'runtime/build/test graph', 'notices': files})

lock = json.loads((root / 'ui/package-lock.json').read_text())
for location, package in sorted(lock['packages'].items()):
    if not location or not (root / 'ui' / location).is_dir():
        continue
    source = root / 'ui' / location
    installed = json.loads((source / 'package.json').read_text())
    name = installed['name']
    if installed['version'] != package['version']:
        raise SystemExit(f'Installed version differs from lock for {location}')
    notice_status = 'retained license text'
    destination = notices / 'npm' / (name.replace('/', '__') + '-' + package['version'])
    files = copy_notices(source, destination)
    if not files and name.startswith(('@esbuild/', '@rollup/')):
        parent = 'esbuild' if name.startswith('@esbuild/') else 'rollup'
        candidates = [root / 'ui' / path for path in lock['packages']
                      if path.endswith('/' + parent) and (root / 'ui' / path).is_dir()]
        if len(candidates) != 1:
            raise SystemExit(f'Unambiguous parent license is required for {location}')
        files = copy_notices(candidates[0], destination)
    if not files:
        raise SystemExit(f'No license notice for {location}')
    components.append({'ecosystem': 'npm', 'name': name, 'version': package['version'],
                       'license': package.get('license'), 'scope': 'UI/build/test', 'notices': files, 'notice_status': notice_status})

sysroot = Path(subprocess.check_output(['rustc', '--print', 'sysroot'], text=True).strip())
standard_notices = copy_notices(sysroot / 'share/doc/rust/html', notices / 'rust-standard-library')
if not standard_notices:
    raise SystemExit('Rust standard-library copyright/license documents are required.')
components.append({'ecosystem': 'toolchain', 'name': 'rust-standard-library', 'version': '1.90.0',
                   'license': 'MIT OR Apache-2.0', 'scope': 'linked runtime', 'notices': standard_notices})
shutil.copytree(args.os / 'notices', notices / 'debian')
for line in (args.os / 'packages.tsv').read_text().splitlines():
    name, package_version, architecture = line.split('\t')
    components.append({'ecosystem': 'deb', 'name': name, 'version': package_version,
                       'architecture': architecture, 'license': None, 'scope': 'runtime OS',
                       'notices': 'third-party-licenses/debian/usr/share/doc (where supplied by base image)'})

source_out = out / 'corresponding-source'
for name in ('Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'Dockerfile', 'compose.yaml', 'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md', 'MILESTONES.md'):
    source_out.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / name, source_out / name)
for name in ('src', 'tests', 'assets', 'docs', 'containers', 'fixtures/synthetic'):
    shutil.copytree(root / name, source_out / name)
for name in ('.dockerignore', 'scripts/prepare-synthetic.py', 'scripts/container-inventory.py', 'scripts/build-containers.py', 'scripts/container-smoke.py', 'scripts/container-upgrade-smoke.py', 'evidence/dependency-inventory.json', 'ui/package.json', 'ui/package-lock.json', 'ui/tsconfig.json', 'ui/playwright.config.ts', 'ui/container-browser.mjs', 'ui/index.html'):
    destination = source_out / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / name, destination)
shutil.copytree(root / 'ui/src', source_out / 'ui/src')
shutil.copytree(root / 'ui/tests', source_out / 'ui/tests')
shutil.copytree(root / 'ui/dist', out / 'ui')
(out / 'bin').mkdir()
shutil.copy2(root / 'target/release/corpus-workbench', out / 'bin/corpus-workbench')
for name in ('LICENSE', 'NOTICE'):
    shutil.copy2(root / name, out / name)
(out / 'BUILD.json').write_text(json.dumps({'source_commit': args.commit, 'version': version,
    'platform': 'linux/' + platform.machine(), 'data': 'synthetic only', 'schema': 2,
    'inventory_scope': 'resolved Cargo graph, installed npm build packages, Rust standard library and runtime Debian packages',
    'limitations': ['OS copyright texts depend on pinned base-image contents', 'No vulnerability scan or legal clearance implied', 'ARM64/Windows/Pi execution reported separately']}, indent=2))
(notices / 'INDEX.json').write_text(json.dumps(components, indent=2))
packages = [{'SPDXID': 'SPDXRef-Application', 'name': 'corpus-workbench', 'versionInfo': version,
             'downloadLocation': 'NOASSERTION', 'filesAnalyzed': False, 'licenseConcluded': 'NOASSERTION',
             'licenseDeclared': 'GPL-3.0-or-later', 'copyrightText': 'NOASSERTION'}]
for index, component in enumerate(components):
    packages.append({'SPDXID': f'SPDXRef-Dependency-{index}', 'name': component['name'],
        'versionInfo': component['version'], 'downloadLocation': 'NOASSERTION', 'filesAnalyzed': False,
        'licenseConcluded': 'NOASSERTION', 'licenseDeclared': component['license'] or 'NOASSERTION',
        'copyrightText': 'NOASSERTION', 'comment': json.dumps({'ecosystem': component['ecosystem'], 'scope': component['scope']})})
spdx = {'spdxVersion': 'SPDX-2.3', 'dataLicense': 'CC0-1.0', 'SPDXID': 'SPDXRef-DOCUMENT',
    'name': f'corpus-workbench-{version}-{platform.machine()}',
    'documentNamespace': f'https://github.com/Open-K-Folds/corpus-workbench/spdx/{args.commit}/{platform.machine()}',
    'creationInfo': {'creators': ['Tool: corpus-workbench container-inventory'], 'created': '2026-10-04T00:00:00Z'},
    'packages': packages,
    'hasExtractedLicensingInfos': [{'licenseId': 'LicenseRef-SQLite-Public-Domain',
        'name': 'SQLite public domain dedication', 'extractedText': sqlite_public_domain,
        'seeAlsos': ['https://sqlite.org/copyright.html']}],
    'relationships': [{'spdxElementId': 'SPDXRef-DOCUMENT', 'relationshipType': 'DESCRIBES', 'relatedSpdxElement': 'SPDXRef-Application'}]}
(out / 'SBOM.spdx.json').write_text(json.dumps(spdx, indent=2))
lines = []
for file in sorted(out.rglob('*')):
    if file.is_file():
        lines.append(hashlib.sha256(file.read_bytes()).hexdigest() + '  ' + file.relative_to(out).as_posix())
(out / 'SHA256SUMS').write_text('\n'.join(lines) + '\n')
print(json.dumps({'components': len(components), 'files': len(lines), 'source_commit': args.commit}))
