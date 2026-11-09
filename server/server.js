import express from "express"
import { createServer } from 'node:http';
import {Server} from "socket.io";

const app = express();
app.use(express.json());
app.use(express.static('public'));
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000


const SIZE = 100
const pixels = {}

io.on('connection', (socket) => {
    socket.emit('hello');
});

app.get("/api/health", (req, res) => {
    res.json({status: "ok"})
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
    res.json({size: SIZE, pixels})
})

app.post("/api/pixels", (req, res) => {
    const {x, y, color} = req.body || {}

    if (!isValidPixel(x, y, color)) {
        return res.status(400).json({error: 'Invalid pixel'});
    }
    pixels[[x, y]] = color
    io.emit("pixel", {x, y, color})

    res.status(201).json({x, y, color});
})

app.get("/api/pixels/:x/:y", (req, res) => {
    const {x, y} = req.params

    if (!isValidCoordinates(x, y)) {
        return res.status(400).json({error: 'Invalid coordinates'})
    }
    res.json({color: pixels[[x, y]] || "#FFFFFF"})
})

httpServer.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
})