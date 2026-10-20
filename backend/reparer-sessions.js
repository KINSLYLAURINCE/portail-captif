/**
 * reparer-sessions.js — Réparation one-shot (à lancer après déploiement) :
 *  1. Corrige limit-uptime des utilisateurs hotspot "ST-*" existants dont la
 *    valeur ne correspond pas à la durée du forfait en DB (bug historique
 *    dureeMap : "10 minutes" → fallback 1h).
 *  2. Déconnecte les sessions orphelines (user supprimé de /ip/hotspot/user
 *    mais session encore active) et celles qui dépassent la durée réelle.
 *
 * Usage : cd /opt/portail-captif/backend && node reparer-sessions.js
 */
require("dotenv").config();
const mk = require("./mikrotik");
const { pool } = require("./db");

function dureeEnMs(duree) {
    if (!duree) return null;
    const map = {
        "5 minutes": 5 * 60 * 1000, "10 minutes": 10 * 60 * 1000,
        "15 minutes": 15 * 60 * 1000, "20 minutes": 20 * 60 * 1000,
        "30 minutes": 30 * 60 * 1000, "45 minutes": 45 * 60 * 1000,
        "1 heure": 3600 * 1000, "2 heures": 2 * 3600 * 1000,
        "3 heures": 3 * 3600 * 1000, "6 heures": 6 * 3600 * 1000,
        "12 heures": 12 * 3600 * 1000, "24 heures": 24 * 3600 * 1000,
        "3 jours": 3 * 86400 * 1000, "7 jours": 7 * 86400 * 1000,
        "30 jours": 30 * 86400 * 1000,
    };
    return map[duree] || null;
}

function dureeEnFormatMK(duree) {
    const map = {
        "5 minutes": "00:05:00", "10 minutes": "00:10:00", "15 minutes": "00:15:00",
        "20 minutes": "00:20:00", "30 minutes": "00:30:00", "45 minutes": "00:45:00",
        "1 heure": "01:00:00", "2 heures": "02:00:00", "3 heures": "03:00:00",
        "6 heures": "06:00:00", "12 heures": "12:00:00", "24 heures": "1d",
        "3 jours": "3d", "7 jours": "7d", "30 jours": "30d", "Illimité": "0s",
    };
    return map[duree] || null;
}

function uptimeSec(u) {
    if (!u) return 0;
    let s = 0;
    const f = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
    const m = String(u).match(/(\d+)([wdhms])/g);
    if (!m) return 0;
    for (const pair of m) s += parseInt(pair) * (f[pair.slice(-1)] || 0);
    return s;
}

function limitSec(l) {
    if (!l) return 0;
    const v = String(l);
    if (/^\d+:\d\d:\d\d/.test(v)) {
        const p = v.split(":").map(Number);
        return p[0] * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
    }
    if (v === "0s" || v === "0") return 0;
    return uptimeSec(v);
}

(async () => {
    if (!mk.MIKROTIK_ENABLED) { console.log("MIKROTIK_ENABLED=false — abort."); process.exit(1); }

    // ── 1. Users ST-* : corriger limit-uptime selon la DB ─────────────────
    const usersRes = await mk.listerUtilisateursHotspot();
    const users = (usersRes.data || []).filter(u => u.name && /^ST-[A-Z0-9]+$/.test(u.name));
    console.log(`Users ST-* trouvés: ${users.length}`);

    const codes = users.map(u => u.name);
    let tickets = [];
    if (codes.length) {
        const tRes = await pool.query(
            `SELECT t.code, f.duree FROM tickets t JOIN forfaits f ON f.id = t.forfait_id WHERE t.code = ANY($1)`,
            [codes]
        );
        tickets = tRes.rows;
    }
    const dureeParCode = new Map(tickets.map(t => [t.code, t.duree]));

    let corriges = 0;
    for (const u of users) {
        const duree = dureeParCode.get(u.name);
        if (!duree) continue;
        const attendu = dureeEnFormatMK(duree);
        if (!attendu) continue;
        const actuel = u["limit-uptime"] || "";
        const actuelSec = limitSec(actuel);
        const attenduSec = Math.round((dureeEnMs(duree) || 0) / 1000);
        // Forfait Illimité → dureeEnMs=null → 0s (limit-uptime sans plafond)
        if (actuelSec === attenduSec) continue;
        try {
            const r = await mk.modifierLimitUptimeUtilisateur(u.name, attendu);
            if (r.success) {
                console.log(`  FIX ${u.name}: limit-uptime ${actuel || "?"} → ${attendu} (forfait "${duree}")`);
                corriges++;
            } else {
                console.log(`  ERREUR ${u.name}: ${r.message}`);
            }
        } catch (e) {
            console.log(`  ERREUR ${u.name}: ${e.message}`);
        }
    }
    console.log(`limit-uptime corrigés: ${corriges}`);

    // ── 2. Sessions actives : orphelins + dépassements ────────────────────
    const actifsRes = await mk.listerClientsActifs();
    const actifs = actifsRes.data || [];
    const nomsUsers = new Set(users.map(u => u.name));
    const infoParCode = new Map(users.map(u => [u.name, u]));

    let deconnectes = 0;
    for (const a of actifs) {
        if (!a.user || !/^ST-[A-Z0-9]+$/.test(a.user)) continue;
        const u = infoParCode.get(a.user);
        let raison = null;
        if (!u) {
            raison = "orphelin (user supprimé)";
        } else {
            const l = limitSec(u["limit-uptime"]);
            const up = uptimeSec(a.uptime);
            if (l > 0 && up >= l) raison = `dépasse limit-uptime (${a.uptime} >= ${u["limit-uptime"]})`;
        }
        if (raison) {
            const r = await mk.deconnecterSessionParUtilisateur(a.user);
            console.log(`  KICK ${a.user} @${a.address}: ${raison} → ${r.message}`);
            deconnectes++;
        }
    }
    console.log(`sessions déconnectées: ${deconnectes}`);

    await pool.end();
    console.log("=== RÉPARATION TERMINÉE ===");
    process.exit(0);
})().catch(e => { console.error("ERREUR FATALE:", e.message); process.exit(1); });
