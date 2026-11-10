# syntax=docker/dockerfile:1.7
# Postgres with WAL-G for continuous WAL archiving and point-in-time recovery (P9; RPO ≤ 24 h, in
# practice ≤ archive_timeout = 60 s). The WAL-G release is pinned by version and SHA-256.
FROM postgres:17.6
ARG WALG_VERSION=v3.0.9
ADD --checksum=sha256:444ce216230c254edef803e098a59a1746806da3e0d55671d7b0f0082db14ef4 \
    https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-24.04-amd64.tar.gz /tmp/walg.tar.gz
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libsodium23 && \
    tar -xzf /tmp/walg.tar.gz -C /tmp && mv /tmp/wal-g-pg-24.04-amd64 /usr/local/bin/wal-g && \
    chmod 755 /usr/local/bin/wal-g && rm -rf /tmp/walg.tar.gz /var/lib/apt/lists/*
COPY infrastructure/production/postgres/init-roles.sh /docker-entrypoint-initdb.d/10-roles.sh
COPY infrastructure/production/backup/backup-loop.sh /usr/local/bin/backup-loop.sh
COPY infrastructure/production/backup/restore.sh /usr/local/bin/restore.sh
