const http = require("node:http");
const operations = new Map();
const calls = [];
http
  .createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const reply = (code, data) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.url === "/inspect")
      return reply(200, { operations: [...operations.values()], calls });
    if (req.headers.authorization !== "Bearer smoke-api")
      return reply(401, { error: "unauthorized" });
    calls.push({
      method: req.method,
      path: req.url,
      key: req.headers["idempotency-key"],
    });
    if (req.url === "/v1/status") return reply(200, { paused: false });
    if (req.url === "/v1/stickers")
      return reply(200, { stickers: [{ id: "1" }] });
    if (req.url === "/v1/messages" && req.method === "POST") {
      const key = req.headers["idempotency-key"];
      if (!key) return reply(400, { error: "missing_key" });
      let op = operations.get(key);
      if (op && JSON.stringify(op.command) !== JSON.stringify(body))
        return reply(409, { error: "idempotency_conflict" });
      if (!op) {
        op = {
          operationId: "op-" + (operations.size + 1),
          state: "queued",
          command: body,
          key,
          polls: 0,
        };
        operations.set(key, op);
      }
      return reply(202, op);
    }
    const op = [...operations.values()].find(
      (o) => req.url === "/v1/operations/" + o.operationId,
    );
    if (op) {
      op.polls++;
      if (op.key.startsWith("failed:")) {
        op.state = "failed";
        op.reason = "tiktok_rejected_send";
        op.tiktokRejection = { status: 3, check: 7170 };
      } else if (op.key.startsWith("uncertain:")) {
        op.state = "uncertain";
        op.reason = "send_result_unknown";
      } else if (!op.key.startsWith("restart:") || op.polls >= 8) {
        op.state = "succeeded";
        op.messageId = "msg-" + op.operationId;
      }
      return reply(200, op);
    }
    reply(404, { error: "not_found" });
  })
  .listen(8080, "0.0.0.0");
