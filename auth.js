// auth.js — Activation and WebSocket authentication logic
"use strict";
const db = require("./db");

/**
 * Validate license key, bind or verify fingerprint, return client_token.
 * Throws an object { status, message } on failure.
 */
async function activate(licenseKey, fingerprint, clientIp) {
  const lic = await db.getLicense(licenseKey);

  if (!lic) {
    throw { status: 404, message: "Invalid license key." };
  }
  if (lic.revoked) {
    throw { status: 403, message: "License has been revoked." };
  }
  if (!lic.fingerprint) {
    // First activation — bind this machine
    await db.bindFingerprint(lic.id, fingerprint);
    console.log(`[Auth] License ${licenseKey} activated on fingerprint ${fingerprint.slice(0,16)}`);
  } else if (lic.fingerprint !== fingerprint) {
    console.warn(`[Auth] License ${licenseKey} fingerprint mismatch`);
    throw { status: 403, message: "This license is already activated on a different machine." };
  }

  const token = await db.upsertClient(lic.id, clientIp);
  return token;
}

/**
 * Verify WebSocket client credentials.
 * Returns the client DB record on success.
 * Throws a string error message on failure.
 */
async function verifyWsClient(clientToken, fingerprint) {
  const row = await db.getClientByToken(clientToken);

  if (!row) throw "Unknown client token.";
  if (row.revoked) throw "License has been revoked.";
  if (row.fingerprint !== fingerprint) throw "Fingerprint mismatch.";

  return row;
}

module.exports = { activate, verifyWsClient };
