/**
 * db.js — Couche de persistance PostgreSQL pour le portail captif SMD-CONNECT
 * Remplace data.json : pool de connexions pg + initialisation du schéma + seeds par défaut
 */

const { Pool } = require("pg");

const pool = new Pool({
    host: process.env.PGHOST || "localhost",
    port: parseInt(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE || "portail_captif",
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    max: 10,
    idleTimeoutMillis: 30000,
});

// ─── Mapping snake_case → camelCase (l'API renvoie du camelCase) ──────────
function toCamel(key) {
    return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function mapRow(row) {
    if (!row) return null;
    const out = {};
    for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
    return out;
}

function mapRows(rows) {
    return rows.map(mapRow);
}

// ─── Schéma (identique à schema.sql, idempotent) ──────────────────────────
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS forfaits (
    id               SERIAL PRIMARY KEY,
    nom              VARCHAR(100) NOT NULL UNIQUE,
    prix             INTEGER NOT NULL DEFAULT 0,
    quota            VARCHAR(50) DEFAULT 'Illimité',
    debit            VARCHAR(50) DEFAULT '10 Mbps',
    duree            VARCHAR(50) DEFAULT '10 minutes',
    profil_mikrotik  VARCHAR(100),
    statut           VARCHAR(10) NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif')),
    gratuit          BOOLEAN NOT NULL DEFAULT false,
    appareil_unique  BOOLEAN NOT NULL DEFAULT false,
    date_creation    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
    id               SERIAL PRIMARY KEY,
    code             VARCHAR(20) NOT NULL UNIQUE,
    forfait_id       INTEGER REFERENCES forfaits(id) ON DELETE SET NULL,
    forfait_nom      VARCHAR(100),
    prix             INTEGER NOT NULL DEFAULT 0,
    statut           VARCHAR(12) NOT NULL DEFAULT 'disponible' CHECK (statut IN ('disponible', 'utilise', 'expire')),
    ip_achat         VARCHAR(45),
    telephone        VARCHAR(30),
    operateur        VARCHAR(30),
    appareil_id      TEXT,
    gratuit          BOOLEAN NOT NULL DEFAULT false,
    campay_reference VARCHAR(100) UNIQUE,
    date_creation    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_statut     ON tickets(statut);
CREATE INDEX IF NOT EXISTS idx_tickets_appareil   ON tickets(appareil_id);
CREATE INDEX IF NOT EXISTS idx_tickets_forfait    ON tickets(forfait_id);

CREATE TABLE IF NOT EXISTS hotspots (
    id      SERIAL PRIMARY KEY,
    nom     VARCHAR(100) NOT NULL,
    lieu    VARCHAR(100),
    ip      VARCHAR(45) UNIQUE,
    statut  VARCHAR(10) NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif')),
    clients INTEGER NOT NULL DEFAULT 0,
    debit   VARCHAR(50) DEFAULT '10 Mbps'
);

CREATE TABLE IF NOT EXISTS clients (
    id              SERIAL PRIMARY KEY,
    ip              VARCHAR(45),
    mac             VARCHAR(20),
    forfait         VARCHAR(100),
    hotspot         VARCHAR(100),
    debut           TIMESTAMPTZ NOT NULL DEFAULT now(),
    quota_consomme  VARCHAR(20),
    debit           VARCHAR(50),
    statut          VARCHAR(12) NOT NULL DEFAULT 'connecte' CHECK (statut IN ('connecte', 'deconnecte'))
);

CREATE TABLE IF NOT EXISTS connexions (
    id       SERIAL PRIMARY KEY,
    ticket   VARCHAR(20),
    ip       VARCHAR(45),
    debut    TIMESTAMPTZ NOT NULL DEFAULT now(),
    fin      TIMESTAMPTZ,
    forfait  VARCHAR(100),
    montant  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_connexions_debut ON connexions(debut);
CREATE INDEX IF NOT EXISTS idx_connexions_ticket ON connexions(ticket);

CREATE TABLE IF NOT EXISTS domiciles (
    id              SERIAL PRIMARY KEY,
    nom             VARCHAR(100) NOT NULL,
    telephone       VARCHAR(30),
    mac             VARCHAR(20) UNIQUE,
    forfait_id      INTEGER REFERENCES forfaits(id) ON DELETE SET NULL,
    forfait_nom     VARCHAR(100),
    date_expiration TIMESTAMPTZ,
    statut          VARCHAR(10) NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'expire')),
    date_creation   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comptes_privilegies (
    id             SERIAL PRIMARY KEY,
    nom            VARCHAR(100) NOT NULL,
    telephone      VARCHAR(30),
    mac            VARCHAR(20) NOT NULL UNIQUE,
    debit          VARCHAR(50) DEFAULT 'Illimité',
    commentaire    TEXT,
    statut         VARCHAR(10) NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu')),
    date_creation  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blacklist (
    id         SERIAL PRIMARY KEY,
    type       VARCHAR(3) NOT NULL CHECK (type IN ('ip', 'mac')),
    valeur     VARCHAR(45) NOT NULL UNIQUE,
    raison     TEXT,
    date_ajout TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logs (
    id      SERIAL PRIMARY KEY,
    type    VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    date    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(date);
CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type);

CREATE TABLE IF NOT EXISTS parametres (
    id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    nom_reseau      VARCHAR(100) NOT NULL DEFAULT 'SMD-CONNECT WiFi',
    message_accueil TEXT NOT NULL DEFAULT 'Bienvenue sur notre réseau Wi-Fi sécurisé !',
    logo_texte      VARCHAR(10) NOT NULL DEFAULT 'ST',
    couleur_primaire VARCHAR(10) NOT NULL DEFAULT '#2563eb',
    admin_email     VARCHAR(100) NOT NULL DEFAULT 'admin@smd-connect.com',
    password_hash   TEXT
);

CREATE TABLE IF NOT EXISTS appareils_gratuits (
    id               SERIAL PRIMARY KEY,
    appareil_id      TEXT NOT NULL,
    forfait_id       INTEGER NOT NULL REFERENCES forfaits(id) ON DELETE CASCADE,
    ticket_code      VARCHAR(20),
    ip               VARCHAR(45),
    date_utilisation TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (appareil_id, forfait_id)
);
`;

// ─── Seeds par défaut (uniquement si tables vides — installation fraîche) ─
async function seedDefaults() {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM forfaits");
    if (rows[0].n === 0) {
        await pool.query(
            `INSERT INTO forfaits (nom, prix, quota, debit, duree, profil_mikrotik, statut) VALUES
            ('Forfait 1H',  500,  '500 Mo',   '5 Mbps',  '1 heure',  'profil-1h',  'actif'),
            ('Forfait 3H',  1000, '1 Go',     '10 Mbps', '3 heures', 'profil-3h',  'actif'),
            ('Forfait 24H', 2000, '5 Go',     '20 Mbps', '24 heures','profil-24h', 'actif'),
            ('Forfait 7J',  5000, 'Illimité', '50 Mbps', '7 jours',  'profil-7j',  'inactif')`
        );
        console.log("🌱 [DB] Forfaits par défaut insérés");
    }

    await pool.query(
        `INSERT INTO parametres (id) VALUES (1) ON CONFLICT (id) DO NOTHING`
    );

    const h = await pool.query("SELECT COUNT(*)::int AS n FROM hotspots");
    if (h.rows[0].n === 0) {
        await pool.query(
            `INSERT INTO hotspots (nom, lieu, ip, statut, clients, debit) VALUES
            ('Hotspot Principal', 'Salle d''attente', '192.168.1.1', 'actif',   5, '10 Mbps'),
            ('Hotspot Bureau',    'Bureau direction', '192.168.1.2', 'actif',   2, '20 Mbps'),
            ('Hotspot Terrasse',  'Terrasse',         '192.168.1.3', 'inactif', 0, '0 Mbps')`
        );
        console.log("🌱 [DB] Hotspots par défaut insérés");
    }
}

// ─── Initialisation ────────────────────────────────────────────────────────
async function initSchema() {
    await pool.query(SCHEMA_SQL);
    // Migrations pour colonnes ajoutées après la création initiale
    await pool.query(`ALTER TABLE parametres ADD COLUMN IF NOT EXISTS password_hash TEXT`);
}

async function initDb() {
    await initSchema();
    await seedDefaults();
    // Hasher le mot de passe par défaut si pas encore.hashé
    const { rows } = await pool.query("SELECT password_hash FROM parametres WHERE id = 1");
    if (rows.length > 0 && !rows[0].password_hash) {
        const bcrypt = require("bcryptjs");
        const defaultPwd = process.env.ADMIN_PASSWORD || "admin123";
        const hash = await bcrypt.hash(defaultPwd, 12);
        await pool.query("UPDATE parametres SET password_hash = $1 WHERE id = 1", [hash]);
        console.log("🔑 [DB] Mot de passe admin par défaut hashé en base");
    }
    console.log("✅ [DB] PostgreSQL prêt — base:", process.env.PGDATABASE || "portail_captif");
}

// ─── Logger un événement dans la table logs ────────────────────────────────
async function ajouterLog(type, message) {
    try {
        await pool.query("INSERT INTO logs (type, message) VALUES ($1, $2)", [type, message]);
    } catch (e) {
        console.error("Erreur insertion log:", e.message);
    }
}

module.exports = { pool, initDb, initSchema, mapRow, mapRows, ajouterLog };
