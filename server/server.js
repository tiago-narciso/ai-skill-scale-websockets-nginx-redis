import express from "express"
import { createServer } from 'node:http';
import {Server} from "socket.io";
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';

const PORT = process.env.PORT || 3000
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const COOLDOWN = process.env.COOLDOWN || 10
const SIZE = process.env.SIZE || 100
const NODE_ID = process.env.NODE_ID || crypto.randomUUID()

const app = express();
app.use(express.json());
app.use(express.static('public'));
const httpServer = createServer(app);
const redis = new Redis(REDIS_URL);
const pubClient = new Redis(REDIS_URL);
const subClient = pubClient.duplicate();
const io = new Server(httpServer, {
    adapter: createAdapter(pubClient, subClient),
});

io.on('connection', (socket) => {
    socket.emit('hello', {node: NODE_ID});
});

app.get("/api/health", (req, res) => {
    res.json({status: "ok", node: NODE_ID})
})

function isValidCoordinates(x, y) {
    if (isNaN(x) || isNaN(y)) return false
    if (x < 0 || x > SIZE) return false
    return !(y < 0 || y > SIZE);
}

function isValidPixel(x, y, color) {
    if (!color) return false
    if (!isValidCoordinates(x, y)) return false
    if (typeof color != "string") return false
    if (color.length !== 7) return false
    return /^#[0-9A-F]{6}$/i.test(color);
}

app.get("/api/pixels", async (req, res) => {
    const pixels = await redis.hgetall('canvas');
    res.json({size: SIZE, pixels, node: NODE_ID})
})

app.post("/api/pixels", async (req, res) => {
    const {x, y, color, userId} = req.body || {}
    if (!userId) {
        return res.status(401).json({error: "userId must be provided", node: NODE_ID})
    }

    if (!isValidPixel(x, y, color)) {
        return res.status(400).json({error: 'Invalid pixel', node: NODE_ID});
    }

    const key = `cooldown:${userId}`
    const allowed = await redis.set(key, '1', 'EX', COOLDOWN, 'NX');
    if (allowed === null) {
        const retryAfter = Math.max(await redis.ttl(key), 1);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({ error: 'Cooldown', retryAfter, node: NODE_ID });
    }

    await redis.hset('canvas', `${x},${y}`, color)
    io.emit("pixel", {x, y, color})

    res.status(201).json({x, y, color,cooldown: COOLDOWN, node: NODE_ID});
})

app.get("/api/pixels/:x/:y", async (req, res) => {
    const {x, y} = req.params

    if (!isValidCoordinates(x, y)) {
        return res.status(400).json({error: 'Invalid coordinates'})
    }

    const key = `${x},${y}`
    const pixel = await redis.hget("canvas", key)
    console.log(pixel, key)
    if (pixel === null) {
        return res.json({color: "#FFFFFF"})
    }
    res.json({color: pixel})
})

httpServer.listen(PORT, () => {
    console.log(`Server node ${NODE_ID} started on http://localhost:${PORT}`);
})