# Changelog

All notable changes to Agent Relay will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.20] - 2026-01-26

### Added
- Introduced the `@agent-relay/mcp` package for Model Context Protocol (MCP) server support with a one-command installer.
- MCP tools for agents: `relay_send`, `relay_inbox`, `relay_who`, `relay_spawn`, `relay_release`, `relay_status`.
- MCP resources for state inspection: `relay://agents`, `relay://inbox`, `relay://project`.
- Automatic socket discovery with cloud workspace support and JSONC editor configuration preservation.
- First-class channels and direct messages, including unified threading models across DMs and channels.
- Workspace-scoped provider credentials for better isolation across workspaces.
- Mega coordinator command and additional agent profiles for multi-project coordination.
- Workspace persistence across container restarts and dynamic repository management.
- Force-update workspaces GitHub workflow for operational recovery.
- Turborepo build system integration for parallelized builds.
- Rust-based relay-pty core with TypeScript orchestrator and infrastructure tests.

### Fixed
- Direct message and channel message routing issues (delivery, duplication, and visibility).
- Workspace selector visibility, workspace proxy query parameter handling, and workspace change handling.
- Spawn timing race conditions that could drop messages before agent registration.
- Duplicate terminal "Connected - Interactive Mode" messages and relay-pty injection reliability issues.
- Cloud routing issues for channel messages, queue monitor stuck messages, and cloud sync timeouts.
- Dashboard UI bugs: mobile scrolling, agent list labeling, message attribution, and markdown rendering consistency.
- CI/build issues including Turbo/TypeScript errors and publish errors.
- GitHub auth fallback handling and GH_TOKEN injection for spawned agents.

### Changed
- Updated main CLI to include MCP commands via dynamic import.
- Consolidated sync messaging protocol with `[await]`/ACK tracking and model selection/mapping logic.
- Improved xterm viewport stability on mobile devices and standardized markdown rendering across views.
- Updated pricing information and clarified agent roles (devops vs infrastructure).

### Infrastructure & Refactors
- Cloud link logic with fallback mechanisms, migrations, and workspace deployment fixes.
- Daemon-based spawning with dashboard disabled by default plus enhanced spawn diagnostics.
- WebSocket ping/pong keepalive for main and bridge connections.
- Workspace namespacing for inbox paths and better state/continuity parsing.
- Custom GitHub credential helper with improved token fetch retry logic.
- Updated container entrypoint commands and deployment workflow fixes.
- Added `/api/bridge` endpoint for cloud server routing.

### Documentation
- Documented multi-server architecture, agent CLI patterns, and competitive analysis updates.
- Added CLI auth testing guide and updated TASKS/protocol guidance for relay-first communication.

### Breaking Changes
- None noted for this release.
