import express from "express"

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000

const SIZE = 100
const pixels= {}

app.get("/api/health", (req, res) => {
    res.json({status: "ok"})
})

function isValidPixel(x, y, color) {
    if (isNaN(x) || isNaN(y) || !color) return false
    if (x < 0 || x > SIZE) return false
    if (y < 0 || y > SIZE) return false
    if (typeof color != "string") return false
    if (color.length !== 7) return false
    return /^#[0-9A-F]{6}$/i.test(color);
}

app.get("/api/pixels", (req, res) => {
    res.json({size: SIZE, pixels})
})

app.post("/api/pixels", (req, res) => {
    const {x, y, color} = req.body || {}

    if (!isValidPixel(x,y,color)) {
        return res.status(400).json({ error: 'Invalid pixel' });
    }
    pixels[[x,y]] = color

    res.status(201).json({ x, y, color });
})


app.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
})