"""Exercise a fresh, synthetic-only Compose authority; retain its named volumes.

Stops only this invocation's containers. Never removes volumes or touches an
existing Compose project. Authentication capabilities stay in process memory.
"""
import argparse
import hashlib
import http.cookiejar
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
parser.add_argument('--image', required=True)
parser.add_argument('--port', type=int, default=18920)
parser.add_argument('--out', required=True, type=Path)
parser.add_argument('--browser', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
if args.out.exists():
    raise SystemExit('Evidence output exists; choose a fresh path.')
if not 1024 <= args.port <= 65535:
    raise SystemExit('An unprivileged port is required.')
probe = socket.socket()
probe.bind(('127.0.0.1', args.port))
probe.close()
project = 'wbqa-' + uuid.uuid4().hex[:12]
env = {**os.environ, 'WB_IMAGE': args.image, 'WB_PORT': str(args.port), 'WB_PROJECT': 'synthetic', 'WB_STORE': '/data/authority'}
created = []
compose = ['docker', 'compose', '-f', str(root / 'compose.yaml'), '-p', project]
evidence = {'project': project, 'image': args.image, 'port': args.port, 'checks': {}, 'volumes_retained': True}

def run(arguments, ok=True, environment=None):
    result = subprocess.run(arguments, cwd=root, env=environment or env, capture_output=True, text=True, encoding='utf-8')
    if ok and result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    return result

def dc(*arguments, ok=True):
    return run(compose + list(arguments), ok=ok)

base = f'http://127.0.0.1:{args.port}'
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
code = ''

def http(path, data=None, expected=200, origin=True, authenticated=True):
    headers = {}
    if data is not None:
        headers = {'Content-Type': 'application/json', 'X-WB-CSRF': code}
        if origin:
            headers['Origin'] = base
    request = urllib.request.Request(base + path, data=None if data is None else json.dumps(data).encode(), headers=headers)
    try:
        response = (opener.open(request, timeout=5) if authenticated else urllib.request.urlopen(request, timeout=5))
    except urllib.error.HTTPError as error:
        response = error
    assert response.status == expected, (path, response.status, expected)
    content = response.read()
    return json.loads(content) if response.headers.get_content_type() == 'application/json' else content

def wait_ready():
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            assert http('/health/ready', authenticated=False) == {'status': 'ready'}
            return
        except (OSError, AssertionError):
            time.sleep(.2)
    raise RuntimeError('Container did not become ready.')

def login():
    global code
    code = dc('exec', '-T', 'authoring', 'cat', '/data/.runtime/session-code').stdout.strip()
    assert re.fullmatch('[a-f0-9]{64}', code)
    assert http('/api/session', {'code': code})['project'] == 'synthetic'

try:
    image = json.loads(run(['docker', 'image', 'inspect', args.image]).stdout)[0]
    assert image['Config']['User'] == '10001:10001'
    # Execute the inspected immutable identity throughout, even if an input tag
    # is retargeted concurrently. Keep the caller's tag as descriptive evidence.
    args.image = image['Id']
    env['WB_IMAGE'] = args.image
    evidence['image_id'] = image['Id']
    evidence['architecture'] = image['Architecture']
    evidence['source_commit'] = image['Config']['Labels']['org.opencontainers.image.revision']
    dc('run', '--rm', '--no-deps', 'tools', 'init-demo')
    assert dc('run', '--rm', '--no-deps', 'tools', 'init-demo', ok=False).returncode != 0
    dc('up', '-d', '--no-build', 'authoring')
    wait_ready()
    container_id = dc('ps', '-q', 'authoring').stdout.strip()
    config = json.loads(run(['docker', 'inspect', container_id]).stdout)[0]
    assert config['HostConfig']['ReadonlyRootfs']
    assert config['HostConfig']['CapDrop'] == ['ALL']
    assert 'no-new-privileges:true' in config['HostConfig']['SecurityOpt']
    assert all(binding['HostIp'] == '127.0.0.1' for bindings in config['NetworkSettings']['Ports'].values() if bindings for binding in bindings)
    assert not any(mount['Destination'].endswith('docker.sock') for mount in config['Mounts'])
    assert dc('exec', '-T', 'authoring', 'id', '-u').stdout.strip() == '10001'
    assert dc('exec', '-T', 'authoring', 'sh', '-c', 'test ! -w /opt/workbench && test ! -e /var/run/docker.sock').returncode == 0
    assert dc('exec', '-T', 'authoring', 'sh', '-c', 'cd /opt/workbench && sha256sum -c SHA256SUMS').returncode == 0
    sbom = json.loads(dc('exec', '-T', 'authoring', 'cat', '/opt/workbench/SBOM.spdx.json').stdout)
    assert sbom['spdxVersion'] == 'SPDX-2.3' and len(sbom['packages']) > 80
    assert http('/api/view', expected=403, authenticated=False)['error'] == 'unauthorized session'
    login()
    initial = http('/api/view')
    assert initial['revision']['id'] == 1
    original = initial['documents'][0]['tokens'][0]['original']
    command = {'schema': 1, 'project': 'synthetic', 'command_id': 'container-edit',
        'base_revision': 1, 'preimage_hash': initial['revision']['snapshot_hash'],
        'config_version': initial['snapshot']['config']['version'], 'label': 'Synthetic container correction',
        'operations': [{'kind': 'set_token', 'document': 'xmlfiles/SYNTHETIC-WORKBENCH.xml', 'token': 'w-1', 'fields': {'nform': 'Container correction e\u0301\U0001f642'}}]}
    assert 'error' in http('/api/command', command, expected=403, origin=False)
    http('/api/command', command)
    saved = http('/api/view')
    assert saved['revision']['id'] == 2
    assert saved['documents'][0]['tokens'][0]['original'] == original
    assert http('/api/command', command)['id'] == 2
    review = {'revision': 2, 'snapshot_hash': saved['revision']['snapshot_hash'], 'decision': 'approved', 'note': 'Synthetic mechanics only'}
    http('/api/review', review)
    assert http('/api/view')['approved']
    if args.browser:
        browser_env = {**env, 'WB_CONTAINER_URL': base, 'WB_CONTAINER_CODE': code}
        run(['node', str(root / 'ui/container-browser.mjs')], environment=browser_env)
        saved = http('/api/view')
        assert saved['revision']['id'] == 4
    export = http('/api/export', {'revision': saved['revision']['id']})
    zipped = http(export['download'])
    with zipfile.ZipFile(io.BytesIO(zipped)) as package:
        assert all(path in package.namelist() for path in saved['snapshot']['files'])
        for path, artifact in saved['snapshot']['files'].items():
            assert hashlib.sha256(package.read(path)).hexdigest() == artifact['sha256']
    dc('run', '--rm', '--no-deps', 'tools', 'backup', '--store', '/data/authority', '--out', '/backups/checkpoint')
    assert dc('run', '--rm', '--no-deps', 'tools', 'backup', '--store', '/data/authority', '--out', '/backups/checkpoint', ok=False).returncode != 0
    dc('run', '--rm', '--no-deps', 'tools', 'check', '--store', '/backups/checkpoint')
    # Restore through the native verified backup path into a fresh cloned volume.
    clone = project + '-restore'
    created.append(clone)
    run(['docker', 'volume', 'create', clone])
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
         '--mount', f'type=volume,src={project}_backups,dst=/backups,readonly',
         '--mount', f'type=volume,src={clone},dst=/data/authority', args.image,
         'backup', '--readonly-backup', 'yes', '--store', '/backups/checkpoint', '--out', '/data/authority/restored'])
    restored = json.loads(run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
         '--mount', f'type=volume,src={clone},dst=/data/authority', args.image,
         'view', '--store', '/data/authority/restored', '--project', 'synthetic']).stdout)
    assert restored['revision'] == saved['revision'] and restored['snapshot'] == saved['snapshot']
    old_code = code
    dc('up', '-d', '--no-build', '--force-recreate', 'authoring')
    wait_ready()
    login()
    assert code != old_code and http('/api/view')['revision'] == saved['revision']
    # Data-compatible image recreation is tested; no cross-version downgrade claim.
    evidence['checks'] = {'non_root': True, 'read_only_root': True, 'loopback_publish': True,
        'minimal_ready': True, 'origin_session_guards': True, 'immutable_original': True,
        'idempotent_edit': True, 'review': True, 'complete_export_hashes': True,
        'verified_backup_restore': True, 'recreation_preserves_revision': True,
        'no_silent_demo_reset': True, 'sbom_components': len(sbom['packages']), 'package_checksums': True,
        'actual_browser': args.browser}
    evidence['revision'] = saved['revision']['id']
    evidence['snapshot_hash'] = saved['revision']['snapshot_hash']
    evidence['volumes'] = [project + suffix for suffix in ('_authority', '_runtime', '_backups')] + created
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    print(json.dumps(evidence, indent=2))
finally:
    dc('stop', 'authoring', ok=False)
    dc('rm', '-f', 'authoring', ok=False)
