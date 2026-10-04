"""Build/test a clean exact commit locally; never push or delete an image/volume."""
import argparse
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import tomllib
root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--platform', choices=['linux/amd64', 'linux/arm64'])
parser.add_argument('--tag', help='Optional local build tag; never pushed.')
args = parser.parse_args()
def git(*arguments):
    return subprocess.check_output(['git', '-c', 'safe.directory=' + root.as_posix(), '-C', str(root), *arguments], text=True).strip()
if git('status', '--porcelain'):
    raise SystemExit('A clean committed checkout is required for exact-source image metadata.')
commit = git('rev-parse', 'HEAD')
version = tomllib.loads((root / 'Cargo.toml').read_text())['package']['version']
engine = subprocess.check_output(['docker', 'info', '--format', '{{.Architecture}}'], text=True).strip()
architecture = {'x86_64': 'amd64', 'aarch64': 'arm64', 'amd64': 'amd64', 'arm64': 'arm64'}[engine]
build_platform = args.platform or 'linux/' + architecture
tag = args.tag or f'corpus-workbench:{version}-{commit[:12]}-{build_platform.split("/")[1]}'
# Git ignores are not a privacy boundary: ignored files under src/docs would
# otherwise enter a broad Docker COPY. Materialize only immutable tracked HEAD.
archive = subprocess.check_output(['git', '-c', 'safe.directory=' + root.as_posix(), '-C', str(root), 'archive', '--format=tar', commit])
with tempfile.TemporaryDirectory(prefix='wb-image-source-') as directory:
    context = Path(directory)
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        for member in source:
            relative = Path(member.name)
            if relative.is_absolute() or '..' in relative.parts or not (member.isdir() or member.isfile()):
                raise SystemExit('Only regular tracked source files and directories are accepted.')
            destination = context / relative
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as data, destination.open('wb') as output:
                    shutil.copyfileobj(data, output)
    for target, image in [('native-test', tag + '-tests'), ('runtime-contracts', tag + '-runtime-contracts'), ('runtime', tag)]:
        subprocess.run(['docker', 'build', '--platform', build_platform, '--target', target,
            '--build-arg', 'SOURCE_COMMIT=' + commit, '--build-arg', 'VERSION=' + version,
            '-t', image, '.'], cwd=context, check=True)
        if target == 'runtime-contracts':
            test_image = json.loads(subprocess.check_output(['docker', 'image', 'inspect', image], text=True))[0]['Id']
            subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,mode=1777',
                '--pids-limit', '128', '--memory', '1g', '--cpus', '2', test_image], check=True)
metadata = json.loads(subprocess.check_output(['docker', 'image', 'inspect', tag], text=True))[0]
print(json.dumps({'image': tag, 'image_id': metadata['Id'], 'source_commit': commit,
    'runtime_contracts_image_id': test_image,
    'platform': build_platform, 'execution': 'native Linux engine' if build_platform == 'linux/' + architecture else 'emulated/cross-platform engine; not native hardware'}, indent=2))
