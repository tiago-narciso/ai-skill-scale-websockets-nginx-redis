# Redis patterns for in-process state

One section per kind of state found in Step 1 of `SKILL.md`: the in-process version, its Redis replacement, the key and the TTL. The code uses ioredis; `redis` is the data connection from Step 2. Every command below was checked against Redis 7.

## 1. Shared data: an object or a Map

| In process | In Redis | Key | TTL |
| --- | --- | --- | --- |
| `const board = {}` or `new Map()` | hash, one field per item | `board` | none |

```js
await redis.hset('board', `${x},${y}`, color);         // write one field
const board = await redis.hgetall('board');           // all fields; {} if the key does not exist
const color = await redis.hget('board', `${x},${y}`);  // one field; null if missing
```

Values come back as strings. One hash suits small, flat data that is read as a whole; for large data read item by item, use one key per item.

## 2. Cooldown or lock: one action per N seconds

| In process | In Redis | Key | TTL |
| --- | --- | --- | --- |
| `lastAction[userId] = Date.now()` | string set with `NX` | `cooldown:<userId>` | the cooldown |

```js
const ok = await redis.set(`cooldown:${userId}`, '1', 'EX', seconds, 'NX');  // 'OK', or null if still cooling down
const left = await redis.ttl(`cooldown:${userId}`);                         // seconds left, for Retry-After
```

## 3. N actions per window

| In process | In Redis | Key | TTL |
| --- | --- | --- | --- |
| `count[userId]++`, reset by a timer | counter, `INCR` | `rate:<userId>:<minute>` | the window |

```js
const minute = Math.floor(Date.now() / 60_000);
const key = `rate:${userId}:${minute}`;
const [[, count]] = await redis.multi()
  .incr(key)
  .expire(key, 60, 'NX')   // sets the TTL on the first increment only (Redis 7+)
  .exec();
if (count > LIMIT) { /* reject with 429 */ }
```

A fixed window lets a client send up to twice the limit around a window boundary. A sliding window (a sorted set of timestamps, checked by a Lua script) is exact but more complex.

## 4. Messages to one user

| In process | In Redis | Key | TTL |
| --- | --- | --- | --- |
| `sockets.get(userId).emit(...)` | a Socket.IO room, relayed by the adapter | room `user:<userId>` | none |

```js
io.on('connection', (socket) => {
  socket.join(`user:${socket.data.userId}`);   // userId set by your io.use() authentication middleware
});

// From any instance:
io.to(`user:${userId}`).emit('cooldown-ended');
```

## 5. A periodic job that must run once

| In process | In Redis | Key | TTL |
| --- | --- | --- | --- |
| `setInterval(job, 60_000)` on every instance | lock set with `NX` | `lock:<job>` | a little under the interval |

```js
setInterval(async () => {
  const mine = await redis.set('lock:snapshot', NODE_ID, 'EX', 55, 'NX');
  if (mine === null) return;   // another instance runs it this time
  await takeSnapshot();
}, 60_000);
```

## 6. A cache of a slow result

| In process | In Redis | Key | TTL |
| --- | --- | --- | --- |
| `let cached = null` | string with `EX` | `cache:<name>` | how stale the result may be |

```js
let value = await redis.get('cache:leaderboard');
if (value === null) {
  value = JSON.stringify(await computeLeaderboard());
  await redis.set('cache:leaderboard', value, 'EX', 30);
}
// On every write that changes the result:
await redis.del('cache:leaderboard');
```

## 7. Sessions

`express-session` keeps sessions in a MemoryStore by default. Use a Redis store (`connect-redis`), or stateless JWTs that every instance verifies with the same secret.
