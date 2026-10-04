"""Qualify two local image versions on fresh synthetic authorities and clones.

Never upgrades an existing authority or removes volumes. Tests compatible schema
2 transitions and rollback to a retained pre-upgrade backup; it does not promise
that an older application can read an arbitrary future database format.
"""
import argparse
import hashlib
from http.cookiejar import CookieJar
import io
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--old-image', required=True)
parser.add_argument('--new-image', required=True)
parser.add_argument('--port', type=int, default=18922)
parser.add_argument('--out', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
if args.out.exists():
    raise SystemExit('Evidence output exists; choose a fresh path.')
if not 1024 <= args.port <= 65535:
    raise SystemExit('An unprivileged port is required.')
with socket.socket() as probe:
    probe.bind(('127.0.0.1', args.port))
prefix = 'wbupgrade-' + uuid.uuid4().hex[:12]
projects = []
volumes = []
base = f'http://127.0.0.1:{args.port}'
code = ''
opener = None


def run(arguments, ok=True, env=None):
    result = subprocess.run(arguments, cwd=root, env=env, capture_output=True,
                            text=True, encoding='utf-8')
    if ok and result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    return result


def compose(project, image, store, *arguments, ok=True):
    environment = {**os.environ, 'WB_IMAGE': image, 'WB_PORT': str(args.port),
                   'WB_PROJECT': 'synthetic', 'WB_STORE': store}
    return run(['docker', 'compose', '-f', str(root / 'compose.yaml'), '-p', project,
                *arguments], ok=ok, env=environment)


def http(path, data=None, expected=200):
    headers = {} if data is None else {
        'Content-Type': 'application/json', 'Origin': base, 'X-WB-CSRF': code}
    request = urllib.request.Request(base + path, headers=headers,
        data=None if data is None else json.dumps(data).encode())
    try:
        response = opener.open(request, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    assert response.status == expected, (path, response.status, expected)
    content = response.read()
    return json.loads(content) if response.headers.get_content_type() == 'application/json' else content


def stop(project, image, store):
    compose(project, image, store, 'stop', 'authoring', ok=False)
    compose(project, image, store, 'rm', '-f', 'authoring', ok=False)


def start(project, image, store):
    global code, opener
    if project not in projects:
        projects.append(project)
    compose(project, image, store, 'up', '-d', '--no-build', 'authoring')
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(CookieJar()))
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            assert http('/health/ready') == {'status': 'ready'}
            break
        except (OSError, AssertionError):
            time.sleep(.2)
    else:
        raise RuntimeError('Container did not become ready.')
    code = compose(project, image, store, 'exec', '-T', 'authoring', 'cat',
                   '/data/.runtime/session-code').stdout.strip()
    assert re.fullmatch('[a-f0-9]{64}', code)
    http('/api/session', {'code': code})


def clone(image, backup_volume, checkpoint, project):
    volume = project + '_authority'
    # Fresh names only; do not reuse another test's data or overwrite a backup.
    assert run(['docker', 'volume', 'inspect', volume], ok=False).returncode != 0
    run(['docker', 'volume', 'create', volume])
    volumes.append(volume)
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
         '--security-opt', 'no-new-privileges:true',
         '--mount', f'type=volume,src={backup_volume},dst=/backups,readonly',
         '--mount', f'type=volume,src={volume},dst=/data/authority', image,
         'backup', '--readonly-backup', 'yes', '--store', '/backups/' + checkpoint,
         '--out', '/data/authority/restored'])


def backup_digest(image, volume, checkpoint):
    # Closed immutable backup; hashing never opens or migrates its SQLite file.
    listing = run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
        '--mount', f'type=volume,src={volume},dst=/backups,readonly',
        '--entrypoint', 'sh', image, '-c',
        'find /backups/' + checkpoint + ' -type f -exec sha256sum {} \\;']).stdout
    lines = sorted(listing.splitlines())
    assert lines and any(line.endswith('/ledger.sqlite') for line in lines)
    assert not any(line.endswith(('-wal', '-shm', '-journal')) for line in lines)
    return hashlib.sha256(('\n'.join(lines) + '\n').encode()).hexdigest()


def verify_export(saved):
    export = http('/api/export', {'revision': saved['revision']['id']})
    with zipfile.ZipFile(io.BytesIO(http(export['download']))) as package:
        for path, artifact in saved['snapshot']['files'].items():
            assert hashlib.sha256(package.read(path)).hexdigest() == artifact['sha256']
    media = http('/api/media?path=Audio%2Fsynthetic-workbench.wav')
    assert hashlib.sha256(media).hexdigest() == saved['snapshot']['files']['Audio/synthetic-workbench.wav']['sha256']


def assert_state(saved, history):
    current = http('/api/view')
    assert current['revision'] == saved['revision']
    assert current['snapshot'] == saved['snapshot']
    assert current['documents'] == saved['documents']
    assert current['approved'] == saved['approved']
    assert http('/api/history') == history
    verify_export(current)


def edit(saved, identifier, reading):
    command = {'schema': 1, 'project': 'synthetic', 'command_id': identifier,
        'base_revision': saved['revision']['id'],
        'preimage_hash': saved['revision']['snapshot_hash'],
        'config_version': saved['snapshot']['config']['version'], 'label': identifier + ' e\u0301\U0001f642',
        'operations': [{'kind': 'set_token', 'document': 'xmlfiles/SYNTHETIC-WORKBENCH.xml',
                        'token': 'w-1', 'fields': {'nform': reading}}]}
    http('/api/command', command)
    current = http('/api/view')
    assert not current['approved']
    assert current['documents'][0]['tokens'][0]['original'] == saved['documents'][0]['tokens'][0]['original']
    assert http('/api/command', command)['id'] == current['revision']['id']
    http('/api/review', {'revision': current['revision']['id'],
        'snapshot_hash': current['revision']['snapshot_hash'], 'decision': 'approved',
        'note': 'Synthetic cross-version persistence only'})
    return http('/api/view'), command


images = []
for tag in (args.old_image, args.new_image):
    inspected = json.loads(run(['docker', 'image', 'inspect', tag]).stdout)[0]
    labels = inspected['Config']['Labels']
    assert inspected['Config']['User'] == '10001:10001'
    assert re.fullmatch('[a-f0-9]{40}', labels['org.opencontainers.image.revision'])
    images.append({'tag': tag, 'image_id': inspected['Id'], 'architecture': inspected['Architecture'],
                   'source_commit': labels['org.opencontainers.image.revision'],
                   'version': labels['org.opencontainers.image.version']})
assert images[0]['version'] != images[1]['version'], 'Different application versions required.'
assert images[0]['architecture'] == images[1]['architecture']
old, new = (image['image_id'] for image in images)
seed, upgrade, compatibility, rollback = (prefix + suffix for suffix in ('-seed', '-new', '-compat', '-rollback'))
authority = '/data/authority'
restored = authority + '/restored'
try:
    projects.append(seed)
    compose(seed, old, authority, 'run', '--rm', '--no-deps', 'tools', 'init-demo')
    start(seed, old, authority)
    before, stale = edit(http('/api/view'), 'before-upgrade', 'Old version e\u0301\U0001f642')
    assert before['revision']['id'] == 2
    old_history = http('/api/history')
    verify_export(before)
    compose(seed, old, authority, 'run', '--rm', '--no-deps', 'tools', 'backup',
            '--store', authority, '--out', '/backups/pre-upgrade')
    stop(seed, old, authority)
    pre_digest = backup_digest(old, seed + '_backups', 'pre-upgrade')

    clone(new, seed + '_backups', 'pre-upgrade', upgrade)
    start(upgrade, new, restored)
    assert_state(before, old_history)
    engine = json.loads(compose(upgrade, new, restored, 'run', '--rm', '--no-deps',
        'tools', 'check', '--store', restored).stdout)['sqlite_version']
    assert engine == '3.53.2'
    # Old receipt remains idempotent across the image transition.
    assert http('/api/command', stale)['id'] == 2
    after, current_command = edit(before, 'after-upgrade', 'New version e\u0301\U0001f642')
    assert after['revision']['id'] == 3
    assert http('/api/command', {**stale, 'command_id': 'new-stale-attempt'}, expected=409)['error']
    new_history = http('/api/history')
    assert len(new_history) == len(old_history) + 1
    verify_export(after)
    old_code = code
    stop(upgrade, new, restored)
    start(upgrade, new, restored)
    assert code != old_code
    assert_state(after, new_history)
    assert http('/api/command', current_command)['id'] == 3
    compose(upgrade, new, restored, 'run', '--rm', '--no-deps', 'tools', 'backup',
            '--store', restored, '--out', '/backups/post-upgrade')
    stop(upgrade, new, restored)
    post_digest = backup_digest(new, upgrade + '_backups', 'post-upgrade')

    # Prove the exact two schema-2 versions can read this new history on a clone.
    clone(old, upgrade + '_backups', 'post-upgrade', compatibility)
    start(compatibility, old, restored)
    assert_state(after, new_history)
    stop(compatibility, old, restored)

    # Conservative rollback restores the retained old image/pre-upgrade data pair.
    clone(old, seed + '_backups', 'pre-upgrade', rollback)
    start(rollback, old, restored)
    assert_state(before, old_history)
    stop(rollback, old, restored)
    start(seed, old, authority)
    assert_state(before, old_history)
    stop(seed, old, authority)
    assert pre_digest == backup_digest(old, seed + '_backups', 'pre-upgrade')
    assert post_digest == backup_digest(new, upgrade + '_backups', 'post-upgrade')
    volumes.extend(project + suffix for project in projects for suffix in ('_runtime',))
    volumes.extend([seed + '_authority', seed + '_backups', upgrade + '_backups'])
    evidence = {'images': images, 'schema': 2, 'new_sqlite_version': engine, 'project_prefix': prefix,
        'old_revision': before['revision'], 'new_revision': after['revision'],
        'checks': {'upgrade_preserves_exact_history_review_artifacts': True,
                   'new_edit_review_idempotency_stale_rejection': True,
                   'restart_rotates_session_preserves_new_history': True,
                   'old_image_reads_new_schema2_clone': True,
                   'rollback_retained_old_image_and_preupgrade_backup': True,
                   'original_old_authority_preserved': True, 'backup_sources_byte_unchanged': True,
                   'complete_exports_media_hashes': True},
        'preupgrade_backup_digest': pre_digest, 'postupgrade_backup_digest': post_digest,
        'volumes_retained': sorted(set(volumes)),
        'limits': ['Synthetic-only exact versions, schema 2', 'No arbitrary future-schema downgrade',
                   'No native Pi or physical power-loss proof']}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    print(json.dumps(evidence, indent=2))
finally:
    for project in projects:
        stop(project, old if project != upgrade else new, authority if project == seed else restored)
