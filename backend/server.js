const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const mk = require("./mikrotik");
const fapshi = require("./fapshi");
const db = require("./db");

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "smd-connect-jwt-secret-change-in-production";
const JWT_EXPIRES = "8h";

// Middleware
app.use(cors());
app.use(express.json());

// ─── Sécurité : headers HTTP ──────────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    next();
});

// ─── Servir le frontend (fichiers statiques) ──────────────────────────────
app.use(express.static(path.join(__dirname, "..", "frontend", "dist")));

// ─────────────────────────────────────────
// RATE LIMITING (anti-brute force natif)
// ─────────────────────────────────────────

const rateLimitMap = new Map();

function rateLimit(maxRequests = 10, windowMs = 60000) {
    return (req, res, next) => {
        const ip = req.ip || "inconnu";
        const now = Date.now();
        const key = `${ip}:${req.path}`;

        if (!rateLimitMap.has(key)) {
            rateLimitMap.set(key, { count: 1, start: now });
            return next();
        }

        const entry = rateLimitMap.get(key);

        // Réinitialiser si la fenêtre est expirée
        if (now - entry.start > windowMs) {
            rateLimitMap.set(key, { count: 1, start: now });
            return next();
        }

        entry.count++;

        if (entry.count > maxRequests) {
            const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
            return res.status(429).json({
                success: false,
                message: `Trop de tentatives. Réessayez dans ${retryAfter} secondes.`
            });
        }

        next();
    };
}

// Nettoyer le cache toutes les 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap.entries()) {
        if (now - entry.start > 300000) rateLimitMap.delete(key);
    }
}, 300000);

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

const { pool, mapRow, mapRows, ajouterLog } = db;

function genCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "ST-";
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function genDeviceId(ip, userAgent, deviceId) {
    // Priorité : deviceId fourni par le client > combinaison IP+UA
    if (deviceId && deviceId.length > 8) return deviceId;
    const ua = (userAgent || "").slice(0, 50);
    return `${ip}|${ua}`;
}

/**
 * Convertit une durée texte en millisecondes
 */
function dureeEnMs(duree) {
    if (!duree) return null;
    const map = {
        "30 minutes": 30 * 60 * 1000,
        "1 heure":    1  * 3600 * 1000,
        "2 heures":   2  * 3600 * 1000,
        "3 heures":   3  * 3600 * 1000,
        "6 heures":   6  * 3600 * 1000,
        "12 heures":  12 * 3600 * 1000,
        "24 heures":  24 * 3600 * 1000,
        "3 jours":    3  * 24 * 3600 * 1000,
        "7 jours":    7  * 24 * 3600 * 1000,
        "30 jours":   30 * 24 * 3600 * 1000,
    };
    return map[duree] || null;
}

// ─── COMPTES PRIVILÉGIÉS (bypass portail captif) ──────────────────────────

async function ajouterBypassMikrotik(mac, nom, debit) {
    if (!mk.MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        const debitMK = debit === "Illimité" ? "0" : debit.replace(" Mbps", "M").replace(" Kbps", "K");
        const result = await mk.ajouterMacBypass(mac, nom, debitMK);
        return result;
    } catch (err) {
        return { success: false, message: err.message };
    }
}

async function supprimerBypassMikrotik(mac) {
    if (!mk.MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        const result = await mk.supprimerMacBypass(mac);
        return result;
    } catch (err) {
        return { success: false, message: err.message };
    }
}

// ─────────────────────────────────────────
// ROUTES PUBLIQUES
// ─────────────────────────────────────────

app.get("/", (req, res) => res.json({ success: true, message: "Portail captif SMD-CONNECT opérationnel" }));
app.get("/api/test", (req, res) => res.json({ success: true, message: "API fonctionnelle" }));

app.get("/api/forfaits", async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM forfaits WHERE statut = 'actif' ORDER BY id");
    res.json({ success: true, forfaits: mapRows(rows) });
});

// ─── Liste publique des tickets disponibles (créés côté admin) ────────────
app.get("/api/tickets", rateLimit(20, 60000), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT t.*, f.nom AS forfait_reel, f.duree AS forfait_duree, f.quota AS forfait_quota, f.debit AS forfait_debit
             FROM tickets t
             LEFT JOIN forfaits f ON f.id = t.forfait_id
             WHERE t.statut = 'disponible'
             ORDER BY t.id DESC
             LIMIT 200`
        );
        const tickets = rows.map(r => ({
            ...mapRow(r),
            forfaitNom: r.forfait_reel || r.forfait_nom,
            forfaitDuree: r.forfait_duree,
            forfaitQuota: r.forfait_quota,
            forfaitDebit: r.forfait_debit,
        }));
        res.json({ success: true, tickets });
    } catch (err) {
        console.error("Erreur liste tickets:", err.message);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

// ─── Détail public d'un ticket par code ───────────────────────────────────
app.get("/api/tickets/:code", rateLimit(30, 60000), async (req, res) => {
    try {
        const code = req.params.code?.trim().toUpperCase();
        if (!code) return res.status(400).json({ success: false, message: "Code requis." });

        const { rows } = await pool.query(
            `SELECT t.*, f.nom AS forfait_reel, f.duree AS forfait_duree, f.quota AS forfait_quota, f.debit AS forfait_debit
             FROM tickets t
             LEFT JOIN forfaits f ON f.id = t.forfait_id
             WHERE t.code = $1`,
            [code]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Code invalide ou inexistant." });
        const r = rows[0];
        const ticket = {
            ...mapRow(r),
            forfaitNom: r.forfait_reel || r.forfait_nom,
            forfaitDuree: r.forfait_duree,
            forfaitQuota: r.forfait_quota,
            forfaitDebit: r.forfait_debit,
        };
        res.json({ success: true, ticket });
    } catch (err) {
        console.error("Erreur détail ticket:", err.message);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

// ─── Statut de session d'un appareil ─────────────────────────────────────
app.get("/api/session", async (req, res) => {
    const deviceId = req.query.deviceId;
    const ip = req.ip || "inconnu";

    // Vérifier blacklist
    const bloque = await pool.query("SELECT 1 FROM blacklist WHERE type = 'ip' AND valeur = $1", [ip]);
    if (bloque.rowCount > 0) return res.status(403).json({ success: false, message: "Accès refusé." });

    if (!deviceId) return res.json({ success: true, connecte: false });

    // Chercher une connexion active pour cet appareil
    const { rows } = await pool.query(
        `SELECT t.*, c.debut AS connexion_debut
         FROM tickets t
         LEFT JOIN connexions c ON c.ticket = t.code
         WHERE t.appareil_id = $1 AND t.statut = 'utilise'
         ORDER BY t.id DESC LIMIT 1`,
        [deviceId]
    );
    if (rows.length === 0) return res.json({ success: true, connecte: false });
    const ticket = mapRow(rows[0]);

    const forfaitRes = await pool.query("SELECT * FROM forfaits WHERE id = $1", [ticket.forfaitId]);
    const forfait = mapRow(forfaitRes.rows[0]);

    const connexionRes = await pool.query(
        "SELECT debut, fin FROM connexions WHERE ticket = $1 ORDER BY id DESC LIMIT 1",
        [ticket.code]
    );
    const connexion = connexionRes.rows[0];

    // Vérifier si la connexion n'est pas expirée
    const debut = connexion?.debut ? new Date(connexion.debut).getTime() : null;
    const fin = connexion?.fin ? new Date(connexion.fin).getTime() : null;
    const now = Date.now();
    const dureeMs = dureeEnMs(forfait?.duree);

    // Si la connexion a une fin ou la durée est dépassée, elle est expirée
    if (fin || (debut && dureeMs && (now - debut) > dureeMs)) {
        return res.json({ success: true, connecte: false, raison: "session_expiree" });
    }

    // Calculer le temps restant
    let secondesRestantes = null;
    if (debut && dureeMs) {
        secondesRestantes = Math.max(0, Math.floor((debut + dureeMs - now) / 1000));
    }

    return res.json({
        success: true,
        connecte: true,
        ticket: ticket.code,
        forfait: forfait?.nom || ticket.forfaitNom,
        quota: forfait?.quota,
        debit: forfait?.debit,
        duree: forfait?.duree,
        debut: debut ? new Date(debut).toISOString() : null,
        secondesRestantes,
    });
});

// ─── Vérifier la disponibilité d'un code (sans le consommer) ─────────────
app.get("/api/verifier-code/:code", rateLimit(20, 60000), async (req, res) => {
    const code = req.params.code?.trim().toUpperCase();
    if (!code) return res.status(400).json({ success: false, message: "Code requis." });

    const { rows } = await pool.query("SELECT * FROM tickets WHERE code = $1", [code]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Code invalide ou inexistant." });
    const ticket = mapRow(rows[0]);

    if (ticket.statut === "utilise")  return res.json({ success: false, statut: "utilise",  message: "Ce code a déjà été utilisé." });
    if (ticket.statut === "expire")   return res.json({ success: false, statut: "expire",   message: "Ce code a expiré." });

    const forfaitRes = await pool.query("SELECT * FROM forfaits WHERE id = $1", [ticket.forfaitId]);
    const forfait = mapRow(forfaitRes.rows[0]);
    return res.json({
        success: true,
        statut: "disponible",
        forfait: forfait?.nom || ticket.forfaitNom,
        quota: forfait?.quota,
        debit: forfait?.debit,
        duree: forfait?.duree,
    });
});

// ─── Accès gratuit (forfait gratuit, 1 seul appareil, non renouvelable) ───
app.post("/api/acces-gratuit", rateLimit(3, 60000), async (req, res) => {
    const { forfaitId, deviceId } = req.body;
    if (!forfaitId || !deviceId) return res.status(400).json({ success: false, message: "Forfait et identifiant appareil requis." });

    const forfaitRes = await pool.query(
        "SELECT * FROM forfaits WHERE id = $1 AND statut = 'actif' AND gratuit = true",
        [parseInt(forfaitId)]
    );
    if (forfaitRes.rows.length === 0) return res.status(404).json({ success: false, message: "Forfait gratuit introuvable ou inactif." });
    const forfait = mapRow(forfaitRes.rows[0]);

    const ip = req.ip || "inconnu";
    const userAgent = req.headers["user-agent"] || "";
    const appareilId = genDeviceId(ip, userAgent, deviceId);

    // Vérifier si cet appareil a déjà utilisé ce forfait gratuit (non renouvelable)
    const dejaUtiliseRes = await pool.query(
        "SELECT * FROM appareils_gratuits WHERE appareil_id = $1 AND forfait_id = $2",
        [appareilId, forfait.id]
    );
    if (dejaUtiliseRes.rows.length > 0) {
        const dejaUtilise = mapRow(dejaUtiliseRes.rows[0]);
        return res.status(403).json({
            success: false,
            message: `Ce forfait gratuit a déjà été utilisé sur cet appareil le ${new Date(dejaUtilise.dateUtilisation).toLocaleDateString("fr-FR")}. Il n'est pas renouvelable.`,
            dejaUtilise: true,
            dateUtilisation: dejaUtilise.dateUtilisation
        });
    }

    // Vérifier si cet appareil a un ticket disponible en cours (pas encore connecté)
    const enCoursRes = await pool.query(
        "SELECT * FROM tickets WHERE appareil_id = $1 AND forfait_id = $2 AND statut = 'disponible' ORDER BY id DESC LIMIT 1",
        [appareilId, forfait.id]
    );
    if (enCoursRes.rows.length > 0) {
        const ticketEnCours = mapRow(enCoursRes.rows[0]);
        return res.status(200).json({ success: true, ticket: ticketEnCours, forfait, existant: true });
    }

    // Créer le ticket gratuit
    const tRes = await pool.query(
        `INSERT INTO tickets (code, forfait_id, forfait_nom, prix, statut, ip_achat, appareil_id, gratuit)
         VALUES ($1, $2, $3, 0, 'disponible', $4, $5, true) RETURNING *`,
        [genCode(), forfait.id, forfait.nom, ip, appareilId]
    );
    const t = mapRow(tRes.rows[0]);

    // Enregistrer immédiatement l'appareil comme ayant utilisé ce forfait gratuit
    await pool.query(
        "INSERT INTO appareils_gratuits (appareil_id, forfait_id, ticket_code, ip) VALUES ($1, $2, $3, $4)",
        [appareilId, forfait.id, t.code, ip]
    );

    await ajouterLog("ticket", `Accès GRATUIT accordé — ticket ${t.code} pour "${forfait.nom}" (appareil: ${ip}, durée: ${forfait.duree})`);
    return res.status(201).json({ success: true, ticket: t, forfait });
});

// Achat public d'un ticket (génération automatique)
app.post("/api/acheter", rateLimit(5, 60000), async (req, res) => {
    const { forfaitId, deviceId, telephone, operateur } = req.body;
    if (!forfaitId) return res.status(400).json({ success: false, message: "Forfait requis." });

    const forfaitRes = await pool.query(
        "SELECT * FROM forfaits WHERE id = $1 AND statut = 'actif'",
        [parseInt(forfaitId)]
    );
    if (forfaitRes.rows.length === 0) return res.status(404).json({ success: false, message: "Forfait introuvable ou inactif." });
    const forfait = mapRow(forfaitRes.rows[0]);

    // Bloquer l'achat d'un forfait gratuit via cette route
    if (forfait.gratuit) {
        return res.status(400).json({ success: false, message: "Ce forfait est gratuit. Utilisez la route /api/acces-gratuit." });
    }

    const ip = req.ip || "inconnu";
    const userAgent = req.headers["user-agent"] || "";
    const appareilId = genDeviceId(ip, userAgent, deviceId);

    // Vérifier si cet appareil a déjà un ticket disponible non utilisé pour ce forfait
    const existantRes = await pool.query(
        "SELECT * FROM tickets WHERE appareil_id = $1 AND forfait_id = $2 AND statut = 'disponible' ORDER BY id DESC LIMIT 1",
        [appareilId, forfait.id]
    );
    if (existantRes.rows.length > 0) {
        const ticketExistant = mapRow(existantRes.rows[0]);
        await ajouterLog("ticket", `Ticket existant ${ticketExistant.code} retourné pour "${forfait.nom}" (appareil: ${ip})`);
        return res.status(200).json({ success: true, ticket: ticketExistant, forfait, existant: true });
    }

    const tRes = await pool.query(
        `INSERT INTO tickets (code, forfait_id, forfait_nom, prix, statut, ip_achat, telephone, operateur, appareil_id)
         VALUES ($1, $2, $3, $4, 'disponible', $5, $6, $7, $8) RETURNING *`,
        [genCode(), forfait.id, forfait.nom, forfait.prix, ip,
         telephone ? telephone.trim() : "", operateur || "", appareilId]
    );
    const t = mapRow(tRes.rows[0]);

    await ajouterLog("ticket", `Ticket ${t.code} généré pour "${forfait.nom}" via ${operateur || "?"} (${telephone || ip})`);
    return res.status(201).json({ success: true, ticket: t, forfait });
});

// Connexion avec un code existant (vérifie que c'est le même appareil)
app.post("/api/login-code", rateLimit(10, 60000), async (req, res) => {
    const { code, deviceId } = req.body;
    if (!code) return res.status(400).json({ success: false, message: "Code requis." });

    const ip = req.ip || "inconnu";
    const userAgent = req.headers["user-agent"] || "";

    // Vérifier blacklist IP
    const bloque = await pool.query("SELECT 1 FROM blacklist WHERE type = 'ip' AND valeur = $1", [ip]);
    if (bloque.rowCount > 0) return res.status(403).json({ success: false, message: "Accès refusé." });

    // Chercher le ticket
    const ticketRes = await pool.query("SELECT * FROM tickets WHERE code = $1", [code.trim().toUpperCase()]);
    if (ticketRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Code invalide ou inexistant." });
    }
    const ticket = mapRow(ticketRes.rows[0]);

    if (ticket.statut === "utilise") {
        return res.status(403).json({ success: false, message: "Ce code a déjà été utilisé." });
    }

    if (ticket.statut === "expire") {
        return res.status(403).json({ success: false, message: "Ce code a expiré." });
    }

    // Vérifier que c'est le même appareil
    if (ticket.appareilId) {
        const appareilActuel = genDeviceId(ip, userAgent, deviceId);
        if (ticket.appareilId !== appareilActuel) {
            return res.status(403).json({
                success: false,
                message: "Ce code est réservé à l'appareil avec lequel il a été acheté."
            });
        }
    } else if (ticket.ipAchat && ticket.ipAchat !== ip) {
        return res.status(403).json({
            success: false,
            message: "Ce code est réservé à l'appareil avec lequel il a été acheté."
        });
    }

    // Trouver le forfait associé
    const forfaitRes = await pool.query("SELECT * FROM forfaits WHERE id = $1", [ticket.forfaitId]);
    if (forfaitRes.rows.length === 0) return res.status(404).json({ success: false, message: "Forfait introuvable." });
    const forfait = mapRow(forfaitRes.rows[0]);

    // Enregistrer la connexion
    await pool.query(
        "INSERT INTO connexions (ticket, ip, forfait, montant) VALUES ($1, $2, $3, $4)",
        [ticket.code, ip, forfait.nom, forfait.prix]
    );

    // Marquer le ticket comme utilisé
    await pool.query("UPDATE tickets SET statut = 'utilise' WHERE id = $1", [ticket.id]);

    // Enregistrer le client connecté
    try {
        await pool.query(
            "INSERT INTO clients (ip, forfait, debut, statut) VALUES ($1, $2, now(), 'connecte') ON CONFLICT DO NOTHING",
            [ip, forfait.nom]
        );
    } catch {}

    // Activer l'appareil sur Mikrotik
    let mikrotikOk = false;
    if (mk.MIKROTIK_ENABLED) {
        try {
            const mkResult = await mk.creerUtilisateurHotspot(ticket.code, forfait.profilMikrotik || forfait.nom, forfait.duree);
            mikrotikOk = mkResult.success;
            if (mkResult.success) await ajouterLog("mikrotik", `Utilisateur hotspot "${ticket.code}" activé pour connexion code`);
        } catch (e) {
            console.error("Mikrotik login-code error:", e.message);
        }
    }

    await ajouterLog("connexion", `Client ${ip} reconnecté avec code ${ticket.code} — ${forfait.nom}${mikrotikOk ? " [MK OK]" : ""}`);

    return res.json({
        success: true,
        message: "Connexion réussie !",
        forfait: forfait.nom,
        quota: forfait.quota,
        debit: forfait.debit,
        mikrotik: mikrotikOk
    });
});

app.post("/api/login", async (req, res) => {
    const { ticket, forfaitId } = req.body;
    if (!ticket) return res.status(400).json({ success: false, message: "Veuillez entrer un code ticket." });
    const ip = req.ip || "inconnu";
    const userAgent = req.headers["user-agent"] || "";
    const bloque = await pool.query("SELECT 1 FROM blacklist WHERE type = 'ip' AND valeur = $1", [ip]);
    if (bloque.rowCount > 0) return res.status(403).json({ success: false, message: "Accès refusé." });

    // Vérifier que le ticket existe et est disponible
    const tRes = await pool.query(
        "SELECT * FROM tickets WHERE code = $1 AND statut = 'disponible'",
        [ticket.trim().toUpperCase()]
    );
    if (tRes.rowCount === 0) {
        await ajouterLog("connexion", `Tentative de connexion avec code invalide/inutilisé: ${ticket.trim().toUpperCase()} — IP: ${ip}`);
        return res.status(401).json({ success: false, message: "Code ticket invalide ou déjà utilisé." });
    }
    const ticketRow = mapRow(tRes.rows[0]);

    let forfait;
    if (forfaitId) {
        const r = await pool.query("SELECT * FROM forfaits WHERE id = $1 AND statut = 'actif'", [parseInt(forfaitId)]);
        forfait = mapRow(r.rows[0]);
    } else {
        const r = await pool.query("SELECT * FROM forfaits WHERE id = $1", [ticketRow.forfaitId]);
        forfait = mapRow(r.rows[0]);
    }
    if (!forfait) return res.status(404).json({ success: false, message: "Aucun forfait actif disponible." });

    // Marquer le ticket comme utilisé
    await pool.query("UPDATE tickets SET statut = 'utilise' WHERE id = $1", [ticketRow.id]);

    await pool.query(
        "INSERT INTO connexions (ticket, ip, forfait, montant) VALUES ($1, $2, $3, $4)",
        [ticket.trim().toUpperCase(), ip, forfait.nom, forfait.prix]
    );

    // Enregistrer le client connecté
    try {
        await pool.query(
            "INSERT INTO clients (ip, forfait, debut, statut) VALUES ($1, $2, now(), 'connecte') ON CONFLICT DO NOTHING",
            [ip, forfait.nom]
        );
    } catch {}

    // Activer l'appareil sur Mikrotik
    let mikrotikOk = false;
    if (mk.MIKROTIK_ENABLED) {
        try {
            const mkResult = await mk.creerUtilisateurHotspot(ticketRow.code, forfait.profilMikrotik || forfait.nom, forfait.duree);
            mikrotikOk = mkResult.success;
            if (mkResult.success) await ajouterLog("mikrotik", `Utilisateur hotspot "${ticketRow.code}" activé — profil ${forfait.profilMikrotik || forfait.nom}`);
        } catch (e) {
            console.error("Mikrotik login error:", e.message);
        }
    }

    await ajouterLog("connexion", `Client ${ip} connecté — ${forfait.nom}${mikrotikOk ? " [MK OK]" : ""}`);
    return res.json({
        success: true,
        message: "Connexion réussie !",
        forfait: forfait.nom,
        quota: forfait.quota,
        debit: forfait.debit,
        duree: forfait.duree,
        mikrotik: mikrotikOk
    });
});

// ─────────────────────────────────────────
// MIDDLEWARE ADMIN (JWT)
// ─────────────────────────────────────────

function adminAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Token manquant." });
    }
    try {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: "Token invalide ou expiré." });
    }
}

// ─────────────────────────────────────────
// AUTH ADMIN
// ─────────────────────────────────────────

app.post("/api/admin/login", rateLimit(5, 60000), async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: "Mot de passe requis." });

    try {
        const { rows } = await pool.query("SELECT password_hash FROM parametres WHERE id = 1");
        const hash = rows[0]?.password_hash;
        if (!hash) return res.status(500).json({ success: false, message: "Mot de passe admin non initialisé." });

        const match = await bcrypt.compare(password, hash);
        if (!match) {
            await ajouterLog("admin", "Tentative de connexion admin échouée (mot de passe incorrect)");
            return res.status(401).json({ success: false, message: "Mot de passe incorrect." });
        }

        const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
        await ajouterLog("admin", "Connexion admin réussie");
        return res.json({ success: true, message: "Connexion admin réussie.", token });
    } catch (err) {
        console.error("Erreur login admin:", err.message);
        return res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

// ─────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────

app.get("/api/admin/dashboard", adminAuth, async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM forfaits)                                          AS total_forfaits,
            (SELECT COUNT(*)::int FROM forfaits WHERE statut = 'actif')                   AS forfaits_actifs,
            (SELECT COUNT(*)::int FROM tickets)                                           AS total_tickets,
            (SELECT COUNT(*)::int FROM tickets WHERE statut = 'disponible')               AS tickets_dispos,
            (SELECT COUNT(*)::int FROM hotspots)                                          AS total_hotspots,
            (SELECT COUNT(*)::int FROM hotspots WHERE statut = 'actif')                   AS hotspots_actifs,
            (SELECT COUNT(*)::int FROM clients WHERE statut = 'connecte')                 AS clients_connectes,
            (SELECT COUNT(*)::int FROM domiciles)                                         AS total_domiciles,
            (SELECT COUNT(*)::int FROM domiciles WHERE statut = 'actif')                  AS domiciles_actifs,
            (SELECT COUNT(*)::int FROM connexions)                                        AS total_connexions,
            (SELECT COALESCE(SUM(montant), 0)::int FROM connexions)                       AS recette_total,
            (SELECT COALESCE(SUM(montant), 0)::int FROM connexions WHERE debut::date = $1::date) AS recette_aujourdhui
    `, [today]);

    const s = rows[0];
    res.json({
        success: true,
        stats: {
            totalForfaits:     s.total_forfaits,
            forfaitsActifs:    s.forfaits_actifs,
            totalTickets:      s.total_tickets,
            ticketsDispos:     s.tickets_dispos,
            totalHotspots:     s.total_hotspots,
            hotspotsActifs:    s.hotspots_actifs,
            clientsConnectes:  s.clients_connectes,
            totalDomiciles:    s.total_domiciles,
            domicilesActifs:   s.domiciles_actifs,
            totalConnexions:   s.total_connexions,
            recetteTotal:      s.recette_total,
            recetteAujourdhui: s.recette_aujourdhui,
        }
    });
});

// ─────────────────────────────────────────
// FORFAITS
// ─────────────────────────────────────────

app.get("/api/admin/forfaits", adminAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM forfaits ORDER BY id");
    res.json({ success: true, forfaits: mapRows(rows) });
});

app.post("/api/admin/forfaits", adminAuth, async (req, res) => {
    const { nom, prix, quota, debit, duree, profilMikrotik, statut, gratuit, appareilUnique } = req.body;
    if (!nom) return res.status(400).json({ success: false, message: "Le nom est requis." });
    // Pour un forfait gratuit, le prix est 0 ; pour un forfait payant, le prix est requis
    const estGratuit = gratuit === true || gratuit === "true";
    if (!estGratuit && !prix) return res.status(400).json({ success: false, message: "Le prix est requis pour un forfait payant." });

    const dup = await pool.query("SELECT 1 FROM forfaits WHERE LOWER(nom) = LOWER($1)", [nom.trim()]);
    if (dup.rowCount > 0) return res.status(409).json({ success: false, message: "Un forfait avec ce nom existe déjà." });

    const fRes = await pool.query(
        `INSERT INTO forfaits (nom, prix, quota, debit, duree, profil_mikrotik, statut, gratuit, appareil_unique)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
            nom.trim(),
            estGratuit ? 0 : (parseInt(prix) || 0),
            quota?.trim() || "Illimité",
            debit || "10 Mbps",
            duree?.trim() || "10 minutes",
            profilMikrotik?.trim() || nom.trim().toLowerCase().replace(/\s+/g, "-"),
            statut === "inactif" ? "inactif" : "actif",
            estGratuit,
            estGratuit ? true : (appareilUnique === true || appareilUnique === "true"),
        ]
    );
    const f = mapRow(fRes.rows[0]);
    await ajouterLog("forfait", `Forfait ${estGratuit ? "GRATUIT" : ""} "${f.nom}" créé (durée: ${f.duree}${f.appareilUnique ? ", 1 appareil max" : ""})`);

    // Synchroniser avec Mikrotik
    const mkResult = await mk.creerProfilHotspot(f.profilMikrotik, f.debit, f.quota);
    if (mkResult.success) {
        await ajouterLog("mikrotik", mkResult.message);
    }

    return res.status(201).json({
        success: true,
        message: `Forfait "${f.nom}" créé.`,
        forfait: f,
        mikrotik: mkResult
    });
});

app.put("/api/admin/forfaits/:id", adminAuth, async (req, res) => {
    const { nom, prix, quota, debit, duree, profilMikrotik, statut, gratuit, appareilUnique } = req.body;
    const id = parseInt(req.params.id);
    const existing = await pool.query("SELECT * FROM forfaits WHERE id = $1", [id]);
    if (existing.rowCount === 0) return res.status(404).json({ success: false, message: "Forfait introuvable." });

    const estGratuit = gratuit === true || gratuit === "true";
    await pool.query(
        `UPDATE forfaits SET nom = $1, prix = $2, quota = $3, debit = $4, duree = $5,
         profil_mikrotik = $6, statut = $7, gratuit = $8, appareil_unique = $9 WHERE id = $10`,
        [
            (nom || existing.rows[0].nom).trim(),
            estGratuit ? 0 : (parseInt(prix) || existing.rows[0].prix),
            quota || existing.rows[0].quota,
            debit || existing.rows[0].debit,
            duree || existing.rows[0].duree,
            profilMikrotik || existing.rows[0].profil_mikrotik,
            statut || existing.rows[0].statut,
            estGratuit,
            appareilUnique === true || appareilUnique === "true",
            id
        ]
    );
    const updated = (await pool.query("SELECT * FROM forfaits WHERE id = $1", [id])).rows[0];
    await ajouterLog("forfait", `Forfait "${mapRow(updated).nom}" modifié`);
    return res.json({ success: true, message: `Forfait "${mapRow(updated).nom}" mis à jour.`, forfait: mapRow(updated) });
});

app.patch("/api/admin/forfaits/:id/toggle", adminAuth, async (req, res) => {
    const { rows } = await pool.query("UPDATE forfaits SET statut = CASE WHEN statut = 'actif' THEN 'inactif' ELSE 'actif' END WHERE id = $1 RETURNING *", [parseInt(req.params.id)]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Forfait introuvable." });
    const f = mapRow(rows[0]);
    await ajouterLog("forfait", `Forfait "${f.nom}" ${f.statut}`);
    return res.json({ success: true, message: `Forfait "${f.nom}" ${f.statut}.`, forfait: f });
});

app.delete("/api/admin/forfaits/:id", adminAuth, async (req, res) => {
    const delRes = await pool.query("DELETE FROM forfaits WHERE id = $1 RETURNING *", [parseInt(req.params.id)]);
    if (delRes.rowCount === 0) return res.status(404).json({ success: false, message: "Forfait introuvable." });
    const forfait = mapRow(delRes.rows[0]);
    await ajouterLog("forfait", `Forfait "${forfait.nom}" supprimé`);
    // Supprimer le profil sur Mikrotik
    const mkResult = await mk.supprimerProfilHotspot(forfait.profilMikrotik || forfait.nom);
    if (mkResult.success) await ajouterLog("mikrotik", mkResult.message);
    return res.json({ success: true, message: "Forfait supprimé.", mikrotik: mkResult });
});

// ─────────────────────────────────────────
// FORFAITS GRATUITS — STATS ADMIN
// ─────────────────────────────────────────

// Lister les appareils ayant utilisé les forfaits gratuits
app.get("/api/admin/acces-gratuits", adminAuth, async (req, res) => {
    const { forfaitId } = req.query;
    const params = [];
    let where = "";
    if (forfaitId) {
        params.push(parseInt(forfaitId));
        where = `WHERE a.forfait_id = $${params.length}`;
    }
    const { rows } = await pool.query(
        `SELECT a.*, COALESCE(f.nom, '—') AS forfait_nom
         FROM appareils_gratuits a
         LEFT JOIN forfaits f ON f.id = a.forfait_id
         ${where}
         ORDER BY a.id DESC`,
        params
    );
    const enrichi = mapRows(rows);
    res.json({ success: true, acces: enrichi, total: enrichi.length });
});

// Réinitialiser l'accès gratuit d'un appareil (permettre un nouvel accès)
app.delete("/api/admin/acces-gratuits", adminAuth, async (req, res) => {
    const { appareilId, forfaitId } = req.body;
    if (!appareilId || !forfaitId) return res.status(400).json({ success: false, message: "appareilId et forfaitId requis." });
    const delRes = await pool.query(
        "DELETE FROM appareils_gratuits WHERE appareil_id = $1 AND forfait_id = $2 RETURNING ip",
        [appareilId, parseInt(forfaitId)]
    );
    if (delRes.rowCount === 0) return res.status(404).json({ success: false, message: "Entrée introuvable." });
    await ajouterLog("forfait", `Accès gratuit réinitialisé pour appareil ${delRes.rows[0].ip} — forfait ID ${forfaitId}`);
    return res.json({ success: true, message: "Accès gratuit réinitialisé. L'appareil peut de nouveau utiliser ce forfait." });
});

// ─────────────────────────────────────────
// TICKETS
// ─────────────────────────────────────────

app.get("/api/admin/tickets", adminAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM tickets ORDER BY id");
    res.json({ success: true, tickets: mapRows(rows) });
});

app.post("/api/admin/tickets", adminAuth, async (req, res) => {
    const { forfaitId, quantite } = req.body;
    const forfaitRes = await pool.query("SELECT * FROM forfaits WHERE id = $1", [parseInt(forfaitId)]);
    if (forfaitRes.rows.length === 0) return res.status(404).json({ success: false, message: "Forfait introuvable." });
    const forfait = mapRow(forfaitRes.rows[0]);

    const qty = Math.min(parseInt(quantite) || 1, 50);
    const created = [];
    for (let i = 0; i < qty; i++) {
        const tRes = await pool.query(
            `INSERT INTO tickets (code, forfait_id, forfait_nom, prix, statut) VALUES ($1, $2, $3, $4, 'disponible') RETURNING *`,
            [genCode(), forfait.id, forfait.nom, forfait.prix]
        );
        created.push(mapRow(tRes.rows[0]));
    }
    await ajouterLog("ticket", `${qty} ticket(s) générés pour "${forfait.nom}"`);
    return res.status(201).json({ success: true, message: `${qty} ticket(s) créé(s).`, tickets: created });
});

app.delete("/api/admin/tickets/:id", adminAuth, async (req, res) => {
    const delRes = await pool.query("DELETE FROM tickets WHERE id = $1", [parseInt(req.params.id)]);
    if (delRes.rowCount === 0) return res.status(404).json({ success: false, message: "Ticket introuvable." });
    return res.json({ success: true, message: "Ticket supprimé." });
});

// ─────────────────────────────────────────
// HOTSPOTS
// ─────────────────────────────────────────

app.get("/api/admin/hotspots", adminAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM hotspots ORDER BY id");
    res.json({ success: true, hotspots: mapRows(rows) });
});

app.post("/api/admin/hotspots", adminAuth, async (req, res) => {
    const { nom, lieu, ip, debit } = req.body;
    if (!nom || !lieu || !ip) return res.status(400).json({ success: false, message: "Nom, lieu et IP requis." });
    const dup = await pool.query("SELECT 1 FROM hotspots WHERE ip = $1", [ip]);
    if (dup.rowCount > 0) return res.status(409).json({ success: false, message: "IP déjà utilisée." });
    const hRes = await pool.query(
        "INSERT INTO hotspots (nom, lieu, ip, statut, clients, debit) VALUES ($1, $2, $3, 'actif', 0, $4) RETURNING *",
        [nom.trim(), lieu.trim(), ip.trim(), debit || "10 Mbps"]
    );
    const h = mapRow(hRes.rows[0]);
    await ajouterLog("hotspot", `Hotspot "${h.nom}" ajouté`);
    return res.status(201).json({ success: true, message: "Hotspot ajouté.", hotspot: h });
});

app.patch("/api/admin/hotspots/:id/toggle", adminAuth, async (req, res) => {
    const upRes = await pool.query(
        `UPDATE hotspots SET
            statut = CASE WHEN statut = 'actif' THEN 'inactif' ELSE 'actif' END,
            clients = CASE WHEN statut = 'actif' THEN 0 ELSE clients END
         WHERE id = $1 RETURNING *`,
        [parseInt(req.params.id)]
    );
    if (upRes.rowCount === 0) return res.status(404).json({ success: false, message: "Hotspot introuvable." });
    const h = mapRow(upRes.rows[0]);
    await ajouterLog("hotspot", `Hotspot "${h.nom}" ${h.statut}`);
    return res.json({ success: true, message: `Hotspot "${h.nom}" ${h.statut}.`, hotspot: h });
});

app.delete("/api/admin/hotspots/:id", adminAuth, async (req, res) => {
    const delRes = await pool.query("DELETE FROM hotspots WHERE id = $1 RETURNING nom", [parseInt(req.params.id)]);
    if (delRes.rowCount === 0) return res.status(404).json({ success: false, message: "Hotspot introuvable." });
    await ajouterLog("hotspot", `Hotspot "${delRes.rows[0].nom}" supprimé`);
    return res.json({ success: true, message: "Hotspot supprimé." });
});

// ─────────────────────────────────────────
// CLIENTS CONNECTÉS
// ─────────────────────────────────────────

app.get("/api/admin/clients", adminAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM clients ORDER BY id");
    res.json({ success: true, clients: mapRows(rows) });
});

app.delete("/api/admin/clients/:id", adminAuth, async (req, res) => {
    const delRes = await pool.query("DELETE FROM clients WHERE id = $1 RETURNING ip", [parseInt(req.params.id)]);
    if (delRes.rowCount === 0) return res.status(404).json({ success: false, message: "Client introuvable." });
    await ajouterLog("client", `Client ${delRes.rows[0].ip} déconnecté par admin`);
    return res.json({ success: true, message: "Client déconnecté." });
});

// ─────────────────────────────────────────
// DOMICILE (connexions nano station)
// ─────────────────────────────────────────

app.get("/api/admin/domiciles", adminAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM domiciles ORDER BY id");
    res.json({ success: true, domiciles: mapRows(rows) });
});

app.post("/api/admin/domiciles", adminAuth, async (req, res) => {
    const { nom, telephone, mac, forfaitId, dateExpiration } = req.body;
    if (!nom || !telephone || !mac || !forfaitId || !dateExpiration)
        return res.status(400).json({ success: false, message: "Tous les champs sont requis." });
    const dup = await pool.query("SELECT 1 FROM domiciles WHERE LOWER(mac) = LOWER($1)", [mac.trim()]);
    if (dup.rowCount > 0) return res.status(409).json({ success: false, message: "Cette adresse MAC est déjà enregistrée." });
    const forfaitRes = await pool.query("SELECT * FROM forfaits WHERE id = $1", [parseInt(forfaitId)]);
    if (forfaitRes.rows.length === 0) return res.status(404).json({ success: false, message: "Forfait introuvable." });
    const forfait = mapRow(forfaitRes.rows[0]);
    const statut = new Date(dateExpiration) >= new Date() ? "actif" : "expire";
    const dRes = await pool.query(
        `INSERT INTO domiciles (nom, telephone, mac, forfait_id, forfait_nom, date_expiration, statut)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [nom.trim(), telephone.trim(), mac.trim().toUpperCase(), forfait.id, forfait.nom, dateExpiration, statut]
    );
    const d = mapRow(dRes.rows[0]);
    await ajouterLog("domicile", `Domicile "${d.nom}" enregistré`);
    return res.status(201).json({ success: true, message: "Connexion domicile enregistrée.", domicile: d });
});

app.patch("/api/admin/domiciles/:id", adminAuth, async (req, res) => {
    const current = await pool.query("SELECT * FROM domiciles WHERE id = $1", [parseInt(req.params.id)]);
    if (current.rows.length === 0) return res.status(404).json({ success: false, message: "Domicile introuvable." });
    const d = mapRow(current.rows[0]);

    const { nom, telephone, forfaitId, dateExpiration } = req.body;
    let forfaitNomFinal = d.forfaitNom;
    let forfaitIdFinal = d.forfaitId;
    if (forfaitId) {
        const forfaitRes = await pool.query("SELECT * FROM forfaits WHERE id = $1", [parseInt(forfaitId)]);
        if (forfaitRes.rows.length > 0) {
            const forfait = mapRow(forfaitRes.rows[0]);
            forfaitIdFinal = forfait.id;
            forfaitNomFinal = forfait.nom;
        }
    }
    const expirationFinale = dateExpiration || d.dateExpiration;
    const statutFinal = expirationFinale ? (new Date(expirationFinale) >= new Date() ? "actif" : "expire") : d.statut;

    const upRes = await pool.query(
        `UPDATE domiciles SET
            nom = $1, telephone = $2, forfait_id = $3, forfait_nom = $4,
            date_expiration = $5, statut = $6
         WHERE id = $7 RETURNING *`,
        [
            nom ? nom.trim() : d.nom,
            telephone ? telephone.trim() : d.telephone,
            forfaitIdFinal,
            forfaitNomFinal,
            expirationFinale,
            statutFinal,
            d.id
        ]
    );
    const updated = mapRow(upRes.rows[0]);
    await ajouterLog("domicile", `Domicile "${updated.nom}" mis à jour`);
    return res.json({ success: true, message: "Domicile mis à jour.", domicile: updated });
});

app.delete("/api/admin/domiciles/:id", adminAuth, async (req, res) => {
    const delRes = await pool.query("DELETE FROM domiciles WHERE id = $1 RETURNING nom", [parseInt(req.params.id)]);
    if (delRes.rowCount === 0) return res.status(404).json({ success: false, message: "Domicile introuvable." });
    await ajouterLog("domicile", `Domicile "${delRes.rows[0].nom}" supprimé`);
    return res.json({ success: true, message: "Domicile supprimé." });
});

// ─────────────────────────────────────────
// BLACKLIST
// ─────────────────────────────────────────

app.get("/api/admin/blacklist", adminAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM blacklist ORDER BY id");
    res.json({ success: true, blacklist: mapRows(rows) });
});

app.post("/api/admin/blacklist", adminAuth, async (req, res) => {
    const { type, valeur, raison } = req.body;
    if (!type || !valeur) return res.status(400).json({ success: false, message: "Type et valeur requis." });
    if (!["ip", "mac"].includes(type)) return res.status(400).json({ success: false, message: "Type doit être 'ip' ou 'mac'." });
    const dup = await pool.query("SELECT 1 FROM blacklist WHERE valeur = $1", [valeur]);
    if (dup.rowCount > 0) return res.status(409).json({ success: false, message: "Déjà dans la blacklist." });
    const bRes = await pool.query(
        "INSERT INTO blacklist (type, valeur, raison) VALUES ($1, $2, $3) RETURNING *",
        [type, valeur.trim(), raison?.trim() || ""]
    );
    const b = mapRow(bRes.rows[0]);
    await ajouterLog("blacklist", `${type.toUpperCase()} ${valeur} ajouté à la blacklist`);
    return res.status(201).json({ success: true, message: "Ajouté à la blacklist.", entree: b });
});

app.delete("/api/admin/blacklist/:id", adminAuth, async (req, res) => {
    const delRes = await pool.query("DELETE FROM blacklist WHERE id = $1 RETURNING valeur", [parseInt(req.params.id)]);
    if (delRes.rowCount === 0) return res.status(404).json({ success: false, message: "Entrée introuvable." });
    await ajouterLog("blacklist", `${delRes.rows[0].valeur} retiré de la blacklist`);
    return res.json({ success: true, message: "Retiré de la blacklist." });
});

// ─────────────────────────────────────────
// LOGS
// ─────────────────────────────────────────

app.get("/api/admin/logs", adminAuth, async (req, res) => {
    const { type } = req.query;
    const { rows } = type
        ? await pool.query("SELECT * FROM logs WHERE type = $1 ORDER BY id DESC LIMIT 100", [type])
        : await pool.query("SELECT * FROM logs ORDER BY id DESC LIMIT 100");
    res.json({ success: true, logs: mapRows(rows) });
});

app.delete("/api/admin/logs", adminAuth, async (req, res) => {
    await pool.query("TRUNCATE logs RESTART IDENTITY");
    return res.json({ success: true, message: "Journaux effacés." });
});

// ─────────────────────────────────────────
// PARAMÈTRES
// ─────────────────────────────────────────

app.get("/api/admin/parametres", adminAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM parametres WHERE id = 1");
    res.json({ success: true, parametres: mapRow(rows[0]) });
});

app.put("/api/admin/parametres", adminAuth, async (req, res) => {
    const { nomReseau, messageAccueil, logoTexte, couleurPrimaire, adminEmail } = req.body;
    const cur = mapRow((await pool.query("SELECT * FROM parametres WHERE id = 1")).rows[0]);
    const upRes = await pool.query(
        `UPDATE parametres SET nom_reseau = $1, message_accueil = $2, logo_texte = $3, couleur_primaire = $4, admin_email = $5
         WHERE id = 1 RETURNING *`,
        [
            nomReseau ? nomReseau.trim() : cur.nomReseau,
            messageAccueil ? messageAccueil.trim() : cur.messageAccueil,
            logoTexte ? logoTexte.trim() : cur.logoTexte,
            couleurPrimaire ? couleurPrimaire.trim() : cur.couleurPrimaire,
            adminEmail ? adminEmail.trim() : cur.adminEmail,
        ]
    );
    const parametres = mapRow(upRes.rows[0]);
    await ajouterLog("admin", "Paramètres mis à jour");
    return res.json({ success: true, message: "Paramètres sauvegardés.", parametres });
});

app.put("/api/admin/parametres/password", adminAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: "Mot de passe trop court (min 6 caractères)." });
    if (!currentPassword) return res.status(400).json({ success: false, message: "Mot de passe actuel requis." });

    const { rows } = await pool.query("SELECT password_hash FROM parametres WHERE id = 1");
    const match = await bcrypt.compare(currentPassword, rows[0]?.password_hash);
    if (!match) return res.status(401).json({ success: false, message: "Mot de passe actuel incorrect." });

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query("UPDATE parametres SET password_hash = $1 WHERE id = 1", [hash]);
    await ajouterLog("admin", "Mot de passe admin modifié");
    return res.json({ success: true, message: "Mot de passe modifié avec succès." });
});

// ─────────────────────────────────────────
// STATS & ÉTATS
// ─────────────────────────────────────────

app.get("/api/admin/stats", adminAuth, async (req, res) => {
    const parJourRows = await pool.query(`
        SELECT debut::date::text AS date, COUNT(*)::int AS connexions, COALESCE(SUM(montant), 0)::int AS recette
        FROM connexions
        WHERE debut >= (CURRENT_DATE - INTERVAL '6 days')
        GROUP BY 1
    `);
    const parJourMap = Object.fromEntries(parJourRows.rows.map(r => [r.date, r]));
    const parJour = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().slice(0, 10);
        const found = parJourMap[dateStr];
        parJour.push({ date: dateStr, connexions: found?.connexions || 0, recette: found?.recette || 0 });
    }

    const parForfaitRows = await pool.query(
        "SELECT forfait, COUNT(*)::int AS n FROM connexions WHERE forfait IS NOT NULL GROUP BY forfait"
    );
    const parForfait = {};
    parForfaitRows.rows.forEach(r => { parForfait[r.forfait] = r.n; });

    const dernieres = await pool.query("SELECT * FROM connexions ORDER BY id DESC LIMIT 20");

    res.json({ success: true, parJour, parForfait, connexions: mapRows(dernieres.rows) });
});

// ─────────────────────────────────────────
// COMPTABILITÉ
// ─────────────────────────────────────────

app.get("/api/admin/comptabilite", adminAuth, async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);

    const totaux = (await pool.query(`
        SELECT
            COALESCE(SUM(montant), 0)::int AS recette_total,
            COALESCE(SUM(CASE WHEN debut::date = $1::date THEN montant ELSE 0 END), 0)::int AS recette_aujourdhui
        FROM connexions
    `, [today])).rows[0];

    const parMoisRows = await pool.query(`
        SELECT to_char(debut, 'YYYY-MM') AS mois, COALESCE(SUM(montant), 0)::int AS total
        FROM connexions WHERE debut IS NOT NULL GROUP BY 1
    `);
    const parMois = {};
    parMoisRows.rows.forEach(r => { parMois[r.mois] = r.total; });

    const parForfaitRows = await pool.query(`
        SELECT forfait, COALESCE(SUM(montant), 0)::int AS total
        FROM connexions WHERE forfait IS NOT NULL GROUP BY forfait
    `);
    const parForfait = {};
    parForfaitRows.rows.forEach(r => { parForfait[r.forfait] = r.total; });

    const transactionsRows = await pool.query(
        "SELECT id, ticket, montant, forfait, debut AS date FROM connexions ORDER BY id DESC LIMIT 50"
    );

    res.json({
        success: true,
        recetteTotal: totaux.recette_total,
        recetteAujourdhui: totaux.recette_aujourdhui,
        parMois,
        parForfait,
        transactions: mapRows(transactionsRows.rows),
    });
});

// ─────────────────────────────────────────
// FINANCES — GESTION D'ARGENT COMPLÈTE
// ─────────────────────────────────────────

/**
 * GET /api/admin/finances
 * Vue complète de l'argent généré : total, par ticket, par forfait, par jour,
 * par mode de paiement, tickets gratuits, filtres.
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&forfaitId=X&gratuit=0|1
 */
app.get("/api/admin/finances", adminAuth, async (req, res) => {
    const { from, to, forfaitId, gratuit } = req.query;
    const filters = [];
    const params = [];

    if (from) {
        params.push(from);
        filters.push(`t.date_creation::date >= $${params.length}::date`);
    }
    if (to) {
        params.push(to);
        filters.push(`t.date_creation::date <= $${params.length}::date`);
    }
    if (forfaitId) {
        params.push(parseInt(forfaitId));
        filters.push(`t.forfait_id = $${params.length}`);
    }
    if (gratuit === "1") filters.push(`t.gratuit = true`);
    if (gratuit === "0") filters.push(`t.gratuit = false`);

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // ── Tickets payants avec leurs paiements
    const ticketsRows = await pool.query(`
        SELECT
            t.id, t.code, t.forfait_nom, t.prix, t.statut, t.telephone, t.operateur,
            t.gratuit, t.campay_reference, t.date_creation,
            c.debut AS connexion_debut, c.ip AS connexion_ip
        FROM tickets t
        LEFT JOIN connexions c ON c.ticket = t.code
        ${where}
        ORDER BY t.date_creation DESC
    `, params);

    const tickets = ticketsRows.rows.map(mapRow);

    // ── Totaux
    const totauxRows = await pool.query(`
        SELECT
            COUNT(*)::int AS total_tickets,
            COALESCE(SUM(CASE WHEN gratuit = false THEN prix ELSE 0 END), 0)::int AS recette_payante,
            COALESCE(SUM(CASE WHEN gratuit = true THEN prix ELSE 0 END), 0)::int AS recette_gratuite,
            COUNT(*) FILTER (WHERE gratuit = true)::int AS tickets_gratuits,
            COUNT(*) FILTER (WHERE gratuit = false)::int AS tickets_payants,
            COUNT(*) FILTER (WHERE statut = 'utilise')::int AS tickets_utilises,
            COUNT(*) FILTER (WHERE statut = 'disponible')::int AS tickets_disponibles
        FROM tickets t
        ${where}
    `, params);

    // ── Recettes par jour
    const parJourRows = await pool.query(`
        SELECT date_creation::date::text AS jour,
               COUNT(*)::int AS tickets,
               COALESCE(SUM(CASE WHEN gratuit = false THEN prix ELSE 0 END), 0)::int AS recette
        FROM tickets t
        ${where}
        GROUP BY 1 ORDER BY 1 DESC
    `, params);

    // ── Recettes par forfait
    const parForfaitRows = await pool.query(`
        SELECT COALESCE(forfait_nom, 'Inconnu') AS forfait,
               COUNT(*)::int AS tickets,
               COALESCE(SUM(CASE WHEN gratuit = false THEN prix ELSE 0 END), 0)::int AS recette
        FROM tickets t
        ${where}
        GROUP BY 1 ORDER BY recette DESC
    `, params);

    // ── Recettes par opérateur
    const parOperateurRows = await pool.query(`
        SELECT COALESCE(NULLIF(operateur, ''), 'Inconnu') AS operateur,
               COUNT(*)::int AS tickets,
               COALESCE(SUM(CASE WHEN gratuit = false THEN prix ELSE 0 END), 0)::int AS recette
        FROM tickets t
        ${where}
        GROUP BY 1 ORDER BY recette DESC
    `, params);

    // ── Connexions facturées (source de vérité pour la recette réelle)
    const connexionsRows = await pool.query(`
        SELECT c.id, c.ticket, c.ip, c.forfait, c.montant, c.debut, c.fin
        FROM connexions c
        ORDER BY c.debut DESC
        LIMIT 500
    `);

    const recetteReelle = connexionsRows.rows.reduce((sum, r) => sum + (r.montant || 0), 0);

    res.json({
        success: true,
        tickets,
        totaux: {
            ...totauxRows.rows[0],
            recetteReelle,
            totalEncaissable: totauxRows.rows[0].recette_payante
        },
        parJour: parJourRows.rows,
        parForfait: parForfaitRows.rows,
        parOperateur: parOperateurRows.rows,
        connexions: connexionsRows.rows.map(mapRow),
        filtres: { from: from || null, to: to || null, forfaitId: forfaitId || null, gratuit: gratuit || null }
    });
});

// ─────────────────────────────────────────
// MIKROTIK — ROUTES ADMIN
// ─────────────────────────────────────────

// Tester la connexion Mikrotik
app.get("/api/admin/mikrotik/test", adminAuth, async (req, res) => {
    const result = await mk.testerConnexion();
    if (result.success) {
        await ajouterLog("mikrotik", "Test connexion Mikrotik réussi");
    }
    res.json(result);
});

// Statut Mikrotik
app.get("/api/admin/mikrotik/statut", adminAuth, (req, res) => {
    res.json({
        success: true,
        enabled: mk.MIKROTIK_ENABLED,
        host: process.env.MIKROTIK_HOST || "192.168.88.1",
        port: process.env.MIKROTIK_PORT || "8728",
        user: process.env.MIKROTIK_USER || "admin",
        message: mk.MIKROTIK_ENABLED
            ? "Mikrotik activé — synchronisation automatique active"
            : "Mikrotik désactivé — mettre MIKROTIK_ENABLED=true dans .env pour activer"
    });
});

// Lister les profils Mikrotik
app.get("/api/admin/mikrotik/profils", adminAuth, async (req, res) => {
    const result = await mk.listerProfils();
    res.json(result);
});

// Lister les clients actifs sur Mikrotik
app.get("/api/admin/mikrotik/clients", adminAuth, async (req, res) => {
    const result = await mk.listerClientsActifs();
    res.json(result);
});

// Synchroniser tous les forfaits vers Mikrotik
app.post("/api/admin/mikrotik/sync-forfaits", adminAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM forfaits ORDER BY id");
    const allForfaits = mapRows(rows);
    const results = [];
    for (const f of allForfaits) {
        const r = await mk.creerProfilHotspot(f.profilMikrotik || f.nom, f.debit, f.quota);
        results.push({ forfait: f.nom, profil: f.profilMikrotik, ...r });
    }
    const success = results.filter(r => r.success).length;
    await ajouterLog("mikrotik", `Sync forfaits: ${success}/${allForfaits.length} profils synchronisés`);
    res.json({ success: true, message: `${success}/${allForfaits.length} profils synchronisés`, results });
});

// Synchroniser tous les tickets disponibles vers Mikrotik
app.post("/api/admin/mikrotik/sync-tickets", adminAuth, async (req, res) => {
    const { rows } = await pool.query(`
        SELECT t.code, f.profil_mikrotik, f.nom, f.duree
        FROM tickets t JOIN forfaits f ON f.id = t.forfait_id
        WHERE t.statut = 'disponible'
        ORDER BY t.id
    `);
    const results = [];
    for (const row of rows) {
        const r = await mk.creerUtilisateurHotspot(row.code, row.profil_mikrotik || row.nom, row.duree);
        results.push({ code: row.code, ...r });
    }
    const success = results.filter(r => r.success).length;
    await ajouterLog("mikrotik", `Sync tickets: ${success}/${rows.length} utilisateurs synchronisés`);
    res.json({ success: true, message: `${success}/${rows.length} tickets synchronisés`, results });
});

// Déconnecter un client sur Mikrotik par IP
app.delete("/api/admin/mikrotik/clients/:ip", adminAuth, async (req, res) => {
    const ip = req.params.ip;
    const result = await mk.deconnecterClient(ip);
    if (result.success) await ajouterLog("mikrotik", result.message);
    res.json(result);
});

// ─────────────────────────────────────────
// COMPTES PRIVILÉGIÉS — ROUTES ADMIN
// ─────────────────────────────────────────

// Lister tous les comptes privilégiés
app.get("/api/admin/comptes-privilegies", adminAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM comptes_privilegies ORDER BY id");
    res.json({ success: true, comptes: mapRows(rows) });
});

// Ajouter un compte privilégié (bypass portail captif par MAC)
app.post("/api/admin/comptes-privilegies", adminAuth, async (req, res) => {
    const { nom, telephone, mac, debit, commentaire } = req.body;
    if (!nom || !mac) return res.status(400).json({ success: false, message: "Nom et adresse MAC requis." });

    const macNorm = mac.trim().toUpperCase();

    // Vérifier doublon MAC
    const dup = await pool.query("SELECT 1 FROM comptes_privilegies WHERE mac = $1", [macNorm]);
    if (dup.rowCount > 0) return res.status(409).json({ success: false, message: "Cette adresse MAC est déjà enregistrée comme compte privilégié." });

    const cRes = await pool.query(
        `INSERT INTO comptes_privilegies (nom, telephone, mac, debit, commentaire, statut)
         VALUES ($1, $2, $3, $4, $5, 'actif') RETURNING *`,
        [nom.trim(), telephone?.trim() || "", macNorm, debit || "Illimité", commentaire?.trim() || ""]
    );
    const c = mapRow(cRes.rows[0]);
    await ajouterLog("privilege", `Compte privilégié "${c.nom}" (${c.mac}) ajouté — bypass portail captif activé`);

    // Synchroniser avec Mikrotik : ajouter la MAC en bypass hotspot
    const mkResult = await ajouterBypassMikrotik(c.mac, c.nom, c.debit);
    if (mkResult.success) {
        await ajouterLog("mikrotik", mkResult.message);
    }

    return res.status(201).json({
        success: true,
        message: `Compte privilégié "${c.nom}" créé. Accès internet sans portail captif activé.`,
        compte: c,
        mikrotik: mkResult
    });
});

// Activer / Suspendre un compte privilégié
app.patch("/api/admin/comptes-privilegies/:id/toggle", adminAuth, async (req, res) => {
    const upRes = await pool.query(
        `UPDATE comptes_privilegies SET statut = CASE WHEN statut = 'actif' THEN 'suspendu' ELSE 'actif' END
         WHERE id = $1 RETURNING *`,
        [parseInt(req.params.id)]
    );
    if (upRes.rowCount === 0) return res.status(404).json({ success: false, message: "Compte introuvable." });
    const c = mapRow(upRes.rows[0]);

    let mkResult;
    if (c.statut === "suspendu") {
        mkResult = await supprimerBypassMikrotik(c.mac);
        await ajouterLog("privilege", `Compte privilégié "${c.nom}" (${c.mac}) suspendu — bypass désactivé`);
    } else {
        mkResult = await ajouterBypassMikrotik(c.mac, c.nom, c.debit);
        await ajouterLog("privilege", `Compte privilégié "${c.nom}" (${c.mac}) réactivé — bypass activé`);
    }

    if (mkResult?.success) {
        await ajouterLog("mikrotik", mkResult.message);
    }

    return res.json({
        success: true,
        message: c.statut === "actif"
            ? `"${c.nom}" réactivé. Accès internet sans portail captif rétabli.`
            : `"${c.nom}" suspendu. L'appareil doit repasser par le portail captif.`,
        compte: c,
        mikrotik: mkResult
    });
});

// Supprimer un compte privilégié
app.delete("/api/admin/comptes-privilegies/:id", adminAuth, async (req, res) => {
    const delRes = await pool.query("DELETE FROM comptes_privilegies WHERE id = $1 RETURNING *", [parseInt(req.params.id)]);
    if (delRes.rowCount === 0) return res.status(404).json({ success: false, message: "Compte introuvable." });
    const c = mapRow(delRes.rows[0]);

    // Retirer le bypass Mikrotik
    const mkResult = await supprimerBypassMikrotik(c.mac);
    if (mkResult.success) {
        await ajouterLog("mikrotik", mkResult.message);
    }

    await ajouterLog("privilege", `Compte privilégié "${c.nom}" (${c.mac}) supprimé — bypass portail captif retiré`);
    return res.json({
        success: true,
        message: `Compte privilégié "${c.nom}" supprimé. L'appareil doit repasser par le portail captif.`,
        mikrotik: mkResult
    });
});

// ─────────────────────────────────────────
// FAPSHI — PAIEMENT MOBILE MONEY RÉEL
// ─────────────────────────────────────────

/**
 * Stockage en mémoire des paiements en cours (transId → contexte)
 * Permet de retrouver le contexte (forfait, appareil) lors de la vérification
 * sans le renvoyer au client (sécurité).
 * Structure : Map<transId, { forfaitId, telephone, operateur, appareilId, ip, dateInitiation }>
 */
const paiementsEnCours = new Map();

// Nettoyer les paiements en cours de plus de 2 heures (évite les fuites mémoire)
setInterval(() => {
    const limite = Date.now() - 2 * 3600 * 1000;
    for (const [ref, ctx] of paiementsEnCours.entries()) {
        if (ctx.dateInitiation < limite) {
            paiementsEnCours.delete(ref);
        }
    }
}, 30 * 60 * 1000);

/**
 * POST /api/paiement/initier
 * Initie un paiement Fapshi (Orange Money / MTN MoMo)
 * Body: { forfaitId, telephone, operateur, deviceId }
 */
app.post("/api/paiement/initier", rateLimit(5, 60000), async (req, res) => {
    const { forfaitId, telephone, operateur, deviceId } = req.body;

    if (!forfaitId || !telephone) {
        return res.status(400).json({ success: false, message: "Forfait et numéro de téléphone requis." });
    }

    if (!fapshi.estConfigure()) {
        return res.status(503).json({
            success: false,
            message: "Paiement Mobile Money non configuré. Contactez l'administrateur.",
            fapshiManquant: true
        });
    }

    const forfaitRes = await pool.query(
        "SELECT * FROM forfaits WHERE id = $1 AND statut = 'actif'",
        [parseInt(forfaitId)]
    );
    if (forfaitRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Forfait introuvable ou inactif." });
    }
    const forfait = mapRow(forfaitRes.rows[0]);

    if (forfait.gratuit) {
        return res.status(400).json({ success: false, message: "Ce forfait est gratuit. Utilisez /api/acces-gratuit." });
    }

    const ip = req.ip || "inconnu";
    const userAgent = req.headers["user-agent"] || "";
    const appareilId = genDeviceId(ip, userAgent, deviceId);

    // Vérifier si un paiement en cours existe déjà pour cet appareil + forfait
    for (const [ref, ctx] of paiementsEnCours.entries()) {
        if (
            ctx.appareilId === appareilId &&
            ctx.forfaitId === forfait.id &&
            Date.now() - ctx.dateInitiation < 5 * 60 * 1000
        ) {
            return res.json({
                success: true,
                reference: ref,
                message: "Paiement déjà en cours. Confirmez sur votre téléphone.",
                existant: true
            });
        }
    }

    const refExterne = `SMD-${Date.now()}-${appareilId.slice(0, 8).replace(/[^A-Z0-9]/gi, "")}`;

    const result = await fapshi.initierPaiement(
        telephone,
        forfait.prix,
        `Forfait Wi-Fi ${forfait.nom} — SMD-CONNECT`,
        refExterne
    );

    if (!result.success) {
        await ajouterLog("paiement", `❌ Échec initiation paiement Fapshi pour "${forfait.nom}" (${telephone}): ${result.message}`);
        return res.status(502).json({ success: false, message: result.message });
    }

    paiementsEnCours.set(result.transId, {
        forfaitId: forfait.id,
        telephone: telephone.trim(),
        operateur: operateur || "",
        appareilId,
        ip,
        dateInitiation: Date.now()
    });

    await ajouterLog("paiement", `📲 Paiement Fapshi initié — ${forfait.prix} FCFA pour "${forfait.nom}" (${telephone}, transId: ${result.transId})`);

    return res.json({
        success: true,
        reference: result.transId,
        message: result.message
    });
});

/**
 * POST /api/paiement/verifier
 * Vérifie le statut d'un paiement Fapshi et génère le ticket si succès
 * Body: { reference, deviceId }
 */
app.post("/api/paiement/verifier", rateLimit(60, 60000), async (req, res) => {
    const { reference, deviceId } = req.body;

    if (!reference) {
        return res.status(400).json({ success: false, message: "Référence de paiement requise." });
    }

    const ticketExistantRes = await pool.query("SELECT * FROM tickets WHERE campay_reference = $1", [reference]);
    if (ticketExistantRes.rows.length > 0) {
        const ticketExistant = mapRow(ticketExistantRes.rows[0]);
        const forfaitTicketRes = await pool.query("SELECT * FROM forfaits WHERE id = $1", [ticketExistant.forfaitId]);
        const forfaitTicket = forfaitTicketRes.rows.length > 0 ? mapRow(forfaitTicketRes.rows[0]) : { id: ticketExistant.forfaitId, nom: ticketExistant.forfaitNom };
        return res.json({
            success: true,
            status: "SUCCESSFUL",
            ticket: ticketExistant,
            forfait: forfaitTicket,
            existant: true,
            message: "Ticket déjà généré pour ce paiement."
        });
    }

    const ctx = paiementsEnCours.get(reference);
    const result = await fapshi.verifierPaiement(reference);

    if (!result.success) {
        return res.status(502).json({ success: false, message: result.message, status: "FAILED" });
    }

    if (result.status === "PENDING" || result.status === "CREATED") {
        return res.json({ success: true, status: result.status, message: result.message });
    }

    if (result.status === "FAILED" || result.status === "EXPIRED") {
        paiementsEnCours.delete(reference);
        const telLog = ctx?.telephone || "?";
        const nomForfaitLog = ctx ? ((await pool.query("SELECT nom FROM forfaits WHERE id = $1", [ctx.forfaitId])).rows[0]?.nom || `ID:${ctx.forfaitId}`) : "?";
        await ajouterLog("paiement", `❌ Paiement Fapshi ${result.status} — ref: ${reference}, forfait: "${nomForfaitLog}", tel: ${telLog}`);
        return res.json({ success: false, status: result.status, message: result.message });
    }

    if (result.status === "SUCCESSFUL") {
        let forfait = null;
        let ip = req.ip || "inconnu";
        let telephone = "";
        let operateur = "";
        let appareilId = "";

        if (ctx) {
            const fRes = await pool.query("SELECT * FROM forfaits WHERE id = $1", [ctx.forfaitId]);
            forfait = fRes.rows.length > 0 ? mapRow(fRes.rows[0]) : null;
            ip = ctx.ip || ip;
            telephone = ctx.telephone || "";
            operateur = ctx.operateur || result.medium || "";
            appareilId = ctx.appareilId || "";
        }

        if (!forfait) {
            const userAgent = req.headers["user-agent"] || "";
            appareilId = genDeviceId(ip, userAgent, deviceId);
            await ajouterLog("paiement", `⚠️ Paiement CONFIRMÉ mais contexte perdu — ref: ${reference}. Ticket non généré automatiquement.`);
            return res.status(409).json({
                success: false,
                status: "SUCCESSFUL",
                message: "Paiement confirmé mais contexte perdu (redémarrage serveur ?). Contactez l'assistance avec la référence : " + reference,
                reference
            });
        }

        const tRes = await pool.query(
            `INSERT INTO tickets (code, forfait_id, forfait_nom, prix, statut, ip_achat, telephone, operateur, appareil_id, campay_reference)
             VALUES ($1, $2, $3, $4, 'disponible', $5, $6, $7, $8, $9) RETURNING *`,
            [genCode(), forfait.id, forfait.nom, forfait.prix, ip, telephone, operateur, appareilId, reference]
        );
        const t = mapRow(tRes.rows[0]);
        paiementsEnCours.delete(reference);

        await ajouterLog("paiement", `✅ Paiement Fapshi CONFIRMÉ — ${forfait.prix} FCFA, forfait "${forfait.nom}", ticket ${t.code} (ref: ${reference}, tel: ${telephone})`);

        return res.status(201).json({
            success: true,
            status: "SUCCESSFUL",
            ticket: t,
            forfait,
            message: "Paiement confirmé ! Votre ticket a été généré."
        });
    }

    return res.json({ success: true, status: result.status, message: result.message });
});

/**
 * POST /api/paiement/webhook
 * Callback Fapshi (notification push de statut de paiement)
 * Vérifie le secret via header x-wh-secret
 */
app.post("/api/paiement/webhook", async (req, res) => {
    if (!fapshi.verifierWebhook(req)) {
        console.warn("⚠️ [Fapshi Webhook] Secret invalide");
        return res.status(403).json({ success: false, message: "Invalid webhook secret." });
    }

    const data = req.body;
    console.log("📩 [Fapshi Webhook] Reçu:", JSON.stringify(data));

    res.status(200).json({ success: true, message: "Webhook reçu." });

    try {
        const transId = data.transId;
        const status = data.status;

        if (!transId || !status) {
            console.warn("⚠️ [Webhook] Données incomplètes:", data);
            return;
        }

        const dejaLa = await pool.query("SELECT 1 FROM tickets WHERE campay_reference = $1", [transId]);
        if (dejaLa.rowCount > 0) {
            console.log(`ℹ️ [Webhook] Ticket déjà généré pour transId ${transId}`);
            return;
        }

        if (status === "SUCCESSFUL") {
            const ctx = paiementsEnCours.get(transId);
            if (!ctx) {
                console.warn(`⚠️ [Webhook] Contexte introuvable pour transId ${transId}`);
                await ajouterLog("paiement", `⚠️ Webhook Fapshi: paiement CONFIRMÉ mais contexte perdu — transId: ${transId}`);
                return;
            }

            const fRes = await pool.query("SELECT * FROM forfaits WHERE id = $1", [ctx.forfaitId]);
            if (fRes.rows.length === 0) {
                console.warn(`⚠️ [Webhook] Forfait introuvable pour transId ${transId}`);
                return;
            }
            const forfait = mapRow(fRes.rows[0]);

            const tRes = await pool.query(
                `INSERT INTO tickets (code, forfait_id, forfait_nom, prix, statut, ip_achat, telephone, operateur, appareil_id, campay_reference)
                 VALUES ($1, $2, $3, $4, 'disponible', $5, $6, $7, $8, $9) RETURNING *`,
                [genCode(), forfait.id, forfait.nom, forfait.prix, ctx.ip, ctx.telephone,
                 ctx.operateur || data.medium || "", ctx.appareilId, transId]
            );
            const t = mapRow(tRes.rows[0]);
            paiementsEnCours.delete(transId);

            await ajouterLog("paiement", `✅ [Webhook] Paiement CONFIRMÉ — ${forfait.prix} FCFA, "${forfait.nom}", ticket ${t.code} (transId: ${transId})`);
            console.log(`✅ [Webhook] Ticket ${t.code} généré pour transId ${transId}`);

        } else if (status === "FAILED") {
            paiementsEnCours.delete(transId);
            await ajouterLog("paiement", `❌ [Webhook] Paiement ÉCHOUÉ — transId: ${transId}`);
        }
    } catch (err) {
        console.error("❌ [Webhook] Erreur traitement:", err.message);
    }
});

/**
 * GET /api/fapshi/statut
 * Retourne le statut de la configuration Fapshi (public)
 */
app.get("/api/fapshi/statut", (req, res) => {
    res.json({
        success: true,
        configure: fapshi.estConfigure(),
        baseUrl: fapshi.FAPSHI_BASE_URL,
        message: fapshi.estConfigure()
            ? "Fapshi configuré — paiement Mobile Money actif"
            : "Fapshi non configuré — ajoutez FAPSHI_API_USER et FAPSHI_API_KEY dans .env"
    });
});

/**
 * GET /api/admin/fapshi/statut
 * Statut Fapshi pour l'admin (avec test de connexion + paiements en cours)
 */
app.get("/api/admin/fapshi/statut", adminAuth, async (req, res) => {
    const configure = fapshi.estConfigure();
    let configOk = configure;
    let erreur = null;

    const etat = fapshi.etatToken();

    res.json({
        success: true,
        configure,
        configOk,
        baseUrl: fapshi.FAPSHI_BASE_URL,
        paiementsEnCours: paiementsEnCours.size,
        erreur,
        message: !configure
            ? "Fapshi non configuré. Ajoutez FAPSHI_API_USER et FAPSHI_API_KEY dans .env"
            : "✅ Fapshi opérationnel — clés API configurées"
    });
});

/**
 * GET /api/admin/fapshi/paiements
 * Liste les paiements en cours et l'historique des paiements Fapshi
 */
app.get("/api/admin/fapshi/paiements", adminAuth, async (req, res) => {
    const enCours = [];
    for (const [ref, ctx] of paiementsEnCours.entries()) {
        const fRes = await pool.query("SELECT nom, prix FROM forfaits WHERE id = $1", [ctx.forfaitId]);
        const forfait = fRes.rows[0];
        enCours.push({
            reference: ref,
            forfait: forfait?.nom || `ID:${ctx.forfaitId}`,
            montant: forfait?.prix || 0,
            telephone: ctx.telephone,
            operateur: ctx.operateur,
            ip: ctx.ip,
            dateInitiation: new Date(ctx.dateInitiation).toISOString(),
            ageMins: Math.round((Date.now() - ctx.dateInitiation) / 60000)
        });
    }

    const historiqueRows = await pool.query(
        `SELECT code, campay_reference, forfait_nom, prix, telephone, operateur, statut, date_creation
         FROM tickets WHERE campay_reference IS NOT NULL ORDER BY id DESC LIMIT 50`
    );
    const historique = historiqueRows.rows.map(r => ({
        code: r.code,
        reference: r.campay_reference,
        forfait: r.forfait_nom,
        montant: r.prix,
        telephone: r.telephone,
        operateur: r.operateur,
        statut: r.statut,
        date: r.date_creation
    }));

    res.json({
        success: true,
        enCours,
        historique,
        totalEnCours: enCours.length,
        totalHistorique: historique.length
    });
});

/**
 * POST /api/admin/fapshi/forcer-verification/:reference
 * Forcer la vérification d'un paiement en cours (outil admin)
 */
app.post("/api/admin/fapshi/forcer-verification/:reference", adminAuth, async (req, res) => {
    const { reference } = req.params;

    const result = await fapshi.verifierPaiement(reference);
    if (!result.success) {
        return res.status(502).json({ success: false, message: result.message });
    }

    if (result.status === "SUCCESSFUL") {
        const dejaLa = await pool.query("SELECT * FROM tickets WHERE campay_reference = $1", [reference]);
        if (dejaLa.rowCount > 0) {
            return res.json({ success: true, status: "SUCCESSFUL", ticket: mapRow(dejaLa.rows[0]), message: "Ticket déjà existant." });
        }

        const ctx = paiementsEnCours.get(reference);
        if (!ctx) {
            return res.status(404).json({
                success: false,
                message: "Paiement confirmé mais contexte introuvable. Créez le ticket manuellement.",
                status: "SUCCESSFUL"
            });
        }

        const fRes = await pool.query("SELECT * FROM forfaits WHERE id = $1", [ctx.forfaitId]);
        if (fRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Forfait introuvable." });
        }
        const forfait = mapRow(fRes.rows[0]);

        const tRes = await pool.query(
            `INSERT INTO tickets (code, forfait_id, forfait_nom, prix, statut, ip_achat, telephone, operateur, appareil_id, campay_reference)
             VALUES ($1, $2, $3, $4, 'disponible', $5, $6, $7, $8, $9) RETURNING *`,
            [genCode(), forfait.id, forfait.nom, forfait.prix, ctx.ip, ctx.telephone,
             ctx.operateur || result.medium || "", ctx.appareilId, reference]
        );
        const t = mapRow(tRes.rows[0]);
        paiementsEnCours.delete(reference);

        await ajouterLog("paiement", `✅ [Admin] Ticket ${t.code} généré manuellement pour ref ${reference} (${forfait.nom})`);

        return res.json({ success: true, status: "SUCCESSFUL", ticket: t, forfait, message: "Ticket généré avec succès." });
    }

    return res.json({ success: true, status: result.status, message: result.message });
});

// ─────────────────────────────────────────
// EXPIRATION AUTOMATIQUE DES TICKETS
// ─────────────────────────────────────────

/**
 * Vérifie et expire les tickets/connexions dépassés
 */
async function verifierExpirations() {
    try {
        // Expirer les tickets disponibles trop anciens (> 24h sans utilisation)
        const ticketsExpires = await pool.query(
            `SELECT id, code FROM tickets
             WHERE statut = 'disponible' AND date_creation < now() - INTERVAL '24 hours'`
        );
        for (const t of ticketsExpires.rows) {
            await pool.query("UPDATE tickets SET statut = 'expire' WHERE id = $1", [t.id]);
            await ajouterLog("ticket", `Ticket ${t.code} expiré automatiquement (non utilisé après 24h)`);
        }

        // Expirer les connexions actives dont la durée est dépassée → déconnecter sur Mikrotik
        const ouvertes = await pool.query(`
            SELECT c.id, c.ticket, c.ip, c.debut, f.duree, f.profil_mikrotik
            FROM connexions c
            LEFT JOIN tickets t ON t.code = c.ticket
            LEFT JOIN forfaits f ON f.id = t.forfait_id
            WHERE c.fin IS NULL AND c.debut IS NOT NULL
        `);
        const now = Date.now();
        for (const c of ouvertes.rows) {
            const dureeMs = dureeEnMs(c.duree);
            if (dureeMs && (now - new Date(c.debut).getTime()) > dureeMs) {
                // Marquer la connexion comme terminée
                await pool.query("UPDATE connexions SET fin = now() WHERE id = $1", [c.id]);

                // Déconnecter le client sur Mikrotik
                if (mk.MIKROTIK_ENABLED && c.ip) {
                    try {
                        await mk.deconnecterClient(c.ip);
                        // Supprimer l'utilisateur hotspot du ticket expiré
                        if (c.ticket) {
                            await mk.supprimerUtilisateurHotspot(c.ticket);
                        }
                    } catch (e) {
                        console.error(`Mikrotik disconnect ${c.ip} error:`, e.message);
                    }
                }

                // Mettre à jour le statut du client
                try {
                    await pool.query("UPDATE clients SET statut = 'deconnecte' WHERE ip = $1 AND statut = 'connecte'", [c.ip]);
                } catch {}

                await ajouterLog("connexion", `Connexion ${c.ticket} (${c.ip}) expirée — durée ${c.duree} écoulée`);
            }
        }

        // Expirer les domiciles
        const domicilesExpires = await pool.query(
            `SELECT id, nom FROM domiciles
             WHERE statut = 'actif' AND date_expiration IS NOT NULL AND date_expiration < now()`
        );
        for (const d of domicilesExpires.rows) {
            await pool.query("UPDATE domiciles SET statut = 'expire' WHERE id = $1", [d.id]);
            await ajouterLog("domicile", `Domicile "${d.nom}" expiré automatiquement`);
        }

        // Mettre à jour les clients dont la connexion est expirée
        try {
            await pool.query(`
                UPDATE clients SET statut = 'deconnecte'
                WHERE statut = 'connecte'
                AND ip IN (
                    SELECT c2.ip FROM connexions c2
                    LEFT JOIN tickets t2 ON t2.code = c2.ticket
                    LEFT JOIN forfaits f2 ON f2.id = t2.forfait_id
                    WHERE c2.fin IS NOT NULL
                )
            `);
        } catch {}

        // Limiter la table logs aux 500 dernières entrées
        await pool.query(`
            DELETE FROM logs
            WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)
        `);
    } catch (e) {
        console.error("Erreur verifierExpirations:", e.message);
    }
}

// Vérifier les expirations toutes les 5 minutes
setInterval(verifierExpirations, 5 * 60 * 1000);

// ─────────────────────────────────────────
// GESTION D'ERREURS (réponses JSON propres)
// ─────────────────────────────────────────

app.use((err, req, res, next) => {
    console.error("Erreur serveur:", err.message);
    if (!res.headersSent) {
        res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});

// ─────────────────────────────────────────
// DÉMARRAGE
// ─────────────────────────────────────────

(async () => {
    try {
        await db.initDb();
        // Vérifier les expirations au démarrage
        await verifierExpirations();

        app.listen(PORT, () => {
            console.log(`\n🚀 Serveur SMD-CONNECT démarré sur http://localhost:${PORT}`);
            console.log(`📡 Mikrotik: ${mk.MIKROTIK_ENABLED ? "✅ Activé (" + (process.env.MIKROTIK_HOST || "192.168.88.1") + ")" : "❌ Désactivé (MIKROTIK_ENABLED=false)"}`);
            console.log(`🔐 Admin: mot de passe hashé (bcrypt + JWT)`);
            console.log(`💾 Données: PostgreSQL (${process.env.PGDATABASE || "portail_captif"} @ ${process.env.PGHOST || "localhost"})\n`);
        });
    } catch (e) {
        console.error("❌ Impossible de démarrer le serveur:", e.message);
        process.exit(1);
    }
})();
