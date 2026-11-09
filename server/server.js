import express from "express"
import { createServer } from 'node:http';
import {Server} from "socket.io";

const app = express();
app.use(express.json());
app.use(express.static('public'));
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000
const COOLDOWN = process.env.COOLDOWN || 10
const SIZE = process.env.SIZE || 100
const NODE_ID = process.env.NODE_ID || crypto.randomUUID()

const pixels = {}
const usersLastPlacement = {}

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

app.get("/api/pixels", (req, res) => {
    res.json({size: SIZE, pixels, node: NODE_ID})
})

app.post("/api/pixels", (req, res) => {
    const {x, y, color, userId} = req.body || {}
    if (!userId) {
        return res.status(401).json({error: "userId must be provided", node: NODE_ID})
    }

    if (!isValidPixel(x, y, color)) {
        return res.status(400).json({error: 'Invalid pixel', node: NODE_ID});
    }

    const elapsed = (Date.now() - (usersLastPlacement[userId] || 0)) / 1000;
    if (elapsed < COOLDOWN) {
        const retryAfter = Math.ceil(COOLDOWN - elapsed);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({ error: 'Cooldown', retryAfter, node: NODE_ID });
    }

    pixels[[x, y]] = color
    io.emit("pixel", {x, y, color})
    usersLastPlacement[userId] = Date.now();

    res.status(201).json({x, y, color,cooldown: COOLDOWN, node: NODE_ID});
})

app.get("/api/pixels/:x/:y", (req, res) => {
    const {x, y} = req.params

    if (!isValidCoordinates(x, y)) {
        return res.status(400).json({error: 'Invalid coordinates'})
    }
    res.json({color: pixels[[x, y]] || "#FFFFFF"})
})

httpServer.listen(PORT, () => {
    console.log(`Server node ${NODE_ID} started on http://localhost:${PORT}`);
})