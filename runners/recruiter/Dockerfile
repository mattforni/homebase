# The Recruiter Runner. A Cloud Run Job image: the entrypoint puts Eudaimonia in
# place over a read only deploy key, then headless Claude Code runs the
# recruiter agent against the job sources and Resend delivers the board.
# Nothing here writes to the world.
#
# Built from the staged context bin/runner/lib.sh assembles, which is this
# directory plus lib/runner.sh and agents/recruiter.md copied in from the
# repo, since a Docker context cannot reach above its own root.
FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl jq tzdata git openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Claude Code, pinned so a rebuild is a deliberate upgrade.
ARG CLAUDE_CODE_VERSION=2.1.247
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"

# The pinole CLI, the entrypoint's route to the Pinole work API (the postings
# ledger it dedupes against and upserts into, the activity it logs). Nothing is
# published to npm: the public repo is the package, dist/ is committed, and a
# tag is a release, so the install is a git spec pinned to a tag for the same
# reason Claude Code is pinned above. Public, so the build needs no token.
ARG PINOLE_CLI_REF=v0.1.0
RUN npm install -g "github:atelic-action/pinole-cli#${PINOLE_CLI_REF}"

# Non root, its own home so Claude Code has a writable config dir.
RUN useradd --create-home --shell /bin/bash runner
USER runner
WORKDIR /home/runner

COPY --chown=runner:runner entrypoint.sh /home/runner/entrypoint.sh
COPY --chown=runner:runner prompt.md /home/runner/prompt.md
COPY --chown=runner:runner render.jq /home/runner/render.jq
# The pull side: the listing table and the deny list (the page reducer,
# text.mjs, ships with lib/).
COPY --chown=runner:runner listings.jq /home/runner/listings.jq
COPY --chown=runner:runner deny.txt /home/runner/deny.txt
# The shared library: runner.sh for the entrypoint, email.jq for the renderer.
COPY --chown=runner:runner lib/ /home/runner/lib/
# The brief: the same agent definition the laptop runs, found where Claude Code
# looks for user level agents.
COPY --chown=runner:runner agents/recruiter.md /home/runner/.claude/agents/recruiter.md
RUN chmod +x /home/runner/entrypoint.sh

# GitHub's published ed25519 host key, pinned so the Eudy clone never trusts
# on first use. Rotate from https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
RUN mkdir -p /home/runner/.ssh && chmod 700 /home/runner/.ssh \
    && echo "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" > /home/runner/.ssh/known_hosts

ENV TZ=America/Denver
ENTRYPOINT ["/home/runner/entrypoint.sh"]
