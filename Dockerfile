# syntax=docker/dockerfile:1

# Pin to the same Bun release CI tests against (.github/workflows/ci.yml).
# The `-slim` variant is Debian, not Alpine, so glibc-linked native deps
# (postgres, drizzle) behave the same here as in CI.
FROM oven/bun:1.4.4-slim AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build

# c2patool has no official arm64 Linux build, so it's amd64-only; on other
# architectures this stage installs a stub that fails loudly instead of
# silently skipping content credentials.
FROM debian:bookworm-slim AS c2patool
ARG TARGETARCH
ARG C2PATOOL_VERSION=0.27.22
ARG C2PATOOL_SHA256=6f138ad53da1a62f1cd6ee71c60727efa27d13b811f4c0ea8c2a8528968b358b
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    if [ "$TARGETARCH" = "amd64" ]; then \
      curl -fsSL -o /tmp/c2patool.tar.gz \
        "https://github.com/contentauth/c2pa-rs/releases/download/c2patool-v${C2PATOOL_VERSION}/c2patool-v${C2PATOOL_VERSION}-x86_64-unknown-linux-gnu.tar.gz" && \
      echo "${C2PATOOL_SHA256}  /tmp/c2patool.tar.gz" | sha256sum -c - && \
      tar -xzf /tmp/c2patool.tar.gz -C /tmp && \
      install -m 0755 /tmp/c2patool/c2patool /usr/local/bin/c2patool && \
      rm -rf /tmp/c2patool /tmp/c2patool.tar.gz; \
    else \
      printf '#!/bin/sh\necho "c2patool is only packaged on linux/amd64 (built for %s)" >&2\nexit 1\n' "$TARGETARCH" \
        > /usr/local/bin/c2patool && \
      chmod +x /usr/local/bin/c2patool; \
    fi

FROM oven/bun:1.4.4-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system studio \
    && useradd --system --no-create-home --gid studio --shell /usr/sbin/nologin studio \
    && mkdir -p /data \
    && chown studio:studio /data

COPY --from=c2patool /usr/local/bin/c2patool /usr/local/bin/c2patool

WORKDIR /app
COPY --from=build --chown=studio:studio /app /app

ENV NODE_ENV=production
USER studio
EXPOSE 3000
VOLUME ["/data"]

CMD ["bun", "run", "apps/server/src/index.ts"]
