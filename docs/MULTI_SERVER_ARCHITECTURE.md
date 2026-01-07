# Multi-Server Architecture: Current State & Vision

**Status:** Living Document
**Last Updated:** 2025-01-07
**Related:** PR #8 (Federation Proposal)

## Executive Summary

This document provides a realistic assessment of agent-relay's multi-server capabilities today and a detailed roadmap for achieving the vision of **N servers per organization, each potentially on different repos, all communicating seamlessly**.

### The Vision

```
Organization: Acme Corp (Team Plan)
├── User Alice (Server 1) → Repo: acme/frontend
├── User Bob (Server 2) → Repo: acme/backend
├── User Carol (Server 3) → Repo: acme/shared-lib
├── User Dave (Server 4) → Repo: acme/frontend (same repo, different server)
└── User Eve (Server 5) → Repo: acme/mobile
    ↓
    All agents can communicate across servers
    ↓
    Per-user billing, org-level governance
```

---

## Table of Contents

1. [Current State: What's Built Today](#1-current-state-whats-built-today)
2. [Architecture Deep Dive](#2-architecture-deep-dive)
3. [Gap Analysis](#3-gap-analysis)
4. [Target Architecture](#4-target-architecture)
5. [Implementation Roadmap](#5-implementation-roadmap)
6. [Pricing Model](#6-pricing-model)
7. [Technical Specifications](#7-technical-specifications)

---

## 1. Current State: What's Built Today

### 1.1 What Works ✅

| Capability | Implementation | File Reference |
|------------|----------------|----------------|
| **Per-user workspaces** | Workspaces are user-scoped containers | `src/cloud/db/schema.ts:workspaces` |
| **Cross-machine agent discovery** | CloudSyncService heartbeats | `src/daemon/cloud-sync.ts` |
| **Cross-machine messaging** | Via cloud API relay | `src/daemon/router.ts:560-620` |
| **Multi-project bridge** | MultiProjectClient | `src/bridge/multi-project-client.ts` |
| **Agent policy governance** | Per-workspace policies | `src/policy/agent-policy.ts` |
| **Horizontal scaling** | ScalingOrchestrator | `src/cloud/services/scaling-orchestrator.ts` |
| **Project groups** | Coordinator agents across repos | `src/cloud/db/schema.ts:projectGroups` |

### 1.2 Cross-Project Messaging (Already Works)

Agents can already message across projects using the `project:agent` format:

```
->relay:frontend:Designer <<<
Please update the login UI for the new auth flow>>>

->relay:backend:Lead <<<
API question - should we use REST or GraphQL?>>>

->relay:*:* <<<
Broadcast to ALL agents in ALL projects>>>
```

### 1.3 Current Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CURRENT ARCHITECTURE                                 │
│                                                                              │
│  LOCAL MACHINE A              LOCAL MACHINE B              CLOUD             │
│  ┌─────────────────┐         ┌─────────────────┐         ┌────────────────┐ │
│  │ Daemon (proj-a) │         │ Daemon (proj-b) │         │ Control Plane  │ │
│  │                 │         │                 │         │                │ │
│  │ ┌─────┐ ┌─────┐│         │ ┌─────┐ ┌─────┐ │         │ ┌────────────┐ │ │
│  │ │Alice│ │Bob  ││         │ │Carol│ │Dave │ │         │ │ PostgreSQL │ │ │
│  │ └──┬──┘ └──┬──┘│         │ └──┬──┘ └──┬──┘ │         │ │   + Redis  │ │ │
│  │    │       │   │         │    │       │    │         │ └─────┬──────┘ │ │
│  │ ┌──┴───────┴──┐│         │ ┌──┴───────┴───┐│         │       │        │ │
│  │ │   Router    ││         │ │    Router    ││         │ ┌─────┴──────┐ │ │
│  │ └──────┬──────┘│         │ └──────┬───────┘│         │ │  REST API  │ │ │
│  │        │       │         │        │        │         │ │ /daemons/* │ │ │
│  │ ┌──────┴──────┐│         │ ┌──────┴───────┐│         │ │ /messages/*│ │ │
│  │ │CloudSyncSvc ││         │ │CloudSyncSvc  ││         │ └─────┬──────┘ │ │
│  │ └──────┬──────┘│         │ └──────┬───────┘│         │       │        │ │
│  └────────┼───────┘         └────────┼────────┘         └───────┼────────┘ │
│           │                          │                          │          │
│           └──────────────────────────┴──────────────────────────┘          │
│                              Heartbeat + Relay                              │
│                              (30s interval)                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.4 Current Limitations ⚠️

| Limitation | Impact | Priority |
|------------|--------|----------|
| **Cloud-mediated routing** | ~100-300ms latency per cross-machine message | High |
| **No P2P connections** | All cross-machine traffic through cloud API | High |
| **User-centric billing** | No org-level plans or team billing | Medium |
| **Single repo per workspace** | Can't run multi-repo in one daemon | Medium |
| **No global agent registry** | Agent name collisions possible across machines | Medium |
| **Limited offline queuing** | Messages lost if cloud unavailable | Low |

---

## 2. Architecture Deep Dive

### 2.1 Database Schema (Current)

```typescript
// Users & Auth
users {
  id: UUID,
  githubId: TEXT UNIQUE,
  plan: 'free' | 'pro' | 'team',  // Per-user billing
  stripeCustomerId: VARCHAR
}

// Workspaces (Agent containers)
workspaces {
  id: UUID,
  userId: UUID FK,           // Each workspace owned by one user
  name: VARCHAR,
  status: 'provisioning' | 'running' | 'stopped' | 'failed',
  config: {
    repositories: string[],  // Currently just one
    maxAgents: number,
    resourceTier: 'small' | 'medium' | 'large' | 'xlarge'
  }
}

// Linked Daemons (Local machines connected to cloud)
linkedDaemons {
  id: UUID,
  userId: UUID FK,
  machineId: VARCHAR UNIQUE,
  apiKeyHash: VARCHAR,       // SHA256 of ar_live_xxx
  status: 'online' | 'offline',
  lastSeenAt: TIMESTAMP,
  messageQueue: JSONB        // Pending messages when offline
}

// Project Groups (Multi-repo coordination)
projectGroups {
  id: UUID,
  userId: UUID FK,
  name: VARCHAR,
  coordinatorAgent: {
    enabled: boolean,
    name: string,
    model: string,
    systemPrompt: string
  }
}
```

### 2.2 Message Routing Flow

```
Alice@MachineA wants to message Carol@MachineB:

1. Alice outputs: ->relay:Carol <<<Hello!>>>

2. TmuxWrapper captures, sends to local daemon

3. Router checks: Carol not local

4. Router calls CloudSyncService.sendCrossMachineMessage()

5. CloudSyncService POSTs to /api/messages/relay:
   {
     from: { daemonId: "daemon-a", agent: "Alice" },
     to: "Carol",
     content: "Hello!"
   }

6. Cloud API looks up Carol's daemon via linkedDaemons table

7. Cloud queues message in daemon-b's messageQueue

8. MachineB's CloudSyncService polls and receives message

9. MachineB's Router delivers to Carol via local socket

Total latency: 100-500ms (depends on poll interval)
```

### 2.3 Scaling Characteristics

| Metric | Current Capacity | Bottleneck |
|--------|------------------|------------|
| Agents per daemon | ~50 | Memory (each wrapper ~50MB) |
| Messages per second (local) | ~100/sec | SQLite writes |
| Messages per second (cross-machine) | ~10/sec | Cloud API rate limit |
| Linked daemons per user | Unlimited | No limit |
| Workspaces per user | Plan-dependent | Billing |

---

## 3. Gap Analysis

### 3.1 Missing for N-Server Vision

| Gap | Description | Effort |
|-----|-------------|--------|
| **Organizations table** | Group users under org billing | 2 days |
| **Org-level policies** | Governance across all org members | 2 days |
| **P2P daemon connections** | Direct WebSocket between daemons | 5 days |
| **Global agent registry** | Fleet-wide unique names | 3 days |
| **Multi-repo per daemon** | Multiple repos in one workspace | 3 days |
| **Org billing integration** | Stripe org subscriptions | 3 days |

### 3.2 What PR #8 Proposed vs Reality

| PR #8 Proposal | Current Reality | Gap |
|----------------|-----------------|-----|
| Ed25519 asymmetric keys | API key hash (SHA256) | Simpler works fine |
| Quorum-based registration | Cloud is source of truth | Not needed |
| NATS JetStream transport | HTTP polling works | Future optimization |
| P2P WebSocket mesh | Cloud-mediated | Real gap |
| Credit-based flow control | Rate limiting | Simpler works |

**Verdict:** PR #8 over-engineered some aspects. The cloud-mediated approach works well for current scale. P2P is the main gap for low-latency at scale.

---

## 4. Target Architecture

### 4.1 Organization-Centric Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TARGET ARCHITECTURE                                  │
│                                                                              │
│  ORGANIZATION: Acme Corp                                                     │
│  Plan: Team ($X/user/month)                                                  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ User: Alice                    User: Bob                    User: Carol ││
│  │ Server 1                       Server 2                     Server 3    ││
│  │ Repo: frontend                 Repo: backend                Repo: libs  ││
│  │                                                                         ││
│  │ ┌─────┐ ┌─────┐               ┌─────┐ ┌─────┐              ┌─────┐     ││
│  │ │Lead │ │Dev-1│               │API  │ │DB   │              │Utils│     ││
│  │ └──┬──┘ └──┬──┘               └──┬──┘ └──┬──┘              └──┬──┘     ││
│  │    │       │                     │       │                    │        ││
│  │ ┌──┴───────┴──┐               ┌──┴───────┴──┐              ┌──┴──┐     ││
│  │ │   Daemon    │◄─────────────►│   Daemon    │◄────────────►│Daemon│    ││
│  │ └──────┬──────┘   P2P WSS     └──────┬──────┘   P2P WSS    └──┬──┘     ││
│  └────────┼─────────────────────────────┼────────────────────────┼────────┘│
│           │                             │                        │         │
│           └─────────────────────────────┼────────────────────────┘         │
│                                         │                                   │
│                              ┌──────────┴──────────┐                       │
│                              │    Cloud Control    │                       │
│                              │    Plane (Backup)   │                       │
│                              │                     │                       │
│                              │ • Org management    │                       │
│                              │ • Agent registry    │                       │
│                              │ • Policy sync       │                       │
│                              │ • Fallback routing  │                       │
│                              └─────────────────────┘                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 New Database Schema

```typescript
// NEW: Organizations
organizations {
  id: UUID,
  name: VARCHAR,
  slug: VARCHAR UNIQUE,        // acme-corp
  plan: 'team' | 'enterprise',
  stripeSubscriptionId: VARCHAR,
  settings: {
    maxUsersIncluded: number,
    maxAgentsPerUser: number,
    ssoEnabled: boolean
  }
}

// NEW: Organization Memberships
orgMemberships {
  id: UUID,
  orgId: UUID FK,
  userId: UUID FK,
  role: 'owner' | 'admin' | 'member',
  joinedAt: TIMESTAMP
}

// UPDATED: Users
users {
  // ... existing fields ...
  defaultOrgId: UUID FK,       // NEW: primary org
}

// NEW: Organization Policies
orgPolicies {
  id: UUID,
  orgId: UUID FK,
  name: VARCHAR,
  rules: AgentPolicyRule[],    // Applied to all org members
  priority: INTEGER            // Higher = override user policies
}

// NEW: Global Agent Registry
globalAgents {
  id: UUID,
  orgId: UUID FK,
  name: VARCHAR,               // Fleet-wide unique within org
  daemonId: UUID FK,
  userId: UUID FK,
  status: 'online' | 'offline',
  lastSeenAt: TIMESTAMP,
  UNIQUE(orgId, name)          // No collisions within org
}
```

### 4.3 P2P Connection Model

```
Daemon Discovery & Connection:

1. Daemon starts, registers with cloud:
   POST /api/daemons/register
   {
     machineId: "machine-123",
     publicEndpoint: "wss://alice-machine.local:3889",  // Optional
     orgId: "acme-corp"
   }

2. Cloud returns peer list:
   {
     peers: [
       { daemonId: "daemon-bob", endpoint: "wss://...", agents: ["API", "DB"] },
       { daemonId: "daemon-carol", endpoint: "wss://...", agents: ["Utils"] }
     ]
   }

3. Daemon establishes P2P WebSocket connections to peers

4. Messages route directly (P2P) with cloud as fallback:

   Alice -> Carol:
   ├── Try P2P: daemon-alice -> daemon-carol (10ms)
   └── Fallback: daemon-alice -> cloud -> daemon-carol (200ms)
```

---

## 5. Implementation Roadmap

### Phase 1: Organizations (2 weeks)

**Goal:** Enable team billing and org-level user management

```
Week 1:
├── Create organizations, orgMemberships tables
├── Add org CRUD API endpoints
├── Stripe integration for org subscriptions
└── Org invite flow (email + link)

Week 2:
├── Org settings UI in dashboard
├── Member management (add/remove/roles)
├── Migrate existing team users to orgs
└── Billing portal integration
```

**Deliverables:**
- `/api/orgs/*` endpoints
- Org dashboard page
- Per-seat billing working

### Phase 2: Global Agent Registry (1 week)

**Goal:** Fleet-wide unique agent names within org

```
├── Create globalAgents table
├── Agent registration on daemon connect
├── Heartbeat updates agent status
├── Name collision prevention (UNIQUE constraint)
└── Cross-daemon agent lookup API
```

**Deliverables:**
- `GET /api/orgs/:orgId/agents` - List all org agents
- Name collision errors with helpful messages
- Agent status visible in dashboard

### Phase 3: Org-Level Policies (1 week)

**Goal:** Governance rules that apply to all org members

```
├── Create orgPolicies table
├── Policy inheritance: org -> user -> workspace
├── Admin UI for policy management
├── Policy sync to linked daemons
└── Audit logging for policy violations
```

**Deliverables:**
- Org admins can set "allowed tools" for all agents
- Spawn limits enforced across org
- Policy violations logged

### Phase 4: P2P Daemon Connections (3 weeks)

**Goal:** Direct WebSocket connections between daemons for low-latency

```
Week 1:
├── PeerTransport interface
├── WebSocket peer connection logic
├── Peer discovery via cloud API
└── Connection health monitoring

Week 2:
├── Message routing: P2P primary, cloud fallback
├── Reconnection with exponential backoff
├── Peer authentication (challenge-response)
└── Message queuing during disconnect

Week 3:
├── NAT traversal hints (STUN-like)
├── Relay mode for firewalled peers
├── Performance testing
└── Dashboard peer status view
```

**Deliverables:**
- P2P messages: <50ms latency
- Automatic fallback to cloud
- Peer connection status in dashboard

### Phase 5: Multi-Repo Workspaces (2 weeks)

**Goal:** Single daemon serving multiple repos

```
Week 1:
├── Update workspace config for multiple repos
├── Agent-to-repo assignment
├── Per-repo policy scoping
└── Git context isolation

Week 2:
├── Coordinator agent spanning repos
├── Cross-repo file access controls
├── Dashboard multi-repo view
└── Migration for existing workspaces
```

**Deliverables:**
- One workspace can have N repos
- Agents assigned to specific repos
- Coordinator sees all repos

---

## 6. Pricing Model

### 6.1 Per-User Team Pricing

```
Free Tier (Individual):
├── 1 workspace
├── 3 agents max
├── 1 linked daemon
├── Community support
└── $0/month

Pro Tier (Individual):
├── 5 workspaces
├── 20 agents max
├── 5 linked daemons
├── Priority support
└── $29/user/month

Team Tier (Organization):
├── Unlimited workspaces per user
├── 50 agents per user
├── Unlimited linked daemons
├── Org-level policies
├── SSO (enterprise add-on)
├── Dedicated support
└── $49/user/month (min 3 users)

Enterprise Tier:
├── Everything in Team
├── Custom agent limits
├── SLA guarantees
├── Dedicated infrastructure
├── Custom integrations
└── Contact sales
```

### 6.2 Billing Implementation

```typescript
// Stripe subscription with per-seat billing
const subscription = await stripe.subscriptions.create({
  customer: org.stripeCustomerId,
  items: [{
    price: 'price_team_per_seat',  // $49/seat/month
    quantity: org.memberCount      // Updates automatically
  }],
  billing_cycle_anchor: 'now'
});

// Webhook handles seat changes
app.post('/webhooks/stripe', async (req, res) => {
  if (event.type === 'customer.subscription.updated') {
    // Sync seat count with org membership
    await syncOrgSeats(subscription.id);
  }
});
```

---

## 7. Technical Specifications

### 7.1 P2P Protocol Messages

```typescript
// Peer handshake
interface PeerHello {
  type: 'PEER_HELLO';
  daemonId: string;
  orgId: string;
  agents: string[];        // Local agent names
  challenge: string;       // Random bytes for auth
}

interface PeerWelcome {
  type: 'PEER_WELCOME';
  daemonId: string;
  agents: string[];
  challengeResponse: string;  // Signed challenge
}

// Peer routing
interface PeerRoute {
  type: 'PEER_ROUTE';
  id: string;              // Message ID
  from: string;            // Sender agent
  to: string;              // Recipient agent
  content: string;
  timestamp: number;
}

interface PeerAck {
  type: 'PEER_ACK';
  id: string;              // Message ID being acked
  delivered: boolean;      // Was agent reached?
}

// Peer health
interface PeerPing {
  type: 'PEER_PING';
  ts: number;
}

interface PeerPong {
  type: 'PEER_PONG';
  ts: number;
}
```

### 7.2 Agent Registry API

```typescript
// Register agent (called by daemon on agent connect)
POST /api/orgs/:orgId/agents
{
  name: "Alice",
  daemonId: "daemon-123",
  model: "claude",
  capabilities: ["code", "review"]
}
// Returns 409 if name already taken

// List org agents
GET /api/orgs/:orgId/agents
// Returns all agents across all daemons

// Find agent's daemon
GET /api/orgs/:orgId/agents/:name/location
// Returns { daemonId, endpoint, status }

// Deregister agent
DELETE /api/orgs/:orgId/agents/:name
```

### 7.3 Cross-Daemon Message Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MESSAGE ROUTING DECISION TREE                          │
│                                                                              │
│  Message arrives at Router                                                   │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────┐                                                        │
│  │ Is recipient    │──Yes──► Deliver locally via Unix socket                │
│  │ local agent?    │                                                        │
│  └────────┬────────┘                                                        │
│           │ No                                                               │
│           ▼                                                                  │
│  ┌─────────────────┐                                                        │
│  │ Is recipient in │──Yes──► Look up in global registry                     │
│  │ same org?       │              │                                         │
│  └────────┬────────┘              ▼                                         │
│           │ No              ┌───────────────┐                               │
│           │                 │ P2P connected │──Yes──► Send via P2P WebSocket│
│           ▼                 │ to daemon?    │                               │
│  ┌─────────────────┐        └───────┬───────┘                               │
│  │ Return error:   │                │ No                                    │
│  │ "Agent not in   │                ▼                                       │
│  │ your org"       │        ┌───────────────┐                               │
│  └─────────────────┘        │ Cloud fallback│──► POST /api/messages/relay   │
│                             └───────────────┘                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix A: Migration Path

### Existing Users

1. **Individual users** → Remain on user-centric plans (Free/Pro)
2. **Team users** → Auto-create org, migrate to Team plan
3. **Linked daemons** → Continue working, gain P2P after Phase 4

### Breaking Changes

- **None planned.** All changes are additive.
- P2P is transparent to agents (same `->relay:` syntax)
- Org features are opt-in

---

## Appendix B: Comparison with PR #8

| Aspect | PR #8 Proposal | This Document |
|--------|----------------|---------------|
| **Scope** | Pure federation (P2P only) | Full org model + federation |
| **Auth** | Ed25519 per-message signing | API keys + TLS (simpler) |
| **Registry** | Quorum consensus | Cloud as source of truth |
| **Timeline** | 8-10 weeks federation only | 9 weeks for complete vision |
| **Billing** | Not addressed | Per-user team pricing |

**This document supersedes PR #8's federation proposal** with a more realistic, incremental approach that builds on what's already working.
