# Open an existing private Windows preview

A workbench service listens on the Windows host's `127.0.0.1`. From a Mac, use
your existing authorized private remote-desktop connection to that Windows host.
Open the preview inside the remote Windows desktop. A Mac's own localhost and
Windows filesystem paths do not point to this service.

The service creates a protected `.runtime/Open-Workbench.html` containing its
temporary session capability. From the checkout, the following user-invoked
helper checks loopback readiness and opens that file:

```powershell
powershell -NoProfile -File scripts/open-workbench.ps1
```

For a preview running from a separate private directory:

```powershell
powershell -NoProfile -File scripts/open-workbench.ps1 -Launcher "C:\PrivatePreview\.runtime\Open-Workbench.html"
```

Add `-CheckOnly` to verify readiness without opening a browser. The helper prints
no session capability and does not start/restart services, create a tunnel,
change firewall settings or configure remote access. Keep the generated launcher
private; a new service start changes its capability. If the existing remote
connection is unavailable, resolve that access step before opening the preview.
