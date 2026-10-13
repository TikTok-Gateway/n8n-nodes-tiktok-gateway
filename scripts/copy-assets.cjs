const fs = require("node:fs");
fs.rmSync("dist/nodes/tiktok.svg", { force: true });
fs.copyFileSync("nodes/tiktok.png", "dist/nodes/tiktok.png");
