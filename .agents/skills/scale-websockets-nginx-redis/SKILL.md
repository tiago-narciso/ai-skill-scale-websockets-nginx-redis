---
name: scale-websockets-nginx-redis
description: Explain, plan, and implement horizontal scaling of a Node.js real-time server (Socket.IO with Express or node:http) behind a load balancer such as nginx, by making every instance stateless and moving all shared in-process state to Redis - the Socket.IO Redis adapter for broadcasts and rooms, atomic commands (SET NX EX, INCR with EXPIRE) for cooldowns and rate limits, and Redis structures for shared data. Use this skill whenever the user runs or plans more than one instance of a WebSocket or Socket.IO server, puts a load balancer in front of one, reports real-time events reaching only some clients, a limit that can be bypassed or data that differs between instances, or asks about sticky sessions, the Socket.IO Redis adapter, or sharing state between Node.js processes.
compatibility: Node.js 18+ (tested on 22), Socket.IO 4.x, @socket.io/redis-adapter 8.x, ioredis 5.x, Redis 7+, nginx, Docker Compose v2.
---

# Scaling a Node.js WebSocket server horizontally with nginx and Redis

Two modes. **Explain**: the user asks what, why or how. Answer from "The rule" and "Design at a glance", and change no file. **Implement**: the user asks to scale the server, add instances, or fix one of the symptoms below. Follow Steps 1 to 6 in order. If the request is ambiguous, explain first, then ask before changing code.

Read a reference when a step points to it:

- `references/redis-patterns.md`: one Redis pattern per kind of in-process state, with code
- `references/worked-example.md`: this skill applied to the pixel canvas of this repository, before (`02-two-nodes-broken`) and after (`03-redis-fix`)

## The rule

A process's memory belongs to that process only. With one instance, a module-level object, a `Map` of last actions or `io.emit()` behaves as if it were global. With several instances behind a load balancer, each request lands on one instance and each client stays connected to one instance, so all of them silently become per-instance:

| Symptom with 2+ instances | Typical cause | Fix |
| --- | --- | --- |
| Real-time events reach only some clients | `io.emit()` or `io.to(room).emit()` with the default in-memory adapter | Socket.IO Redis adapter |
| A cooldown or rate limit can be bypassed | Timestamps or counters in a local `Map` or object | One atomic Redis command |
| Data differs depending on the instance | A module-level object or cache used as storage | A Redis data structure |

Target state: identical, stateless instances; Redis holds everything they share; the load balancer may send any request to any instance.

## Design at a glance

| Concern | Decision | Why |
| --- | --- | --- |
| Load balancing | nginx `upstream`, round robin, forwarding `Upgrade` and `Connection` | Default algorithm; a WebSocket starts as an HTTP request that asks to upgrade |
| Client transport | `io({ transports: ["websocket"] })` | One connection per client, so no sticky sessions are needed (Socket.IO docs) |
| Broadcasts and rooms | `@socket.io/redis-adapter` with a dedicated pair of connections | Every emit is relayed to all instances through Redis Pub/Sub |
| Cooldowns and locks | `SET key 1 EX <seconds> NX` | Checks and writes in one atomic command; expires on its own |
| N actions per window | `INCR` and `EXPIRE key <seconds> NX` in one `MULTI` | Atomic; the window resets on its own (Redis 7+) |
| Shared data | Hash, string, set or sorted set, chosen by access pattern | One source of truth for every instance |
| Observability | A `NODE_ID` per instance, returned in responses and logged | Shows which instance answered |

## Precision rules

1. Name every piece of state you move, the Redis key or key pattern that replaces it, and its TTL if any. Never write "store it in Redis".
2. Never implement a limit as a read followed by a write (`GET` then `SET`): two instances can both read before either writes. That is a race condition.
3. Label assumptions as assumptions: the number of instances, the proxies in front of the app and whether clients can use WebSockets are facts only if the code or the user says so.
4. Do not claim a fix works before checking it through the load balancer with at least two instances (Step 6).

## Step 1 - Inventory the in-process state

Search the server code for:

- module-level `const` or `let` holding objects, arrays, `Map`s or `Set`s that request or socket handlers read or write;
- `setInterval` and `setTimeout` jobs, which run once per instance;
- `io.emit`, `io.to(...)`, `socket.broadcast`, and any `Map` from user to socket;
- in-memory caches and session stores (`express-session` without a store uses a MemoryStore, which does not scale past one process).

For each item, write one line: what it holds, who reads and writes it, and the pattern from `references/redis-patterns.md` that replaces it, with its key and TTL. Data that belongs to one connection only (`socket.data`) may stay local.

## Step 2 - Connect to Redis

```js
import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redis = new Redis(REDIS_URL);        // data and atomic commands
const pubClient = new Redis(REDIS_URL);    // adapter: publishes
const subClient = pubClient.duplicate();   // adapter: subscribes
```

A connection in subscribe mode cannot run other commands, so the adapter gets its own pair. ioredis connects by itself; with the `redis` package, `await` each client's `connect()` first. Read `REDIS_URL` and `NODE_ID` from the environment, never from constants.

## Step 3 - Move shared data and limits to Redis

```js
// Shared data. Before: const scores = {}; scores[userId] = points;
await redis.hset('scores', userId, points);
const scores = await redis.hgetall('scores');   // values come back as strings

// Cooldown. Before: a Map of last-action timestamps
const key = `cooldown:${userId}`;
if ((await redis.set(key, '1', 'EX', COOLDOWN, 'NX')) === null) {
  const retryAfter = Math.max(await redis.ttl(key), 1);
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ error: 'Cooldown', retryAfter, node: NODE_ID });
}
```

Handlers that call Redis become `async`. Express 5 forwards a rejected promise to its error handler; with Express 4, catch errors yourself. For counters per window, periodic jobs, caches and sessions, use the matching pattern in `references/redis-patterns.md`.

## Step 4 - Relay broadcasts through the Redis adapter

```js
import { createAdapter } from '@socket.io/redis-adapter';

const io = new Server(httpServer, {
  adapter: createAdapter(pubClient, subClient),
});
```

The emitting code does not change: `io.emit`, `io.to(room).emit` and `socket.broadcast` now reach the clients of every instance. Replace any `Map` from user to socket with rooms: call ``socket.join(`user:${userId}`)`` on connection, then ``io.to(`user:${userId}`).emit(...)`` from any instance.

## Step 5 - Put the instances behind nginx

```nginx
events {}

http {
    upstream app_servers {
        server app1:3000;
        server app2:3000;
    }

    server {
        listen 80;

        location / {
            proxy_pass http://app_servers;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
    }
}
```

Run each instance as its own Docker Compose service, built from the same folder and differing only by `NODE_ID` (`node-1`, `node-2`), with `REDIS_URL: redis://redis:6379`, plus a `redis` service (`redis:7-alpine`). Only nginx publishes a port.

On the client, connect with `io({ transports: ["websocket"] })`. If long-polling must stay, for example for clients behind proxies that block WebSockets, enable sticky sessions instead, with `hash $remote_addr consistent;` or `ip_hash;` in the `upstream` block.

## Step 6 - Verify through the load balancer

With two instances running behind nginx:

1. Each response or connection reports its `NODE_ID`. Open two clients until they sit on different instances.
2. An event emitted while handling a request on one instance reaches a client connected to the other one.
3. A limited action sent twice in a row is refused the second time, although round robin sends it to the other instance:

   ```bash
   for i in 1 2; do
     curl -s -X POST localhost:8080/<limited-route> -H 'Content-Type: application/json' -d '<same user>'
     echo
   done
   ```

4. Shared data read twice through nginx is identical.
5. `redis-cli MONITOR` shows the expected commands, and restarting the app instances loses nothing.

Report what you ran and what it returned, not what should happen.

## Rules and pitfalls

1. **No shared state in process memory.** Module-level objects, `Map`s and timers that other requests rely on become bugs as soon as there are two instances.
2. **The client is not the authority.** A countdown in the browser is cosmetic; the server enforces every limit.
3. **Missing upgrade headers.** Without `Upgrade` and `Connection`, nginx breaks WebSocket connections.
4. **Long-polling without sticky sessions.** Socket.IO's default transport sends several HTTP requests that must reach the same instance; behind round robin, the handshake fails.
5. **Client IP behind nginx.** `req.ip` is nginx's address. If a limit is keyed by IP, forward `X-Forwarded-For` and set `app.set('trust proxy', 1)` in Express, trusting your own proxy only.
6. **Pub/Sub keeps nothing.** An instance that loses its Redis connection misses the broadcasts sent meanwhile, so clients should reload the shared state when they reconnect.
7. **nginx resolves upstream names at startup.** After the app containers are recreated with new addresses, nginx can answer 502: restart it.
8. **Redis becomes a single point of failure.** If it stops, every instance stops working. Plan replication for production.
9. **Stale images.** After changing dependencies, rebuild with `docker compose up --build`.

## Short notes (mention, do not over-implement)

- On Redis Cluster, the Socket.IO documentation recommends the sharded adapter (`createShardedAdapter`, Redis 7+).
- Redis keeps data in memory: configure RDB or AOF persistence if the shared data must survive a Redis restart.
- A message broker can play the adapter's role. Reddit's 2017 r/place pushed board updates to its WebSocket servers through a RabbitMQ fanout exchange, and kept the whole board in one Redis key written with `BITFIELD` (4 bits per pixel).

## Checklist for the AI using this skill

- [ ] Mode chosen; no file changed in Explain mode
- [ ] Every piece of in-process state listed, with its Redis key pattern and TTL
- [ ] Nothing shared left in module-level variables
- [ ] Limits and cooldowns use one atomic command; `429` carries `Retry-After` computed from `TTL`
- [ ] Socket.IO uses `createAdapter(pubClient, subClient)`; messages to one user go through rooms
- [ ] nginx forwards `Upgrade` and `Connection`; clients use WebSocket only, or sticky sessions are on
- [ ] Each instance exposes its `NODE_ID`
- [ ] Verified through nginx with two instances; actual results reported
