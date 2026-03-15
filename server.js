// server.js — Signal Server (Node.js + Express + ws)
"use strict";
require("dotenv").config();

const http    = require("http");
const path    = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");
const db   = require("./db");
const auth = require("./auth");

const PORT         = parseInt(process.env.PORT         || "8000");
const INGEST_SECRET = process.env.INGEST_SECRET        || "CHANGE_THIS_INGEST_SECRET";
const ADMIN_KEY     = process.env.ADMIN_KEY            || "CHANGE_THIS_ADMIN_KEY";

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: "/ws" });

app.use(express.json());

// ── WebSocket connection manager ──────────────────────────────────────────

// Map of clientId → ws
const connections = new Map();

function broadcast(payload) {
  const text = JSON.stringify(payload);
  const delivered = [];
  for (const [clientId, ws] of connections) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(text);
        delivered.push(clientId);
      } catch (e) {
        console.warn(`[WS] Failed to deliver to client_id=${clientId}: ${e.message}`);
      }
    }
  }
  return delivered;
}

// ── WebSocket endpoint ────────────────────────────────────────────────────

wss.on("connection", (ws, req) => {
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0].trim()
                 || req.socket.remoteAddress
                 || "unknown";
  let clientRecord = null;
  let pingInterval = null;

  // Step 1: wait for auth message (10s timeout)
  const authTimeout = setTimeout(() => {
    ws.close(4001, "Auth timeout");
  }, 10_000);

  ws.once("message", async (raw) => {
    clearTimeout(authTimeout);
    try {
      const msg         = JSON.parse(raw.toString());
      const clientToken = msg.client_token || "";
      const fingerprint = msg.fingerprint  || "";

      clientRecord = await auth.verifyWsClient(clientToken, fingerprint);
    } catch (err) {
      console.warn(`[WS] Auth failed: ${err}`);
      ws.close(4001, String(err));
      return;
    }

    const clientId = clientRecord.id;
    await db.touchClient(clientId, clientIp);
    connections.set(clientId, ws);
    ws.send(JSON.stringify({ status: "authenticated" }));
    console.log(`[WS] Authenticated client_id=${clientId} ip=${clientIp}  total=${connections.size}`);

    // Step 2: ping/pong keepalive every 25s
    pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 25_000);

    ws.on("message", (data) => {
      if (data.toString() === "ping") ws.send("pong");
    });

    ws.on("close", () => cleanup(clientId));
    ws.on("error", (e) => {
      console.warn(`[WS] Error client_id=${clientId}: ${e.message}`);
      cleanup(clientId);
    });
  });

  ws.on("error", (e) => {
    clearTimeout(authTimeout);
    console.warn(`[WS] Pre-auth error: ${e.message}`);
  });

  function cleanup(clientId) {
    if (pingInterval) clearInterval(pingInterval);
    if (clientId != null) {
      connections.delete(clientId);
      console.log(`[WS] Disconnected client_id=${clientId}  total=${connections.size}`);
    }
  }
});

// ── Middleware helpers ────────────────────────────────────────────────────

function requireIngestKey(req, res, next) {
  if (req.headers["x-ingest-key"] !== INGEST_SECRET) {
    return res.status(401).json({ detail: "Invalid ingest key." });
  }
  next();
}

function requireAdminKey(req, res, next) {
  if (req.headers["x-admin-key"] !== ADMIN_KEY) {
    return res.status(401).json({ detail: "Invalid admin key." });
  }
  next();
}

// ── HTTP endpoints ────────────────────────────────────────────────────────

// POST /activate
app.post("/activate", async (req, res) => {
  const { license_key, fingerprint } = req.body;
  if (!license_key || !fingerprint) {
    return res.status(400).json({ detail: "license_key and fingerprint are required." });
  }
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0].trim()
                 || req.socket.remoteAddress
                 || "unknown";
  try {
    const token = await auth.activate(license_key, fingerprint, clientIp);
    return res.json({ client_token: token });
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message || String(err) });
  }
});

// POST /signal  (called by poster.py / Telegram listener)
app.post("/signal", requireIngestKey, async (req, res) => {
  const { sp, formatted, signals } = req.body;
  if (!sp || !formatted || !Array.isArray(signals) || signals.length === 0) {
    return res.status(400).json({ detail: "sp, formatted and signals[] are required." });
  }

  const first = signals[0];
  const sl = signals.find(s => s.action === "SL")?.price ?? null;
  const tp = signals.find(s => s.action === "TP")?.price ?? null;

  const signalId = await db.storeSignal({
    sp,
    action:      first.action    || "UNKNOWN",
    symbol:      first.symbol    ?? null,
    price:       first.price     ?? null,
    sl,
    tp,
    entry_low:   first.entry_low  ?? null,
    entry_high:  first.entry_high ?? null,
    raw:         formatted,
  });

  const payload = { sp, formatted, signals, signal_id: signalId };
  const deliveredIds = broadcast(payload);

  // Log delivery
  await Promise.all(deliveredIds.map(cid => db.logDelivery(signalId, cid)));

  console.log(`[Signal] #${signalId} [${sp} ${first.action}] → ${deliveredIds.length} client(s)`);
  return res.json({ signal_id: signalId, delivered_to: deliveredIds.length });
});

// GET /health
app.get("/health", (req, res) => {
  res.json({ status: "ok", connected_clients: connections.size });
});

// GET / — status page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// GET /admin/licenses
app.get("/admin/licenses", requireAdminKey, async (req, res) => {
  const rows = await db.listLicenses();
  res.json(rows);
});

// POST /admin/licenses
app.post("/admin/licenses", requireAdminKey, async (req, res) => {
  const { note } = req.body;
  const key = await db.createLicense(note || null);
  res.json({ license_key: key });
});

// POST /admin/licenses/:key/revoke
app.post("/admin/licenses/:key/revoke", requireAdminKey, async (req, res) => {
  await db.revokeLicense(req.params.key);
  res.json({ revoked: req.params.key });
});

// GET /admin/signals
app.get("/admin/signals", requireAdminKey, async (req, res) => {
  const limit = parseInt(req.query.limit || "100");
  const rows = await db.recentSignals(limit);
  res.json(rows);
});

// ── Start ─────────────────────────────────────────────────────────────────

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Server] Signal server running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => { server.close(); db.pool.end(); });
process.on("SIGINT",  () => { server.close(); db.pool.end(); });
