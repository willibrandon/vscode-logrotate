# node:24.19.0-trixie-slim
FROM node@sha256:bde0dae02f2b12d2bce5ee72b2432f0e511767b7b2dc4dd3b064df11ae422fee AS node-toolchain

RUN npm install --global npm@12.0.2 \
    && rm -rf -- /root/.npm

# docker:29.7.2-cli
FROM docker@sha256:000bb62ff495f986c9f5578eb67cc2cb98b91138eda81d7762d5371eb8a497fe AS docker-toolchain

# mcr.microsoft.com/devcontainers/base:2-trixie
FROM mcr.microsoft.com/devcontainers/base@sha256:025b74bb5f7ac53edd77e01aa7188c359aab100e23a2f6220bde50bbb9fd31dd

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
