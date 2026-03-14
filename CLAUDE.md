# CLAUDE.md — Portal Ecosystem

Public hub for the Portal ecosystem — a suite of tools for creating observable, sandboxed AI agent
development environments. Audience: Claude Code, contributors, and the user.
Layer 2 of three-layer documentation model. Contains open-source tools only.

---

## Projects

All paths are relative to this repo root (`~/projects/portal/`).

| Project | Path | Stack | Purpose |
|---------|------|-------|---------|
| tsk | tsk/ | Rust, Cargo | CLI for creating agentic dev environments — spin up containers with Claude Code, bypassed permissions, git branch retrieval, session resume |
| viewer | viewer/ | Vite, React 19, Hono, Effect-TS | Web UI to monitor, spawn, and observe tsk environments; 3-up comparison view for parallel agents |
| fullstack-test-app | fullstack-test-app/ | Angular, ASP.NET Core | Demo full-stack app for conference presentation |
| presentation | presentation/ | Slidev, Three.js, GSAP | Conference talk — RVATech Data & AI Summit 2026 |

Each project has its own CLAUDE.md. Read the relevant one before working in that project.

---

## How Tools Connect

### tsk <-> viewer

viewer spawns and monitors tsk environments from the UI. viewer reads agent activity logs to show
what each agent is doing in real time. viewer provides a dashboard with a 3-up comparison view for
observing parallel agents working on the same task simultaneously.

### tsk <-> fullstack-test-app

fullstack-test-app runs inside tsk containers as a demo target. The conference demo spawns 3 parallel
tsk agents, each implementing a different UI approach in fullstack-test-app (tabs, accordions,
side-nav). Each container has Playwright automation, static analysis, and compile-time errors available.

### presentation <-> fullstack-test-app

The presentation uses fullstack-test-app as its live demo subject. The narrative describes agents
being spawned to build UI features in fullstack-test-app while the audience watches.

### presentation <-> viewer

During the live demo segment, the presentation transitions into the viewer UI showing real-time
activity across all 3 parallel agent containers.

---

## Docker Image Rebuilds

tsk uses content-hashing to detect when Docker images are stale. When the composed Dockerfile changes
(from any layer, config, or cert changes), `tsk shell` / `tsk run` will auto-rebuild with Docker's
layer cache — no manual rebuild needed for most changes.

**`tsk docker build --no-cache` is only needed when:**
- Upstream base images have security updates (e.g., Ubuntu, Node.js)
- A `RUN` command fetches something that changed externally (e.g., `npm install -g` with new version)
- Docker layer cache is corrupted or stale for reasons outside the Dockerfile

**Auto-rebuild triggers (no manual action needed):**
- tsk Dockerfile templates or the image layering/composition logic (`tsk/src/docker/`)
- Project Dockerfiles (e.g., `fullstack-test-app/.tsk/dockerfiles/`)
- `.tsk/project.toml` fields that affect the Docker build (e.g., `layers`, `certs`, `runtime`)
- Global defaults (`~/.config/tsk/defaults.toml`) that affect the Docker build (e.g., `certs`)
- Base, stack, or agent layer Dockerfiles (`tsk/dockerfiles/`)

---

## Getting Started

Each project has full build commands and architecture details in its own CLAUDE.md:

- **tsk:** `tsk/CLAUDE.md` — build with `cargo build`, install with `just install`
- **viewer:** `viewer/CLAUDE.md` — Vite dev server, Hono API, Effect-TS
- **fullstack-test-app:** `fullstack-test-app/CLAUDE.md` — Angular frontend, ASP.NET Core backend
- **presentation:** `presentation/CLAUDE.md` — Slidev dev server, Three.js portal effect
