# AGENTS.md

This repository is a tutorial on scaling a Node.js real-time server (Express + Socket.IO) horizontally behind nginx, with Redis holding all shared state.

## When to load the skill

Load and follow `.agents/skills/scale-websockets-nginx-redis/SKILL.md`, and the files of its `references/` folder when a step points to them, before you:

- run several instances of a Socket.IO or WebSocket server, or put a load balancer in front of one;
- move in-memory state (shared data, rate limits, cooldowns, broadcasts) out of a Node.js process;
- change `server/server.js`, `docker-compose.yaml` or `nginx/nginx.conf` in this repository.

## Repository conventions

- Branches `01-single-node`, `02-two-nodes-broken` and `03-redis-fix` are teaching stages: never rewrite them. Work on `main`.
- Run the stack from the repository root with `docker compose up --build`, then open <http://localhost:8080>.
- Node.js 22, package manager yarn (`server/yarn.lock`).
- Never keep shared state in process memory: it belongs in Redis.
