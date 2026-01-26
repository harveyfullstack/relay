# CLI Auth Tester - Manual interactive testing environment
# Based on relay-workspace:base which has all CLIs pre-installed

FROM ghcr.io/agentworkforce/relay-workspace:base

# Switch to root for setup
USER root

# Install additional debugging tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    netcat-openbsd \
    jq \
    less \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Create app directory for scripts
RUN mkdir -p /app/scripts /app/src && chown -R workspace:workspace /app

# Copy scripts and source
COPY --chown=workspace:workspace scripts/ /app/scripts/
COPY --chown=workspace:workspace src/ /app/src/

# Make scripts executable
RUN chmod +x /app/scripts/*.sh

# Add scripts to PATH
ENV PATH="/app/scripts:${PATH}"

# Switch back to workspace user
USER workspace

# Set working directory
WORKDIR /home/workspace

# Default to interactive shell
CMD ["/bin/bash"]
