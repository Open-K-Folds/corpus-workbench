# Uses the installed BuildKit frontend; all external base manifests are pinned.
ARG RUST_IMAGE=rust:1.90.0-slim-bookworm@sha256:64232e656c058f4468e8d024e990acff04f0fd5a5c0a88a574dc37773d7325c9
ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG RUNTIME_IMAGE=debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a
FROM ${NODE_IMAGE} AS ui-build
WORKDIR /source/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY ui/ ./
RUN npm run build

FROM ${RUNTIME_IMAGE} AS runtime-base
# Historical, signed APT indexes make the complete runtime refresh reproducible.
# HTTP transport is protected by Debian archive signatures/package hashes; this
# slim base has no TLS certificate bundle. Never allow unsigned/trusted=yes repos.
RUN printf 'Types: deb\nURIs: http://snapshot.debian.org/archive/debian/20261004T000000Z\nSuites: trixie trixie-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\nCheck-Valid-Until: no\n\nTypes: deb\nURIs: http://snapshot.debian.org/archive/debian-security/20261004T000000Z\nSuites: trixie-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\nCheck-Valid-Until: no\n' > /etc/apt/sources.list.d/debian.sources && \
    apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --with-new-pkgs --no-install-recommends && \
    test "$(apt-get -s upgrade --with-new-pkgs | sed -n 's/^\([0-9]*\) upgraded, \([0-9]*\) newly installed, \([0-9]*\) to remove and \([0-9]*\) not upgraded\..*/\1 \2 \3 \4/p')" = '0 0 0 0' && \
    rm -rf /var/lib/apt/lists/* && \
    find /usr/bin /usr/sbin -type f \( -perm -4000 -o -perm -2000 \) -exec chmod a-s {} +

FROM runtime-base AS os-inventory
RUN mkdir -p /inventory/notices && dpkg-query -W -f='${binary:Package}\t${Version}\t${Architecture}\n' > /inventory/packages.tsv && \
    for file in /usr/share/doc/*/copyright; do [ ! -f "$file" ] || cp --parents "$file" /inventory/notices; done

FROM ${RUST_IMAGE} AS native-build
# Signed, date-pinned Debian indexes; the runtime receives no build tools.
RUN printf 'Types: deb\nURIs: https://snapshot.debian.org/archive/debian/20260918T000000Z\nSuites: bookworm bookworm-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\nCheck-Valid-Until: no\n' > /etc/apt/sources.list.d/debian.sources && \
    apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY src/ src/
COPY assets/ assets/
COPY tests/ tests/
RUN cargo build --locked --release && cargo metadata --locked --filter-platform "$(rustc -vV | sed -n 's/^host: //p')" --format-version 1 > /cargo-metadata.json
FROM native-build AS native-test
COPY scripts/runtime-contracts.py scripts/runtime-contracts.py
RUN cargo fmt --all --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked && \
    cargo test --locked --no-run --message-format=json > /native-tests.jsonl && \
    python3 scripts/runtime-contracts.py --manifest /native-tests.jsonl --out /runtime-contracts
ARG SOURCE_COMMIT=working-tree
ARG VERSION=0.2.0-dev.9
LABEL org.opencontainers.image.revision="$SOURCE_COMMIT" org.opencontainers.image.version="$VERSION"

# Execute the existing compiled contracts with the actual production OS/loader.
# This separate test image is never copied into the production image.
FROM runtime-base AS runtime-contracts
ARG SOURCE_COMMIT=working-tree
ARG VERSION=0.2.0-dev.9
LABEL org.opencontainers.image.revision="$SOURCE_COMMIT" org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.description="Existing compiled native contracts under the production OS and loader"
COPY --from=native-test /runtime-contracts/ /
USER 10001:10001
WORKDIR /tmp
ENTRYPOINT ["/run-runtime-contracts.sh"]

FROM native-build AS package-build
ARG SOURCE_COMMIT=working-tree
RUN rustup component add rust-docs --toolchain 1.90.0
COPY --from=ui-build /source/ui/ ui/
COPY --from=os-inventory /inventory/ /os-inventory/
COPY . /source/
RUN mkdir -p /package && python3 scripts/prepare-synthetic.py --out /package/synthetic && \
    python3 scripts/container-inventory.py --commit "$SOURCE_COMMIT" --out /package --cargo /cargo-metadata.json --os /os-inventory && \
    find /package -type d -exec chmod 0755 {} + && find /package -type f -exec chmod 0644 {} + && chmod 0755 /package/bin/corpus-workbench

FROM runtime-base AS runtime
ARG SOURCE_COMMIT=working-tree
ARG VERSION=0.2.0-dev.9
ARG TARGETPLATFORM
LABEL org.opencontainers.image.title="Corpus Workbench" \
      org.opencontainers.image.description="Native corpus authoring; synthetic demonstration only" \
      org.opencontainers.image.source="https://github.com/Open-K-Folds/corpus-workbench" \
      org.opencontainers.image.revision="$SOURCE_COMMIT" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.licenses="GPL-3.0-or-later" \
      org.opencontainers.image.platform="$TARGETPLATFORM"
RUN groupadd --gid 10001 workbench && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /data workbench && \
    mkdir -p /data/authority /data/.runtime /backups && chown -R 10001:10001 /data /backups && chmod 700 /data /data/authority /data/.runtime /backups
COPY --from=package-build /package/ /opt/workbench/
COPY --from=native-build /source/target/release/corpus-workbench /usr/local/bin/corpus-workbench
COPY --chmod=0555 containers/entrypoint.sh /usr/local/bin/workbench-entrypoint
USER 10001:10001
WORKDIR /data
ENV WB_PORT=18920 WB_PROJECT=synthetic WB_STORE=/data/authority
EXPOSE 18920
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 CMD ["workbench-entrypoint", "health"]
ENTRYPOINT ["workbench-entrypoint"]
CMD ["serve-workbench"]
