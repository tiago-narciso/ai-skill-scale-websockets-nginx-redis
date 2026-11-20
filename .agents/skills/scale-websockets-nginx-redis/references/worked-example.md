# Worked example: the pixel canvas of this repository

This repository applies the skill to a tiny r/place clone: a 100 × 100 canvas, one pixel per user every 10 seconds (`COOLDOWN`), an Express 5 REST API and Socket.IO 4 events (`hello { node }`, `pixel { x, y, color }`).

| Branch | Role |
| --- | --- |
| `01-single-node` | One server, all state in memory: everything works |
| `02-two-nodes-broken` | The skill's input: the same code twice behind nginx, with three bugs |
| `03-redis-fix` | The skill's output: stateless servers, all shared state in Redis |

## Step 1 applied: the inventory

| In-process state on `02-two-nodes-broken` | Replaced on `03-redis-fix` by |
| --- | --- |
| `const pixels = {}`: the canvas, `"x,y"` → `"#RRGGBB"` | hash `canvas`, no TTL (`HSET`, `HGETALL`, `HGET`) |
| `const usersLastPlacement = {}`: last placement time per `userId` | key `cooldown:<userId>`, TTL `COOLDOWN` (`SET ... EX ... NX`, then `TTL`) |
| `io.emit("pixel", ...)` with the default in-memory adapter | the same call, relayed by `@socket.io/redis-adapter` |

## The three bugs on `02-two-nodes-broken`

Run `docker compose up --build` and open <http://localhost:8080> in two windows, one showing "Connected to node-1" and the other "Connected to node-2" (reload until they differ).

| Bug | How to see it |
| --- | --- |
| A. Lost notifications | Click twice quickly in one window: the other window shows only one of the two pixels |
| B. Cooldown bypass | Those two clicks were both accepted, each by a different node |
| C. Different canvases | Reload a window several times: pixels appear and disappear |

## Step 6 applied: verification

```bash
# Two placements for the same user: round robin sends them to two different nodes
curl -s -X POST localhost:8080/api/pixels -H 'Content-Type: application/json' -d '{"x":1,"y":1,"color":"#E50000","userId":"demo"}'
curl -s -X POST localhost:8080/api/pixels -H 'Content-Type: application/json' -d '{"x":2,"y":1,"color":"#E50000","userId":"demo"}'

# The canvas, read twice: once from each node
curl -s localhost:8080/api/pixels
curl -s localhost:8080/api/pixels
```

| Check | `02-two-nodes-broken` | `03-redis-fix` |
| --- | --- | --- |
| Second placement | `201`, from the other node | `429`, with `retryAfter` |
| Canvas read twice | Two different results | The same result |
| Pixel placed in one window | Reaches the other window only sometimes | Reaches both windows |

## The whole fix

```bash
git diff 02-two-nodes-broken 03-redis-fix -- server/server.js docker-compose.yaml
```

30 lines added and 17 removed in `server/server.js`, plus `REDIS_URL` and a `redis` service in `docker-compose.yaml`.
