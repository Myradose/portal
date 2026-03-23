# Portal

Companion resources for **"The Doctor Strange Approach to Parallel Agent Orchestration"** by Alden Geipel at the [RVATech Data & AI Summit 2026](https://rvatech.com/).

> **Experimental.** Everything here is experimental, not production-ready, and may have bugs. There is no setup guide -- these tools were built for a conference demo and are shared in the spirit of openness.

**Landing page:** [myradose.github.io/portal/](https://myradose.github.io/portal/)

## Ecosystem

The demo uses four tools working together:

| Project | Description |
|---------|-------------|
| [tsk](https://github.com/Myradose/tsk) | CLI for creating sandboxed, observable AI agent development environments |
| [Pocket Manager](https://github.com/Myradose/pocket-manager) | Web UI for monitoring and spawning parallel agent environments |
| [Fullstack Test App](https://github.com/Myradose/fullstack-test-app) | Demo full-stack application used as the agent target |
| [Presentation](https://github.com/Myradose/rvatech-2026-slides) | Slidev deck with Three.js portal effect |

Each project is an independent repository.

## How It Works

**tsk** spawns isolated Docker containers, each running an AI agent (Claude Code) against a copy of the target repository. Multiple containers run in parallel, each implementing a different approach to the same task. **Pocket Manager** provides a dashboard to observe all agents working simultaneously with terminal access and a 3-up comparison view. The **Fullstack Test App** is the demo target -- agents implement different UI approaches (tabs, accordions, side-nav) in this app during the live demo.

## None of this information should be gatekept.
