-- ═══════════════════════════════════════════════════════════════════
-- SCHEMA PORTAIL CAPTIF SMD-CONNECT — PostgreSQL
-- Structure exacte du modèle de données de server.js
-- ═══════════════════════════════════════════════════════════════════

-- Archivage des anciennes tables (itération précédente de l'app)
DROP TABLE IF EXISTS vouchers_legacy CASCADE;
DROP TABLE IF EXISTS logs_connexion_legacy CASCADE;
ALTER TABLE IF EXISTS vouchers RENAME TO vouchers_legacy;
ALTER TABLE IF EXISTS logs_connexion RENAME TO logs_connexion_legacy;

-- ─── FORFAITS ──────────────────────────────────────────────────────
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

-- ─── TICKETS ───────────────────────────────────────────────────────
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

-- ─── HOTSPOTS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotspots (
    id      SERIAL PRIMARY KEY,
    nom     VARCHAR(100) NOT NULL,
    lieu    VARCHAR(100),
    ip      VARCHAR(45) UNIQUE,
    statut  VARCHAR(10) NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif')),
    clients INTEGER NOT NULL DEFAULT 0,
    debit   VARCHAR(50) DEFAULT '10 Mbps'
);

-- ─── CLIENTS CONNECTÉS ─────────────────────────────────────────────
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

-- ─── CONNEXIONS (historique facturé) ───────────────────────────────
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

-- ─── DOMICILES (connexions nano station) ───────────────────────────
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

-- ─── COMPTES PRIVILÉGIÉS (bypass portail captif) ───────────────────
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

-- ─── BLACKLIST ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blacklist (
    id         SERIAL PRIMARY KEY,
    type       VARCHAR(3) NOT NULL CHECK (type IN ('ip', 'mac')),
    valeur     VARCHAR(45) NOT NULL UNIQUE,
    raison     TEXT,
    date_ajout TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── LOGS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logs (
    id      SERIAL PRIMARY KEY,
    type    VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    date    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(date);
CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type);

-- ─── PARAMÈTRES (ligne unique, id = 1) ─────────────────────────────
CREATE TABLE IF NOT EXISTS parametres (
    id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    nom_reseau      VARCHAR(100) NOT NULL DEFAULT 'SMD-CONNECT WiFi',
    message_accueil TEXT NOT NULL DEFAULT 'Bienvenue sur notre réseau Wi-Fi sécurisé !',
    logo_texte      VARCHAR(10) NOT NULL DEFAULT 'ST',
    couleur_primaire VARCHAR(10) NOT NULL DEFAULT '#2563eb',
    admin_email     VARCHAR(100) NOT NULL DEFAULT 'admin@smd-connect.com'
);

-- ─── APPAREILS AYANT UTILISÉ UN FORFAIT GRATUIT ────────────────────
CREATE TABLE IF NOT EXISTS appareils_gratuits (
    id               SERIAL PRIMARY KEY,
    appareil_id      TEXT NOT NULL,
    forfait_id       INTEGER NOT NULL REFERENCES forfaits(id) ON DELETE CASCADE,
    ticket_code      VARCHAR(20),
    ip               VARCHAR(45),
    date_utilisation TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (appareil_id, forfait_id)
);
