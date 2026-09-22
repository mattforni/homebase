# The Retro Runner (ATE-471). A Cloud Run Job image: the entrypoint
# pulls the week from Strava, Gmail, and HubSpot with curl, then headless
# Claude Code writes the retrospective from those files and Resend delivers it.
# Nothing here writes back to the world except the rotated Strava refresh
# token, which goes to the vault.

# The email renderer, built in its own stage: the three runner pages as React
# over the shared @atelic-action/ui component library, bundled by esbuild into
# one CommonJS file. CommonJS and not ESM on purpose, because the ESM bundle
# dies here at runtime on "Dynamic require of util is not supported". Only that
# one file is copied forward, so the final image gains no node_modules.
FROM node:20-slim AS email
WORKDIR /email
COPY email/ /email/
RUN npm ci && npm run build

FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl jq tzdata git openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Claude Code, pinned so a rebuild is a deliberate upgrade.
ARG CLAUDE_CODE_VERSION=2.1.247
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"

# Non root, its own home so Claude Code has a writable config dir.
RUN useradd --create-home --shell /bin/bash runner
USER runner
WORKDIR /home/runner

COPY --chown=runner:runner entrypoint.sh /home/runner/entrypoint.sh
COPY --chown=runner:runner prompt.md /home/runner/prompt.md
# The shared library: runner.sh for the entrypoint, the pull scripts beside it.
COPY --chown=runner:runner lib/ /home/runner/lib/
# The bundled renderer, at the first place runner.sh looks for it, and the
# only renderer in the image since the jq one retired (ATE-563).
COPY --from=email --chown=runner:runner /email/dist/render.cjs /home/runner/lib/render.cjs
RUN chmod +x /home/runner/entrypoint.sh

# GitHub's published ed25519 host key, pinned so the Eudy clone never trusts
# on first use. Rotate from https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
RUN mkdir -p /home/runner/.ssh && chmod 700 /home/runner/.ssh \
    && echo "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" > /home/runner/.ssh/known_hosts

ENV TZ=America/Denver
ENTRYPOINT ["/home/runner/entrypoint.sh"]
