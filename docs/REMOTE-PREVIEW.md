# Remote Workbench preview

Open `https://<preview-host>/open` and sign in with the account allowed by Cloudflare Access. The browser can play the recording, follow its transcript and save edits in the preview's own SQLite authority. The desktop project keeps its own revision history. Local-model inference and other Electron bridge features require the desktop Workbench.

## Configure the Windows host

Use the main checkout, Docker Desktop with Linux containers, Docker Compose with `watch` support, Node 24 and an existing Cloudflare Tunnel connector. Run the PowerShell commands below from the repository root. The connector and both preview services must share the external Docker network named by `WB_EDGE_NETWORK`.

Create a private env file outside the repository. The example uses `workbench.example.org`. Substitute your hostname, project ID, Access team name and application audience.

```dotenv
WB_PUBLIC_ORIGIN=https://workbench.example.org
WB_PROJECT=your-project-id
WB_STORE=/data/authority/workspace
WB_PORT=18920
WB_EDGE_NETWORK=cloudflare_edge
WB_ACCESS_TEAM=your-team-name
WB_ACCESS_AUD=<64-hex-character-application-audience>
```

```powershell
$config = Join-Path $env:LOCALAPPDATA 'CorpusWorkbench/remote-preview/compose.env'
$dc = @('compose','--env-file',$config,'-f','compose.yaml','-f','compose.preview.yaml')
docker @dc config --quiet
docker @dc build authoring login
npm.cmd ci --prefix ui
$env:VITE_WB_REMOTE_PREVIEW = '1'
Push-Location ui
try { node.exe node_modules/vite/bin/vite.js build --outDir ../.runtime/remote-preview/ui --emptyOutDir }
finally { Pop-Location }
```

The initial frontend build creates the directory that Compose mounts read-only at `/opt/workbench/ui`. The preview writes subsequent builds to the same directory. Desktop packaging uses `ui/dist`.

## Seed an independent corpus

Use a verified native backup to carry the saved head, history and media into the new preview. Choose a fresh, private destination with enough space for the corpus. The following example assumes the Windows backend from this checkout has been built.

```powershell
$native = (Resolve-Path 'target/release/corpus-workbench.exe').Path
$source = 'C:\path\to\desktop-authority'
$seed = 'C:\path\to\private-backups\new-preview-seed'
& $native projects --store $source
if ($LASTEXITCODE -ne 0) { throw 'Select the existing desktop authority.' }
& $native backup --store $source --out $seed
if ($LASTEXITCODE -ne 0) { throw 'Backup failed.' }
& $native check --readonly-backup yes --store $seed
if ($LASTEXITCODE -ne 0) { throw 'Backup verification failed.' }
docker @dc run --rm --volume "${seed}:/seed:ro" tools backup --readonly-backup yes --store /seed --out /data/authority/workspace
docker @dc run --rm tools check --store /data/authority/workspace
docker @dc run --rm tools projects --store /data/authority/workspace
```

Confirm that `WB_PROJECT` matches a project ID in the restored store. The backup command requires a fresh output directory. For an already initialized preview, run the last two checks and keep the existing authority. To compare the copy with the source, inspect the same project's saved revision and snapshot hash using `view` on both stores.

## Protect and route the public hostname

Create a **self-hosted Access application for the entire hostname**. Its Allow policy should match the owner's specific identity. Use that application's audience and the team's short name in both the env file and the tunnel. Configure the application before pointing the hostname at the tunnel. [Cloudflare self-hosted application setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) · [Finding the application audience](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

On the existing tunnel, insert these two public-hostname ingress rules in order, ahead of the tunnel's final catch-all. For a remotely managed tunnel, apply them in its managed configuration. Preserve the connector's other hostnames and its final catch-all. Point the preview hostname's proxied DNS record at this tunnel.

```yaml
- hostname: workbench.example.org
  path: ^/open$
  service: http://corpus-workbench-preview-login:8080
  originRequest:
    access:
      required: true
      teamName: your-team-name
      audTag: [your-application-audience]
- hostname: workbench.example.org
  service: http://corpus-workbench-preview:18920
  originRequest:
    access:
      required: true
      teamName: your-team-name
      audTag: [your-application-audience]
```

The second rule matches every other path on this hostname, including API and audio requests. Both rules require the connector to validate the Access JWT. The login service also verifies the signature, issuer, audience and expiry. It reads the current Workbench session code from a read-only volume and returns it to the authorized browser as a Secure, HttpOnly cookie before redirecting to `/`. The address contains no credential. [Cloudflare tunnel origin parameters](https://developers.cloudflare.com/tunnel/reference/origin-parameters/)

## Start, verify and update

```powershell
docker @dc up -d --no-build --wait authoring login
docker @dc ps
curl.exe --fail --silent http://127.0.0.1:18920/health/ready
.\scripts\remote-preview.ps1 Start -EnvFile $config -AtLogon
.\scripts\remote-preview.ps1 Status
```

Expect local readiness to return HTTP 200 and the supervisor, frontend and backend watchers to report `True`. From a private browser window, open `https://<preview-host>/open`. Confirm Access requests sign-in, then verify the expected project and saved revision in the authorized session. An unauthenticated request to the public API should reach Access before receiving any corpus data.

The frontend watcher rebuilds changed UI files from this checkout. Open tabs check for a new build on return to the tab and once per minute. When **Update ready** appears, finish or save any edit and choose **Refresh**. Compose rebuilds the authoring and login services when their watched sources change. A backend restart rotates the Workbench session, so visit `/open` again if prompted. After a frontend dependency change, rerun `npm.cmd ci --prefix ui` and restart the watchers.

`-AtLogon` registers the watcher supervisor for the current Windows user. Omit it for a session-only watcher. The script remembers the selected env file in `.runtime/remote-preview`. That directory also contains the watcher logs. To stop updates and remove this checkout's logon entry, run `.\scripts\remote-preview.ps1 Stop`. To stop the site as well, run `docker @dc stop login authoring`.

## Back up and restore preview edits

```powershell
$snapshot = 'preview-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
docker @dc run --rm tools backup --store /data/authority/workspace --out "/backups/$snapshot"
docker @dc run --rm tools check --readonly-backup yes --store "/backups/$snapshot"
```

The Compose project's `authority`, `runtime` and `backups` volumes persist across service recreation and ordinary stops. Keep those volumes and the Compose project name when updating. The backup volume resides on the same Docker host. For recovery from host loss, keep a verified copy on separate private storage.

To restore a saved backup, mount it read-only as `/seed` in a **fresh authority volume**, then run the seed and check commands above. Keep the original authority until you verify the restored head and recording. Edits made in the desktop project after the original backup belong to that desktop store. [Native backup and restore details](CONTAINERS.md)
