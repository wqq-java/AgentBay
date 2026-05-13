# claude-teams

Visual command center for Claude Code agent teams. See [`wiki/项目/claude-teams/设计.md`](/Users/eoi/EOI/wiki/项目/claude-teams/设计.md) for design.

## Dev

```bash
pnpm install
pnpm -r build
pnpm dev
```

Open http://localhost:5173 (frontend) — daemon listens on 7777.

## Project Structure

- `packages/daemon` — Node.js + TypeScript backend, SQLite persistence, WebSocket push
- `packages/frontend` — Vite + React + Zustand
- `packages/shared` — daemon/frontend shared types
- `docs/INTERNALS.md` — Claude Code internals (hook payload + jsonl schema) verified findings
