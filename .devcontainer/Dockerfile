FROM node:24.19.0-trixie-slim@sha256:ab3eebe934147fee049b5eb83c570f68c849a13c930bdfa482de99fcdfa3b3de AS node-toolchain

RUN npm install --global npm@12.0.2 \
    && rm -rf -- /root/.npm

FROM docker:29.7.2-cli@sha256:3f4743208d2338c934d7b8bcfbe1bb54c0b2355c510ad5e0f31c0c4a54bd704e AS docker-toolchain

FROM mcr.microsoft.com/devcontainers/base:2-trixie@sha256:1f851004adcd3dff3776b4a1da86727cf52280b0fdc9d5b0568c9c7d74274286

COPY --from=node-toolchain /usr/local/bin/node /usr/local/bin/node
COPY --from=node-toolchain /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=docker-toolchain /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-toolchain /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install --yes --no-install-recommends \
        chromium \
        git \
        jq \
        logrotate \
        openssh-client \
        python3-venv \
        socat \
        xauth \
        xvfb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
