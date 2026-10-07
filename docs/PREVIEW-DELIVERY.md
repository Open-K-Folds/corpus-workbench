# Integrated-main engineering preview delivery

The additive `v0.2.0-dev.11` delivery targets reviewed application commit
`789038771c88ff28430912c1be1c710bd818fd12`. Its version remains the source version;
GitHub marks it as a prerelease. The earlier `v0.1.0-preview.1` stays immutable.
Check the release manifest for final asset checksums, registry digests and actual
verification results before choosing an artifact.

The publication workflow follows the preserved one-time GHCR workflow, using its
existing repository Actions token with `contents: read` and `packages: write`.
It runs only on the dedicated delivery branch, builds the fixed reviewed commit
on native Linux amd64/ARM64 runners, executes production-loader contracts and
the isolated browser/persistence journey, and retains each qualified Docker
archive, SPDX inventory and verification result before attempting publication.
Registry tags must be absent under authenticated access; inspection errors do not
prove absence. Existing tags are never replaced. The combined index references
the exact tested architecture digests. It records anonymous access separately
and never changes package visibility, requests credentials or changes permissions.
Actions artifacts last 30 days; release assets are the durable delivery.

Download the Windows x86-64 ZIP and follow `PACKAGE.md`; Python 3.11+ generates
the explicitly synthetic demo tone. Extract to a fresh directory, start with
`powershell -File scripts/start-workbench.ps1 -Binary bin/corpus-workbench.exe`,
then open `Open-Workbench.cmd`. Use protected, separate authorities for real data.

For containers, use the release's exact registry digest when authenticated GHCR
access is available. Otherwise verify the Docker archive checksum from the release
and load the archive for your architecture:

```sh
docker load --input corpus-workbench-0.2.0-dev.11-linux-amd64.docker.tar.gz
```

The archive retains a version/source/architecture tag; inspect its OCI revision
and use the immutable image ID recorded in the manifest as `WB_IMAGE`. Obtain
`compose.yaml` from the release's corresponding source archive. Follow
[CONTAINERS.md](CONTAINERS.md) with a fresh Compose project and unused loopback
port. Initialize the synthetic authority explicitly with `tools init-demo`, start
`authoring` with `--no-build`, and open the private runtime launcher. Stop only
that project's containers; retain authority, runtime and backup volumes.

Both native runner architectures can be built and exercised without qualifying
physical Raspberry Pi/CM5 hardware, 4 GB limits, power loss, language accuracy or
production operations. Optional Semantica compiler/runtime remains separately
supplied and is not bundled. Synthetic qualification grants no corpus rights.
