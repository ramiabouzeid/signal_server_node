// db.js — MySQL connection pool + all database queries
"use strict";
require("dotenv").config();
const mysql = require("mysql2/promise");
const crypto = require("crypto");

const poolConfig = {
  user:               process.env.DB_USER     || "signaluser",
  password:           process.env.DB_PASS     || "changeme",
  database:           process.env.DB_NAME     || "signaldb",
  charset:            "utf8mb4",
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
};

// On Hostinger shared hosting MySQL listens on a Unix socket, not TCP.
// Set DB_SOCKET=/path/to/mysql.sock in env to use socket, otherwise TCP.
if (process.env.DB_SOCKET) {
  poolConfig.socketPath = process.env.DB_SOCKET;
} else {
  poolConfig.host = process.env.DB_HOST || "localhost";
  poolConfig.port = parseInt(process.env.DB_PORT || "3306");
}

const pool = mysql.createPool(poolConfig);

// ── Helpers ───────────────────────────────────────────────────────────────

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function insert(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result.insertId;
}

// ── Licenses ──────────────────────────────────────────────────────────────

async function createLicense(note = null) {
  const key = crypto.randomBytes(32).toString("base64url");
  await insert("INSERT INTO licenses (license_key, note) VALUES (?, ?)", [key, note]);
  console.log(`[DB] License created: ${key}  note=${note}`);
  return key;
}

async function getLicense(licenseKey) {
  return queryOne("SELECT * FROM licenses WHERE license_key = ?", [licenseKey]);
}

async function bindFingerprint(licenseId, fingerprint) {
  await pool.execute(
    "UPDATE licenses SET fingerprint = ?, activated_at = NOW() WHERE id = ?",
    [fingerprint, licenseId]
  );
}

async function revokeLicense(licenseKey) {
  await pool.execute(
    "UPDATE licenses SET revoked = TRUE WHERE license_key = ?",
    [licenseKey]
  );
}

async function listLicenses() {
  return query("SELECT * FROM licenses ORDER BY created_at DESC");
}

// ── Clients ───────────────────────────────────────────────────────────────

async function upsertClient(licenseId, ip) {
  const existing = await queryOne(
    "SELECT * FROM clients WHERE license_id = ?",
    [licenseId]
  );
  if (existing) {
    await pool.execute(
      "UPDATE clients SET last_seen = NOW(), last_ip = ? WHERE license_id = ?",
      [ip, licenseId]
    );
    return existing.client_token;
  }
  const token = crypto.randomBytes(48).toString("base64url");
  await insert(
    "INSERT INTO clients (license_id, client_token, last_seen, last_ip) VALUES (?, ?, NOW(), ?)",
    [licenseId, token, ip]
  );
  return token;
}

async function getClientByToken(token) {
  return queryOne(
    `SELECT c.*, l.fingerprint, l.revoked
       FROM clients c
       JOIN licenses l ON l.id = c.license_id
      WHERE c.client_token = ?`,
    [token]
  );
}

async function touchClient(clientId, ip) {
  await pool.execute(
    "UPDATE clients SET last_seen = NOW(), last_ip = ? WHERE id = ?",
    [ip, clientId]
  );
}

// ── Signals ───────────────────────────────────────────────────────────────

async function storeSignal({ sp, action, symbol, price, sl, tp, entry_low, entry_high, raw }) {
  return insert(
    `INSERT INTO signals (sp, action, symbol, price, sl, tp, entry_low, entry_high, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [sp, action, symbol ?? null, price ?? null, sl ?? null, tp ?? null,
     entry_low ?? null, entry_high ?? null, raw]
  );
}

async function logDelivery(signalId, clientId) {
  await insert(
    "INSERT INTO signal_log (signal_id, client_id) VALUES (?, ?)",
    [signalId, clientId]
  );
}

async function recentSignals(limit = 100) {
  return query("SELECT * FROM signals ORDER BY received_at DESC LIMIT ?", [limit]);
}

module.exports = {
  pool,
  createLicense, getLicense, bindFingerprint, revokeLicense, listLicenses,
  upsertClient, getClientByToken, touchClient,
  storeSignal, logDelivery, recentSignals,
};
