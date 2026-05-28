const http = require("http")
const fs = require("fs")
const path = require("path")

const root = __dirname
const port = Number(process.argv[2] || 64217)

http
  .createServer((_req, res) => {
    const file = path.join(root, "index.html")
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    })
    res.end(fs.readFileSync(file))
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`listening ${port}`)
  })
