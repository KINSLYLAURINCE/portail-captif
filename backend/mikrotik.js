/**
 * mikrotik.js — Module de communication avec l'API RouterOS Mikrotik
 * Utilise le protocole API Mikrotik (port 8728) via TCP natif Node.js
 * Sans dépendance externe
 */

const net = require("net");

// ─── Configuration ─────────────────────────────────────────────────────────
const MIKROTIK_HOST     = process.env.MIKROTIK_HOST     || "192.168.88.1";
const MIKROTIK_PORT     = parseInt(process.env.MIKROTIK_PORT) || 8728;
const MIKROTIK_USER     = process.env.MIKROTIK_USER     || "admin";
const MIKROTIK_PASSWORD = process.env.MIKROTIK_PASSWORD || "";
const MIKROTIK_ENABLED  = process.env.MIKROTIK_ENABLED  === "true";

// ─── Utilitaires de parse de durées RouterOS ───────────────────────────────
function parseTempsSec(val) {
    if (!val) return 0;
    const v = String(val);
    if (/^\d+:\d\d:\d\d/.test(v)) {
        const p = v.split(":").map(Number);
        return (p[0] * 3600) + ((p[1] || 0) * 60) + (p[2] || 0);
    }
    if (v === "0s" || v === "0") return 0;
    const m = v.match(/(\d+)([wdhms])/g);
    if (!m) return 0;
    const f = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
    let s = 0;
    for (const pair of m) s += parseInt(pair) * (f[pair.slice(-1)] || 0);
    return s;
}

// ─── Encodage du protocole API Mikrotik ────────────────────────────────────
function encodeLength(len) {
    if (len < 0x80) return Buffer.from([len]);
    if (len < 0x4000) return Buffer.from([(len >> 8) | 0x80, len & 0xFF]);
    if (len < 0x200000) return Buffer.from([(len >> 16) | 0xC0, (len >> 8) & 0xFF, len & 0xFF]);
    return Buffer.from([(len >> 24) | 0xE0, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF]);
}

function encodeWord(word) {
    const buf = Buffer.from(word, "utf8");
    return Buffer.concat([encodeLength(buf.length), buf]);
}

function encodeSentence(words) {
    const parts = words.map(encodeWord);
    parts.push(Buffer.from([0])); // fin de sentence
    return Buffer.concat(parts);
}

// ─── Connexion et exécution d'une commande ─────────────────────────────────
function mikrotikCommand(words, timeout = 5000) {
    return new Promise((resolve, reject) => {
        if (!MIKROTIK_ENABLED) {
            return resolve({ success: false, message: "Mikrotik désactivé (MIKROTIK_ENABLED=false)" });
        }

        const socket = new net.Socket();
        let buffer = Buffer.alloc(0);
        let authenticated = false;
        let current = null;
        let consumed = 0;
        const results = [];

        // Parser incrémental : consume les octets traités pour ne pas re-lire
        // les anciennes réponses (ex: le !done du login) à chaque événement data.
        function parseBuffer() {
            const sentences = [];
            let i = 0;
            while (i < buffer.length) {
                const itemStart = i;
                let len = 0;
                const b = buffer[i];
                if (b < 0x80) { len = b; i += 1; }
                else if (b < 0xC0) {
                    if (i + 2 > buffer.length) { i = itemStart; break; }
                    len = ((b & 0x3F) << 8) | buffer[i + 1]; i += 2;
                }
                else if (b < 0xE0) {
                    if (i + 3 > buffer.length) { i = itemStart; break; }
                    len = ((b & 0x1F) << 16) | (buffer[i + 1] << 8) | buffer[i + 2]; i += 3;
                }
                else {
                    if (i + 4 > buffer.length) { i = itemStart; break; }
                    len = ((b & 0x0F) << 24) | (buffer[i + 1] << 16) | (buffer[i + 2] << 8) | buffer[i + 3]; i += 4;
                }

                if (len === 0) {
                    sentences.push(current || {});
                    current = null;
                    consumed = i;
                    continue;
                }

                if (i + len > buffer.length) { i = itemStart; break; }

                const word = buffer.slice(i, i + len).toString("utf8");
                i += len;
                consumed = i;

                if (word === "!done") { sentences.push({ __reply: "done" }); }
                else if (word === "!re") { current = { __reply: "re" }; }
                else if (word === "!trap") { current = { __reply: "trap" }; }
                else if (word.startsWith("=")) {
                    const eq = word.indexOf("=", 1);
                    if (eq > 0) {
                        if (!current) current = { __reply: "re" };
                        current[word.slice(1, eq)] = word.slice(eq + 1);
                    }
                } else if (word.startsWith(".id=")) {
                    if (!current) current = { __reply: "re" };
                    current[".id"] = word.slice(4);
                }
            }
            if (consumed > 0) {
                buffer = buffer.slice(consumed);
                consumed = 0;
            }
            return sentences;
        }

        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error("Timeout connexion Mikrotik"));
        }, timeout);

        socket.connect(MIKROTIK_PORT, MIKROTIK_HOST, () => {
            // Envoyer login
            socket.write(encodeSentence([
                "/login",
                `=name=${MIKROTIK_USER}`,
                `=password=${MIKROTIK_PASSWORD}`
            ]));
        });

        socket.on("data", (data) => {
            buffer = Buffer.concat([buffer, data]);
            const sentences = parseBuffer();

            for (const s of sentences) {
                if (!authenticated) {
                    if (s.__reply === "done" || s.__reply === "re") {
                        authenticated = true;
                        // Envoyer la vraie commande
                        socket.write(encodeSentence(words));
                    } else if (s.__reply === "trap") {
                        clearTimeout(timer);
                        socket.destroy();
                        reject(new Error(`Erreur login Mikrotik: ${s.message || "Identifiants incorrects"}`));
                        return;
                    }
                } else {
                    if (s.__reply === "done") {
                        clearTimeout(timer);
                        socket.destroy();
                        resolve({ success: true, data: results });
                        return;
                    } else if (s.__reply === "trap") {
                        clearTimeout(timer);
                        socket.destroy();
                        reject(new Error(`Erreur Mikrotik: ${s.message || "Commande échouée"}`));
                        return;
                    } else if (s.__reply === "re") {
                        results.push(s);
                    }
                }
            }
        });

        socket.on("error", (err) => {
            clearTimeout(timer);
            reject(new Error(`Connexion Mikrotik impossible: ${err.message}`));
        });

        socket.on("close", () => {
            clearTimeout(timer);
        });
    });
}

// ─── Fonctions publiques ────────────────────────────────────────────────────

/**
 * Tester la connexion au Mikrotik
 */
async function testerConnexion() {
    try {
        const result = await mikrotikCommand(["/system/identity/print"]);
        if (!result.success) return { success: false, message: result.message || "Erreur connexion Mikrotik" };
        return { success: true, message: "Connexion Mikrotik réussie", data: result.data };
    } catch (err) {
        return { success: false, message: err.message };
    }
}

/**
 * Créer un profil Hotspot sur Mikrotik
 * @param {string} nom - Nom du profil
 * @param {string} debit - Ex: "10M" ou "10 Mbps"
 * @param {string} quota - Ex: "1G" ou "1 Go"
 */
async function creerProfilHotspot(nom, debit, quota) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };

    // Convertir le débit en format Mikrotik (ex: "10 Mbps" → "10M")
    const debitMK = debit.replace(" Mbps", "M").replace(" Kbps", "K").replace("Illimité", "0");
    const quotaMK = quota ? quota.replace(" Go", "G").replace(" Mo", "M").replace("Illimité", "0") : "0";

    try {
        // Vérifier si le profil existe déjà
        const existing = await mikrotikCommand([
            "/ip/hotspot/user/profile/print",
            `?name=${nom}`
        ]);

        if (existing.data && existing.data.length > 0) {
            // Mettre à jour le profil existant
            const id = existing.data[0][".id"];
            await mikrotikCommand([
                "/ip/hotspot/user/profile/set",
                `=.id=${id}`,
                `=rate-limit=${debitMK}/${debitMK}`,
            ]);
            return { success: true, message: `Profil "${nom}" mis à jour sur Mikrotik` };
        } else {
            // Créer le profil
            await mikrotikCommand([
                "/ip/hotspot/user/profile/add",
                `=name=${nom}`,
                `=rate-limit=${debitMK}/${debitMK}`,
                `=shared-users=1`,
            ]);
            return { success: true, message: `Profil "${nom}" créé sur Mikrotik` };
        }
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik: ${err.message}` };
    }
}

/**
 * Supprimer un profil Hotspot sur Mikrotik
 */
async function supprimerProfilHotspot(nom) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        const existing = await mikrotikCommand(["/ip/hotspot/user/profile/print", `?name=${nom}`]);
        if (existing.data && existing.data.length > 0) {
            const id = existing.data[0][".id"];
            await mikrotikCommand(["/ip/hotspot/user/profile/remove", `=.id=${id}`]);
            return { success: true, message: `Profil "${nom}" supprimé sur Mikrotik` };
        }
        return { success: true, message: "Profil inexistant sur Mikrotik" };
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik: ${err.message}` };
    }
}

/**
 * Convertit un quota texte ("500 Mo", "1 Go", "2 GB", "Illimité") en octets.
 * Retourne null quand il n'y a pas de limite (Illimité / 0 / vide / invalide).
 */
function quotaEnOctets(quota) {
    if (!quota) return null;
    const q = String(quota).trim().toLowerCase();
    if (q === "" || q === "0" || q.includes("illimit")) return null;
    const m = q.match(/^([\d]+(?:[.,]\d+)?)\s*(ko|kb|mo|mb|go|gb|to|tb|k|m|g|t)?/);
    if (!m) return null;
    const val = parseFloat(m[1].replace(",", "."));
    if (!isFinite(val) || val <= 0) return null;
    const mult = {
        ko: 1024,         k: 1024,         kb: 1024,
        mo: 1024 ** 2,    m: 1024 ** 2,    mb: 1024 ** 2,
        go: 1024 ** 3,    g: 1024 ** 3,    gb: 1024 ** 3,
        to: 1024 ** 4,    t: 1024 ** 4,    tb: 1024 ** 4,
    }[m[2] || "mo"] || 1024 ** 2;
    return Math.round(val * mult);
}

/**
 * Supprimer un utilisateur Hotspot sur Mikrotik
 */
async function supprimerUtilisateurHotspot(code) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        const existing = await mikrotikCommand(["/ip/hotspot/user/print", `?name=${code}`]);
        if (existing.data && existing.data.length > 0) {
            const id = existing.data[0][".id"];
            await mikrotikCommand(["/ip/hotspot/user/remove", `=.id=${id}`]);
        }
        return { success: true, message: `Utilisateur "${code}" supprimé sur Mikrotik` };
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik: ${err.message}` };
    }
}

/**
 * Normalise une adresse MAC pour Mikrotik (majuscules, séparateur ":").
 */
function normaliserMac(mac) {
    if (!mac) return null;
    return mac.trim().toUpperCase().replace(/-/g, ":");
}

/**
 * Résoudre l'adresse MAC réelle d'une IP client via le Mikrotik
 * (table ARP, puis bail DHCP en secours). Retourne la MAC normalisée
 * ou null si introuvable. Permet de limiter les forfaits gratuits par
 * MAC de façon non falsifiable (contrairement à un paramètre d'URL).
 */
async function macDepuisIp(ip) {
    if (!MIKROTIK_ENABLED || !ip) return null;
    const ipPropre = String(ip).replace(/^::ffff:/, "").trim();
    const sources = [
        ["/ip/arp/print", `?address=${ipPropre}`],
        ["/ip/dhcp-server/lease/print", `?address=${ipPropre}`],
    ];
    for (const [chemin, filtre] of sources) {
        try {
            const res = await mikrotikCommand([chemin, filtre]);
            const mac = normaliserMac(res.data?.[0]?.["mac-address"]);
            if (mac) return mac;
        } catch { /* source suivante */ }
    }
    return null;
}

async function creerUtilisateurHotspot(code, profilNom, duree, mac, quota) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        // Convertir la durée en format Mikrotik (ex: "1 heure" → "01:00:00")
        // DOIT rester aligné sur dureeEnMs() de server.js — toute durée de
        // forfait sans entrée ici retombe sur le fallback 1h (bug « 43min /
        // 10 minutes » historique).
        const dureeMap = {
            "5 minutes":  "00:05:00",
            "10 minutes": "00:10:00",
            "15 minutes": "00:15:00",
            "20 minutes": "00:20:00",
            "30 minutes": "00:30:00",
            "45 minutes": "00:45:00",
            "1 heure":    "01:00:00",
            "2 heures":   "02:00:00",
            "3 heures":   "03:00:00",
            "6 heures":   "06:00:00",
            "12 heures":  "12:00:00",
            "24 heures":  "1d",
            "3 jours":    "3d",
            "7 jours":    "7d",
            "30 jours":   "30d",
            "Illimité":   "0s",
        };
        const dureesMK = dureeMap[duree] || "01:00:00";

        const words = [
            "/ip/hotspot/user/add",
            `=name=${code}`,
            `=password=${code}`,
            `=profile=${profilNom}`,
            `=limit-uptime=${dureesMK}`,
        ];
        // Forfaits gratuits uniquement : si une MAC est fournie, RouterOS
        // n'acceptera la connexion de cet utilisateur que depuis cet appareil.
        // Les forfaits payants passent mac=null → aucun changement de comportement.
        const macMK = normaliserMac(mac);
        if (macMK) words.push(`=mac-address=${macMK}`);

        // Limiter le volume total (ex: 500 Mo). RouterOS coupe l'abonné dès
        // que quota_in + quota_out atteint cette valeur, même après reconnexion.
        const quotaOctets = quotaEnOctets(quota);
        if (quotaOctets) words.push(`=limit-bytes-total=${quotaOctets}`);

        await mikrotikCommand(words);
        return {
            success: true,
            message: `Utilisateur "${code}" créé sur Mikrotik${quotaOctets ? ` (quota ${quota})` : ""}`,
        };
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik: ${err.message}` };
    }
}

/**
 * Lier (ou mettre à jour) l'adresse MAC d'un utilisateur Hotspot existant.
 * Une fois la MAC définie, RouterOS n'accepte plus aucune autre adresse MAC
 * pour cet utilisateur : le ticket est lié à un seul appareil.
 */
async function definirMacUtilisateurHotspot(code, mac) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    const macMK = normaliserMac(mac);
    if (!macMK) return { success: false, message: "MAC invalide" };
    try {
        const existing = await mikrotikCommand(["/ip/hotspot/user/print", `?name=${code}`]);
        if (!existing.data || existing.data.length === 0) {
            return { success: false, message: `Utilisateur "${code}" introuvable` };
        }
        const id = existing.data[0][".id"];
        await mikrotikCommand(["/ip/hotspot/user/set", `=.id=${id}`, `=mac-address=${macMK}`]);
        return { success: true, message: `Utilisateur "${code}" lié à la MAC ${macMK}` };
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik: ${err.message}` };
    }
}

/**
 * Retirer une session active par son identifiant interne (.id)
 */
async function retirerSessionActiveParId(id) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        await mikrotikCommand(["/ip/hotspot/active/remove", `=.id=${id}`]);
        return { success: true, message: `Session ${id} déconnectée` };
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik: ${err.message}` };
    }
}

/**
 * Informations d'un utilisateur hotspot (temps restant, session active)
 * @param {string} code - Nom d'utilisateur hotspot (code ticket)
 */
async function informationsUtilisateurHotspot(code) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé", existe: false, restant: 0 };
    try {
        const res = await mikrotikCommand(["/ip/hotspot/user/print", `?name=${code}`]);
        const u = res.data && res.data[0];
        if (!u) return { success: true, existe: false, actif: false, restant: 0 };
        const limite = parseTempsSec(u["limit-uptime"]);
        const utilise = parseTempsSec(u.uptime);
        let restant = limite === 0 ? null : Math.max(0, limite - utilise);
        let actif = false;
        const actifs = await mikrotikCommand(["/ip/hotspot/active/print", `?user=${code}`]);
        if (actifs.data && actifs.data[0]) {
            actif = true;
            const stl = parseTempsSec(actifs.data[0]["session-time-left"]);
            if (stl > 0) restant = stl;
        }
        // Quota volume : cumul RouterOS (bytes-in + bytes-out) vs limit-bytes-total
        const quotaTotal = parseInt(u["limit-bytes-total"]) || 0;
        const quotaUtilise = (parseInt(u["bytes-in"]) || 0) + (parseInt(u["bytes-out"]) || 0);
        const quotaRestant = quotaTotal > 0 ? Math.max(0, quotaTotal - quotaUtilise) : null;
        const quotaEpuise = quotaTotal > 0 && quotaUtilise >= quotaTotal;
        return { success: true, existe: true, actif, restant, quotaTotal, quotaUtilise, quotaRestant, quotaEpuise };
    } catch (err) {
        return { success: false, message: err.message, existe: false, actif: false, restant: 0 };
    }
}

/**
 * Déconnecter un client actif sur Mikrotik (par IP)
 */
async function deconnecterClient(ip) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        const actifs = await mikrotikCommand(["/ip/hotspot/active/print", `?address=${ip}`]);
        if (actifs.data && actifs.data.length > 0) {
            const id = actifs.data[0][".id"];
            await mikrotikCommand(["/ip/hotspot/active/remove", `=.id=${id}`]);
        }
        return { success: true, message: `Client ${ip} déconnecté sur Mikrotik` };
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik: ${err.message}` };
    }
}

/**
 * Déconnecter la(s) session(s) active(s) d'un utilisateur hotspot par son
 * nom (code ticket) — fiable quelle que soit l'IP du client (contrairement
 * à deconnecterClient qui dépend de l'adresse, absente/invalide derrière
 * un proxy).
 */
async function deconnecterSessionParUtilisateur(code) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé", deconnectees: 0 };
    try {
        const actifs = await mikrotikCommand(["/ip/hotspot/active/print", `?user=${code}`]);
        let deconnectees = 0;
        for (const a of (actifs.data || [])) {
            await mikrotikCommand(["/ip/hotspot/active/remove", `=.id=${a[".id"]}`]);
            deconnectees++;
        }
        return { success: true, message: `${deconnectees} session(s) déconnectée(s) pour "${code}"`, deconnectees };
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik: ${err.message}`, deconnectees: 0 };
    }
}

/**
 * Lister les clients actifs sur Mikrotik
 */
async function listerClientsActifs() {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé", data: [] };
    try {
        const result = await mikrotikCommand(["/ip/hotspot/active/print"]);
        return { success: true, data: result.data || [] };
    } catch (err) {
        return { success: false, message: err.message, data: [] };
    }
}

/**
 * Lister les utilisateurs hotspot avec leurs compteurs CUMULÉS
 * (bytes-in + bytes-out depuis la création du user, contrairement aux
 * compteurs de session de /ip/hotspot/active qui repartent à zéro).
 * uptime = temps de connexion cumulé ; limit-uptime = plafond du forfait.
 */
async function listerUtilisateursHotspot() {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé", data: [] };
    try {
        const result = await mikrotikCommand([
            "/ip/hotspot/user/print",
            "=.proplist=name,bytes-in,bytes-out,limit-bytes-total,uptime,limit-uptime",
        ]);
        return { success: true, data: result.data || [] };
    } catch (err) {
        return { success: false, message: err.message, data: [] };
    }
}

/**
 * Modifier le limit-uptime d'un utilisateur hotspot existant (réparation).
 */
async function modifierLimitUptimeUtilisateur(code, limitMk) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        const existing = await mikrotikCommand(["/ip/hotspot/user/print", `?name=${code}`]);
        if (!existing.data || existing.data.length === 0) {
            return { success: false, message: `Utilisateur "${code}" introuvable` };
        }
        await mikrotikCommand(["/ip/hotspot/user/set", `=.id=${existing.data[0][".id"]}`, `=limit-uptime=${limitMk}`]);
        return { success: true, message: `limit-uptime de "${code}" défini à ${limitMk}` };
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik: ${err.message}` };
    }
}

/**
 * Lister les profils Hotspot sur Mikrotik
 */
async function listerProfils() {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé", data: [] };
    try {
        const result = await mikrotikCommand(["/ip/hotspot/user/profile/print"]);
        return { success: true, data: result.data || [] };
    } catch (err) {
        return { success: false, message: err.message, data: [] };
    }
}

/**
 * Lister les serveurs Hotspot configurés sur Mikrotik
 */
async function listerHotspots() {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé", data: [] };
    try {
        const result = await mikrotikCommand(["/ip/hotspot/print"]);
        return { success: true, data: result.data || [] };
    } catch (err) {
        return { success: false, message: err.message, data: [] };
    }
}

/**
 * S'assurer que "mac" figure dans le login-by de TOUS les profils hotspot.
 * RouterOS 7 n'a pas la propriété "open-status-page" sur les profils — ne pas
 * la tenter (une propriété inexistante fait échouer toute la commande set).
 * Mise à jour profil par profil (try/catch) pour ne pas annuler les autres.
 */
async function activerLoginByMac() {
    const profs = await mikrotikCommand(["/ip/hotspot/profile/print"]);
    for (const p of profs.data || []) {
        try {
            const loginBy = String(p["login-by"] || "");
            const methods = loginBy.split(",").map(s => s.trim()).filter(Boolean);
            if (!methods.includes("mac")) {
                // mac en premier : tentative de login MAC avant cookie/chap
                methods.unshift("mac");
                await mikrotikCommand([
                    "/ip/hotspot/profile/set",
                    `=.id=${p[".id"]}`,
                    `=login-by=${methods.join(",")}`,
                ]);
            }
        } catch (e) {
            console.warn(`⚠️  Impossible d'activer login-by=mac sur le profil ${p.name}: ${e.message}`);
        }
    }
}

/**
 * Ajouter une adresse MAC en bypass hotspot (accès sans portail captif)
 * Utilise /ip/hotspot/user avec le profil "bypass" ou crée un utilisateur sans limite
 * @param {string} mac - Adresse MAC (ex: AA:BB:CC:DD:EE:FF)
 * @param {string} nom - Nom du compte (commentaire)
 * @param {string} debit - Débit en format Mikrotik (ex: "10M" ou "0" pour illimité)
 */
async function ajouterMacBypass(mac, nom, debit) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        // Format attendu par mac-as-username-and-password : minuscules + deux-points
        const macMK = normaliserMac(mac).toLowerCase();

        // Vérifier si l'entrée existe déjà
        const existing = await mikrotikCommand([
            "/ip/hotspot/user/print",
            `?mac-address=${macMK}`
        ]);

        const rateLimit = debit && debit !== "0" ? `${debit}/${debit}` : "";

        if (existing.data && existing.data.length > 0) {
            // Mettre à jour l'entrée existante (rename vers format colon si legacy)
            const id = existing.data[0][".id"];
            const words = [
                "/ip/hotspot/user/set",
                `=.id=${id}`,
                `=name=${macMK}`,
                // Avec le mac-auth-mode par défaut (mac-as-username-and-password),
                // RouterOS envoie le MAC comme username ET mot de passe
                `=password=${macMK}`,
                `=comment=Compte privilégié: ${nom}`,
            ];
            if (rateLimit) words.push(`=rate-limit=${rateLimit}`);
            await mikrotikCommand(words);
        } else {
            // Créer un utilisateur hotspot avec la MAC (auto-login par MAC)
            const words = [
                "/ip/hotspot/user/add",
                `=name=${macMK}`,
                `=mac-address=${macMK}`,
                `=comment=Compte privilégié: ${nom}`,
                `=password=${macMK}`,
            ];
            if (rateLimit) words.push(`=rate-limit=${rateLimit}`);
            await mikrotikCommand(words);
        }

        // Point critique : sans "mac" dans le login-by du profil serveur
        // hotspot, RouterOS affiche quand même la page de login.
        await activerLoginByMac();

        return { success: true, message: `Bypass MAC "${mac}" activé sur Mikrotik pour "${nom}" — accès sans portail captif (login-by=mac vérifié)` };
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik bypass: ${err.message}` };
    }
}

/**
 * Supprimer une adresse MAC du bypass hotspot
 * @param {string} mac - Adresse MAC (ex: AA:BB:CC:DD:EE:FF)
 */
async function supprimerMacBypass(mac) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        const macMK = normaliserMac(mac).toLowerCase();

        const existing = await mikrotikCommand([
            "/ip/hotspot/user/print",
            `?mac-address=${macMK}`
        ]);

        if (existing.data && existing.data.length > 0) {
            const id = existing.data[0][".id"];
            await mikrotikCommand(["/ip/hotspot/user/remove", `=.id=${id}`]);
            return { success: true, message: `Bypass MAC "${mac}" supprimé sur Mikrotik — portail captif rétabli` };
        }
        return { success: true, message: `Bypass MAC "${mac}" inexistant sur Mikrotik (déjà supprimé)` };
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik suppression bypass: ${err.message}` };
    }
}

// ─── Bypass firewall (address-list) ───────────────────────────────────────
// Architecture retenue par le conseil claude-council du 2026-10-20 (sha 55fdb9e4)
// après 4 échecs du login-by=mac : accepter le trafic des MAC privilégiées AVANT
// les chaînes hotspot, plutôt que de dépendre d'une authentification qui ne se
// déclenche jamais. Leur IP (bail DHCP) est mise dans l'address-list "smd-bypass",
// consommée par 3 règles "return" placées en tête des chaînes hotspot :
//   1) /ip firewall nat    chain=hs-unauth     src-address-list=smd-bypass → return
//      (stoppe le redirect portail 80/443/8080/3128)
//   2) /ip firewall filter chain=hs-unauth     src-address-list=smd-bypass → return
//      (stoppe les reject tcp-reset / icmp-host-prohibited sortants)
//   3) /ip firewall filter chain=hs-unauth-to  dst-address-list=smd-bypass → return
//      (stoppe les reject des retours internet → client)
// Les règles ne matchent QUE les membres de la liste : les flux gratuits/payants
// ne traversent aucune règle modifiée. Rollback : MIKROTIK_BYPASS_MODE=off +
// restart → retirerBypassFirewall(). Limite connue : le trafic bypassé n'a pas
// de session hotspot → rate-limit / quotas du profil non appliqués (comptes
// privilégiés = illimités par conception).

const BYPASS_LISTE = "smd-bypass";
const BYPASS_TAG = "smd-bypass";

/**
 * Crée (idempotent) les 3 règles de bypass en tête des chaînes hotspot.
 */
async function initierBypassFirewall() {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    const defs = [
        { table: "/ip/firewall/nat",    chain: "hs-unauth",    champ: "src-address-list" },
        { table: "/ip/firewall/filter", chain: "hs-unauth",    champ: "src-address-list" },
        { table: "/ip/firewall/filter", chain: "hs-unauth-to", champ: "dst-address-list" },
    ];
    try {
        let creees = 0;
        for (const d of defs) {
            const rules = await mikrotikCommand([d.table + "/print"]);
            const deja = (rules.data || []).some(
                r => r.chain === d.chain && String(r.comment || "") === BYPASS_TAG
            );
            if (deja) continue;
            // En tête de la chaîne (première règle réellement évaluée)
            const premier = (rules.data || []).find(r => r.chain === d.chain);
            const mots = [
                d.table + "/add",
                `=chain=${d.chain}`,
                "=action=return",
                `=${d.champ}=${BYPASS_LISTE}`,
                `=comment=${BYPASS_TAG}`,
            ];
            if (premier) mots.push(`=place-before=${premier[".id"]}`);
            await mikrotikCommand(mots);
            creees++;
        }
        return {
            success: true,
            message: creees > 0 ? `${creees} règle(s) bypass firewall créée(s)` : "Règles bypass firewall déjà en place",
        };
    } catch (err) {
        return { success: false, message: `Erreur init bypass firewall: ${err.message}` };
    }
}

/**
 * Synchronise l'address-list smd-bypass avec les bails DHCP des MAC privilégiées.
 * Toute entrée qui ne correspond plus à un bail "bound" d'une MAC privilégiée
 * active est retirée (protection anti-réutilisation d'IP par un autre client).
 * @param {string[]} macs - MACs privilégiées ACTIVES (format quelconque)
 */
async function synchroniserAdresseBypass(macs) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        await initierBypassFirewall();

        const macsVoulues = new Set(
            (macs || []).map(m => normaliserMac(m)).filter(Boolean).map(m => m.toLowerCase())
        );

        const leases = await mikrotikCommand(["/ip/dhcp-server/lease/print"]);
        const voulues = new Map(); // ip -> mac
        for (const l of leases.data || []) {
            const macL = normaliserMac(l["mac-address"]);
            if (l.status === "bound" && macL && l.address && macsVoulues.has(macL.toLowerCase())) {
                voulues.set(l.address, macL.toLowerCase());
            }
        }

        const actuelles = await mikrotikCommand([
            "/ip/firewall/address-list/print", `?list=${BYPASS_LISTE}`,
        ]);
        const existantes = new Map(); // ip -> {id, comment}
        for (const e of actuelles.data || []) {
            if (e.address && e[".id"]) existantes.set(e.address, { id: e[".id"], comment: String(e.comment || "") });
        }

        let ajouts = 0, retraits = 0, corrections = 0;
        for (const [ip, ent] of existantes) {
            const macAttendue = voulues.get(ip);
            if (!macAttendue) {
                await mikrotikCommand(["/ip/firewall/address-list/remove", `=.id=${ent.id}`]);
                retraits++;
            } else if (ent.comment.toLowerCase() !== macAttendue) {
                await mikrotikCommand(["/ip/firewall/address-list/set", `=.id=${ent.id}`, `=comment=${macAttendue}`]);
                corrections++;
            }
        }
        for (const [ip, macL] of voulues) {
            if (!existantes.has(ip)) {
                await mikrotikCommand([
                    "/ip/firewall/address-list/add",
                    `=list=${BYPASS_LISTE}`, `=address=${ip}`, `=comment=${macL}`,
                ]);
                ajouts++;
            }
        }

        return {
            success: true,
            message: `Bypass firewall: ${voulues.size} MAC privilégiée(s) avec bail — ${ajouts} ajout(s), ${retraits} retrait(s), ${corrections} correction(s)`,
            details: { dansListe: voulues.size, ajouts, retraits, corrections },
        };
    } catch (err) {
        return { success: false, message: `Erreur sync bypass firewall: ${err.message}` };
    }
}

/**
 * Retire les 3 règles et vide la liste (rollback complet, appelé quand
 * MIKROTIK_BYPASS_MODE=off au démarrage).
 */
async function retirerBypassFirewall() {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        let n = 0;
        for (const table of ["/ip/firewall/nat", "/ip/firewall/filter"]) {
            const rules = await mikrotikCommand([table + "/print"]);
            for (const r of rules.data || []) {
                if (String(r.comment || "") === BYPASS_TAG) {
                    await mikrotikCommand([table + "/remove", `=.id=${r[".id"]}`]);
                    n++;
                }
            }
        }
        const lst = await mikrotikCommand(["/ip/firewall/address-list/print", `?list=${BYPASS_LISTE}`]);
        for (const e of lst.data || []) {
            await mikrotikCommand(["/ip/firewall/address-list/remove", `=.id=${e[".id"]}`]);
            n++;
        }
        return { success: true, message: `Bypass firewall retiré (${n} élément(s))` };
    } catch (err) {
        return { success: false, message: `Erreur retrait bypass firewall: ${err.message}` };
    }
}

// ─── Gestion complète des serveurs Hotspot (création / suppression) ─────────

function normaliserNomHotspot(nom) {
    return String(nom || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
}

function ipVersEntier(ip) {
    return ip.split(".").reduce((a, o) => ((a << 8) + (parseInt(o, 10) & 0xFF)) >>> 0, 0);
}

function entierVersIp(n) {
    return [ (n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF ].join(".");
}

/**
 * Calcule le réseau, la passerelle et la plage DHCP à partir d'une adresse CIDR
 * @param {string} cidr - ex: "192.168.89.1/24" (préfixe /8 à /24)
 */
function calculerReseau(cidr) {
    const m = String(cidr || "").trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
    if (!m) return null;
    const ip = m[1];
    if (!ipValide(ip)) return null;
    const prefix = parseInt(m[2], 10);
    if (prefix < 16 || prefix > 24) return null;
    const ipInt = ipVersEntier(ip);
    const masque = (0xFFFFFFFF << (32 - prefix)) >>> 0;
    const reseau = (ipInt & masque) >>> 0;
    const joker = (~masque) >>> 0;
    const diffusion = (reseau | joker) >>> 0;
    const debut = (reseau + 10) >>> 0;
    const fin = (diffusion - 1) >>> 0;
    if (fin <= debut) return null;
    return {
        ip, prefix,
        reseau: `${entierVersIp(reseau)}/${prefix}`,
        gateway: ip,
        debut: entierVersIp(debut),
        fin: entierVersIp(fin),
    };
}

function ipValide(ip) {
    const p = String(ip || "").split(".");
    return p.length === 4 && p.every(o => /^\d{1,3}$/.test(o) && parseInt(o, 10) <= 255);
}

/**
 * Lister les interfaces disponibles (pour choisir celle du hotspot)
 */
async function listerInterfaces() {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé", data: [] };
    try {
        const [result, dres, hres] = await Promise.all([
            mikrotikCommand(["/interface/print"]),
            mikrotikCommand(["/ip/dhcp-server/print"]),
            mikrotikCommand(["/ip/hotspot/print"]),
        ]);
        const dhcpIf = new Set((dres.data || []).map(d => d.interface));
        const hsIf = new Set((hres.data || []).map(h => h.interface));
        const data = (result.data || []).map(i => ({
            nom: i.name,
            type: i.type || "",
            actif: i.running === "true",
            desactive: i.disabled === "true",
            esclave: i.slave === "true",
            commentaire: i.comment || "",
            dejaHotspot: hsIf.has(i.name),
            dejaDhcp: dhcpIf.has(i.name),
        }));
        return { success: true, data };
    } catch (err) {
        return { success: false, message: err.message, data: [] };
    }
}

/**
 * Lister les profils de serveur Hotspot (login-by, hotspot-address)
 */
async function listerProfilsServeur() {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé", data: [] };
    try {
        const result = await mikrotikCommand(["/ip/hotspot/profile/print"]);
        const data = (result.data || []).map(p => ({
            nom: p.name,
            loginBy: p["login-by"] || "",
            hotspotAddress: p["hotspot-address"] || "0.0.0.0",
        }));
        return { success: true, data };
    } catch (err) {
        return { success: false, message: err.message, data: [] };
    }
}

/**
 * Créer un serveur Hotspot complet sur Mikrotik
 * (adresse IP + pool + serveur DHCP + réseau DHCP + profil + serveur hotspot)
 * Tous les éléments portent le commentaire `SMD-HS:<nom>` pour la suppression.
 * @param {{nom:string, interface:string, adresse:string, profilServer?:string}} opts
 */
async function creerHotspot(opts) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };

    const nom = normaliserNomHotspot(opts.nom);
    if (!nom) return { success: false, message: "Nom de hotspot invalide (lettres, chiffres, tirets)." };

    const iface = String(opts.interface || "").trim();
    if (!iface) return { success: false, message: "Interface requise." };

    const reseau = calculerReseau(opts.adresse);
    if (!reseau) {
        return { success: false, message: "Adresse IP invalide. Format attendu : 192.168.89.1/24 (préfixe /8 à /24)." };
    }

    // Refuser un doublon de nom
    const exist = await mikrotikCommand(["/ip/hotspot/print"]);
    if ((exist.data || []).some(h => h.name === nom)) {
        return { success: false, message: `Un hotspot nommé "${nom}" existe déjà.` };
    }

    // Un seul serveur hotspot/DHCP par interface : vérifier que l'interface est libre
    const [dhcps, hsList] = await Promise.all([
        mikrotikCommand(["/ip/dhcp-server/print"]),
        exist,
    ]);
    const hsIface = (hsList.data || []).find(h => h.interface === iface);
    if (hsIface) {
        return { success: false, message: `L'interface "${iface}" héberge déjà le hotspot "${hsIface.name}". RouterOS n'autorise qu'un seul hotspot par interface : utilisez une interface dédiée (port libre ou VLAN).` };
    }
    const dhcpOnIface = (dhcps.data || []).find(d => d.interface === iface);
    if (dhcpOnIface) {
        return { success: false, message: `L'interface "${iface}" a déjà un serveur DHCP ("${dhcpOnIface.name}"). Un deuxième hotspot nécessite une interface dédiée (port réseau libre ou VLAN).` };
    }

    const tag = `SMD-HS:${nom}`;
    const poolNom = `${nom}-pool`;
    const dhcpNom = `${nom}-dhcp`;
    const profilNom = opts.profilServer ? String(opts.profilServer).trim() : `${nom}-prof`;

    try {
        // 1. Adresse IP sur l'interface
        await mikrotikCommand(["/ip/address/add", `=address=${opts.adresse}`, `=interface=${iface}`, `=comment=${tag}`]);
        // 2. Pool d'adresses
        await mikrotikCommand(["/ip/pool/add", `=name=${poolNom}`, `=ranges=${reseau.debut}-${reseau.fin}`, `=comment=${tag}`]);
        // 3. Serveur DHCP
        await mikrotikCommand(["/ip/dhcp-server/add", `=name=${dhcpNom}`, `=interface=${iface}`, `=address-pool=${poolNom}`, `=lease-time=30m`, `=disabled=no`, `=comment=${tag}`]);
        // 4. Réseau DHCP (passerelle + DNS)
        await mikrotikCommand(["/ip/dhcp-server/network/add", `=address=${reseau.reseau}`, `=gateway=${reseau.gateway}`, `=dns-server=${reseau.gateway}`, `=comment=${tag}`]);
        // 5. Profil serveur hotspot (créé seulement si l'admin n'en choisit pas un existant)
        //    Note : ce RouterOS n'accepte pas le paramètre `comment` sur le profil.
        if (!opts.profilServer) {
            await mikrotikCommand(["/ip/hotspot/profile/add", `=name=${profilNom}`, `=hotspot-address=${reseau.gateway}`, `=login-by=cookie,mac,http-chap,http-pap`, `=open-status-page=http-login`, `=html-directory=hotspot`]);
        }
        // 6. Serveur hotspot (pas de `comment` supporté non plus)
        await mikrotikCommand(["/ip/hotspot/add", `=name=${nom}`, `=interface=${iface}`, `=address-pool=${poolNom}`, `=profile=${profilNom}`, `=disabled=no`]);

        return {
            success: true,
            nom,
            reseau,
            message: `Hotspot "${nom}" créé sur ${iface} — réseau ${reseau.reseau}, passerelle ${reseau.gateway}, pool ${reseau.debut}-${reseau.fin}.`,
        };
    } catch (err) {
        // Rollback : supprimer tout ce qui a été créé (repéré par le commentaire)
        try { await supprimerHotspot(nom); } catch { /* ignore */ }
        return { success: false, message: `Erreur création hotspot: ${err.message}` };
    }
}

/**
 * Supprimer les éléments portant le commentaire SMD-HS:<nom> dans un chemin donné
 */
async function supprimerParCommentaire(chemin, tag) {
    const res = await mikrotikCommand([`${chemin}/print`]);
    const items = (res.data || []).filter(i => (i.comment || "") === tag);
    for (const it of items) {
        await mikrotikCommand([`${chemin}/remove`, `=.id=${it[".id"]}`]);
    }
    return items.length;
}

/**
 * Supprimer un serveur Hotspot et ses dépendances créées par le dashboard
 */
async function supprimerHotspot(nom) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    const nomN = normaliserNomHotspot(nom);
    const tag = `SMD-HS:${nomN}`;
    try {
        let n = 0;
        // Le serveur hotspot peut avoir été créé hors dashboard : le retirer par nom
        const hs = await mikrotikCommand(["/ip/hotspot/print"]);
        const cibles = (hs.data || []).filter(h => h.name === nomN || (h.comment || "") === tag);
        for (const h of cibles) {
            await mikrotikCommand(["/ip/hotspot/remove", `=.id=${h[".id"]}`]);
            n++;
        }
        n += await supprimerParCommentaire("/ip/hotspot/profile", tag);
        // Le profil créé automatiquement n'a pas de commentaire : le repérer par son nom
        const profRes = await mikrotikCommand(["/ip/hotspot/profile/print"]);
        for (const p of (profRes.data || [])) {
            if (p.name === `${nomN}-prof`) {
                await mikrotikCommand(["/ip/hotspot/profile/remove", `=.id=${p[".id"]}`]);
                n++;
            }
        }
        n += await supprimerParCommentaire("/ip/dhcp-server/network", tag);
        n += await supprimerParCommentaire("/ip/dhcp-server", tag);
        n += await supprimerParCommentaire("/ip/pool", tag);
        n += await supprimerParCommentaire("/ip/address", tag);
        if (n === 0) return { success: false, message: `Aucun hotspot "${nomN}" trouvé.` };
        return { success: true, message: `Hotspot "${nomN}" supprimé (${n} élément(s)).` };
    } catch (err) {
        return { success: false, message: `Erreur suppression hotspot: ${err.message}` };
    }
}

/**
 * Activer / désactiver un serveur Hotspot
 */
async function basculerHotspot(nom, actif) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        const res = await mikrotikCommand(["/ip/hotspot/print"]);
        const hs = (res.data || []).find(h => h.name === nom);
        if (!hs) return { success: false, message: `Hotspot "${nom}" introuvable.` };
        await mikrotikCommand(["/ip/hotspot/set", `=.id=${hs[".id"]}`, `=disabled=${actif ? "no" : "yes"}`]);
        return { success: true, message: `Hotspot "${nom}" ${actif ? "activé" : "désactivé"}.` };
    } catch (err) {
        return { success: false, message: `Erreur: ${err.message}` };
    }
}

module.exports = {
    MIKROTIK_ENABLED,
    testerConnexion,
    creerProfilHotspot,
    supprimerProfilHotspot,
    creerUtilisateurHotspot,
    supprimerUtilisateurHotspot,
    definirMacUtilisateurHotspot,
    macDepuisIp,
    retirerSessionActiveParId,
    deconnecterClient,
    deconnecterSessionParUtilisateur,
    modifierLimitUptimeUtilisateur,
    informationsUtilisateurHotspot,
    listerClientsActifs,
    listerUtilisateursHotspot,
    listerProfils,
    listerHotspots,
    ajouterMacBypass,
    supprimerMacBypass,
    initierBypassFirewall,
    synchroniserAdresseBypass,
    retirerBypassFirewall,
    listerInterfaces,
    listerProfilsServeur,
    creerHotspot,
    supprimerHotspot,
    basculerHotspot,
};
