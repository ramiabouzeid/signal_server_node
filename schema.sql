-- =============================================================
--  signal_server/schema.sql
--  Run once on your MySQL/MariaDB server to create the tables.
--
--  mysql -u root -p signaldb < signal_server/schema.sql
-- =============================================================

-- ── Licenses ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS licenses (
    id            INT UNSIGNED     AUTO_INCREMENT PRIMARY KEY,
    license_key   VARCHAR(64)      UNIQUE NOT NULL,
    fingerprint   VARCHAR(128)     DEFAULT NULL,
    note          TEXT             DEFAULT NULL,
    activated_at  DATETIME         DEFAULT NULL,
    revoked       TINYINT(1)       NOT NULL DEFAULT 0,
    created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Clients ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
    id            INT UNSIGNED     AUTO_INCREMENT PRIMARY KEY,
    license_id    INT UNSIGNED     NOT NULL,
    client_token  VARCHAR(512)     UNIQUE,
    last_seen     DATETIME         DEFAULT NULL,
    last_ip       VARCHAR(45)      DEFAULT NULL,
    created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Signals ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signals (
    id          INT UNSIGNED     AUTO_INCREMENT PRIMARY KEY,
    sp          VARCHAR(32)      DEFAULT NULL,
    action      VARCHAR(16)      DEFAULT NULL,
    symbol      VARCHAR(32)      DEFAULT NULL,
    price       DOUBLE           DEFAULT NULL,
    sl          DOUBLE           DEFAULT NULL,
    tp          DOUBLE           DEFAULT NULL,
    entry_low   DOUBLE           DEFAULT NULL,
    entry_high  DOUBLE           DEFAULT NULL,
    raw         TEXT             DEFAULT NULL,
    received_at DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Signal delivery log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_log (
    id           INT UNSIGNED     AUTO_INCREMENT PRIMARY KEY,
    signal_id    INT UNSIGNED     DEFAULT NULL,
    client_id    INT UNSIGNED     DEFAULT NULL,
    delivered_at DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (signal_id) REFERENCES signals(id),
    FOREIGN KEY (client_id) REFERENCES clients(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX idx_signals_received_at ON signals(received_at);
CREATE INDEX idx_signal_log_signal   ON signal_log(signal_id);
CREATE INDEX idx_signal_log_client   ON signal_log(client_id);
