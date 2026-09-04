/**
 * seed.js — Migration one-time de data.json vers PostgreSQL
 * Préserve les IDs d'origine puis réaligne les séquences.
 * Usage : node seed.js
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { pool, initSchema } = require("./db");

const DATA_FILE = path.join(__dirname, "data.json");

async function main() {
    await initSchema();

    if (!fs.existsSync(DATA_FILE)) {
        console.log("ℹ️  data.json introuvable — rien à migrer.");
        return;
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    // Restaurer le contenu de data.json : on vide les tables de données
    // (hotspots et parametres par défaut sont conservés/complétés)
    await pool.query(
        `TRUNCATE appareils_gratuits, tickets, connexions, logs,
                         domiciles, comptes_privilegies, blacklist,
                         forfaits RESTART IDENTITY CASCADE`
    );
    console.log("🧹 Tables de données vidées");

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // ─── Forfaits ──────────────────────────────────────────────────
        for (const f of data.forfaits || []) {
            await client.query(
                `INSERT INTO forfaits (id, nom, prix, quota, debit, duree, profil_mikrotik, statut, gratuit, appareil_unique, date_creation)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                 ON CONFLICT (id) DO NOTHING`,
                [f.id, f.nom, f.prix || 0, f.quota || "Illimité", f.debit || "10 Mbps", f.duree || "10 minutes",
                 f.profilMikrotik || null, f.statut || "actif", f.gratuit === true,
                 f.appareilUnique === true, f.dateCreation || new Date().toISOString()]
            );
        }
        console.log(`✅ ${data.forfaits?.length || 0} forfaits migrés`);

        // ─── Tickets ───────────────────────────────────────────────────
        for (const t of data.tickets || []) {
            await client.query(
                `INSERT INTO tickets (id, code, forfait_id, forfait_nom, prix, statut, ip_achat, telephone, operateur, appareil_id, gratuit, campay_reference, date_creation)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                 ON CONFLICT (id) DO NOTHING`,
                [t.id, t.code, t.forfaitId || null, t.forfaitNom || null, t.prix || 0, t.statut || "disponible",
                 t.ipAchat || null, t.telephone || null, t.operateur || null, t.appareilId || null,
                 t.gratuit === true, t.campayReference || null, t.dateCreation || new Date().toISOString()]
            );
        }
        console.log(`✅ ${data.tickets?.length || 0} tickets migrés`);

        // ─── Connexions ────────────────────────────────────────────────
        for (const c of data.connexions || []) {
            await client.query(
                `INSERT INTO connexions (id, ticket, ip, debut, fin, forfait, montant)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
                [c.id, c.ticket || null, c.ip || null, c.debut || new Date().toISOString(),
                 c.fin || null, c.forfait || null, c.montant || 0]
            );
        }
        console.log(`✅ ${data.connexions?.length || 0} connexions migrées`);

        // ─── Domiciles ─────────────────────────────────────────────────
        for (const d of data.domiciles || []) {
            await client.query(
                `INSERT INTO domiciles (id, nom, telephone, mac, forfait_id, forfait_nom, date_expiration, statut, date_creation)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
                [d.id, d.nom, d.telephone || null, d.mac || null, d.forfaitId || null, d.forfaitNom || null,
                 d.dateExpiration || null, d.statut || "actif", d.dateCreation || new Date().toISOString()]
            );
        }
        console.log(`✅ ${(data.domiciles || []).length} domiciles migrés`);

        // ─── Comptes privilégiés ───────────────────────────────────────
        for (const c of data.comptesPrivilegies || []) {
            await client.query(
                `INSERT INTO comptes_privilegies (id, nom, telephone, mac, debit, commentaire, statut, date_creation)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
                [c.id, c.nom, c.telephone || null, c.mac || null, c.debit || "Illimité",
                 c.commentaire || null, c.statut || "actif", c.dateCreation || new Date().toISOString()]
            );
        }
        console.log(`✅ ${(data.comptesPrivilegies || []).length} comptes privilégiés migrés`);

        // ─── Blacklist ─────────────────────────────────────────────────
        for (const b of data.blacklist || []) {
            await client.query(
                `INSERT INTO blacklist (id, type, valeur, raison, date_ajout)
                 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
                [b.id, b.type, b.valeur, b.raison || null, b.dateAjout || new Date().toISOString()]
            );
        }
        console.log(`✅ ${(data.blacklist || []).length} entrées blacklist migrées`);

        // ─── Logs ──────────────────────────────────────────────────────
        for (const l of data.logs || []) {
            await client.query(
                `INSERT INTO logs (id, type, message, date) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
                [l.id, l.type || "systeme", l.message || "", l.date || new Date().toISOString()]
            );
        }
        console.log(`✅ ${data.logs?.length || 0} logs migrés`);

        // ─── Paramètres ────────────────────────────────────────────────
        if (data.parametres) {
            const p = data.parametres;
            await client.query(
                `INSERT INTO parametres (id, nom_reseau, message_accueil, logo_texte, couleur_primaire, admin_email)
                 VALUES (1,$1,$2,$3,$4,$5)
                 ON CONFLICT (id) DO UPDATE SET
                    nom_reseau = EXCLUDED.nom_reseau,
                    message_accueil = EXCLUDED.message_accueil,
                    logo_texte = EXCLUDED.logo_texte,
                    couleur_primaire = EXCLUDED.couleur_primaire,
                    admin_email = EXCLUDED.admin_email`,
                [p.nomReseau, p.messageAccueil, p.logoTexte, p.couleurPrimaire, p.adminEmail]
            );
            console.log("✅ paramètres migrés");
        }

        // ─── Appareils gratuits ────────────────────────────────────────
        for (const a of data.appareils_gratuits || []) {
            await client.query(
                `INSERT INTO appareils_gratuits (appareil_id, forfait_id, ticket_code, ip, date_utilisation)
                 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (appareil_id, forfait_id) DO NOTHING`,
                [a.appareilId, a.forfaitId, a.ticketCode || null, a.ip || null, a.dateUtilisation || new Date().toISOString()]
            );
        }
        console.log(`✅ ${(data.appareils_gratuits || []).length} appareils gratuits migrés`);

        // ─── Réaligner les séquences sur les max(id) importés ─────────
        const seqTables = ["forfaits", "tickets", "connexions", "domiciles", "comptes_privilegies", "blacklist", "logs"];
        for (const table of seqTables) {
            await client.query(
                `SELECT setval(pg_get_serial_sequence('${table}', 'id'),
                        COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`
            );
        }
        console.log("✅ séquences réalignées");

        await client.query("COMMIT");
        console.log("\n🎉 Migration terminée avec succès !");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Migration échouée, rollback effectué:", err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
