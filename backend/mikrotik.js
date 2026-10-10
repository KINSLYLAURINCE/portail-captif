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

                if (word === "!done") { sentences.push({ type: "done" }); }
                else if (word === "!re") { current = { type: "re" }; }
                else if (word === "!trap") { current = { type: "trap" }; }
                else if (word.startsWith("=")) {
                    const eq = word.indexOf("=", 1);
                    if (eq > 0) {
                        if (!current) current = { type: "re" };
                        current[word.slice(1, eq)] = word.slice(eq + 1);
                    }
                } else if (word.startsWith(".id=")) {
                    if (!current) current = { type: "re" };
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
                    if (s.type === "done" || s.type === "re") {
                        authenticated = true;
                        // Envoyer la vraie commande
                        socket.write(encodeSentence(words));
                    } else if (s.type === "trap") {
                        clearTimeout(timer);
                        socket.destroy();
                        reject(new Error(`Erreur login Mikrotik: ${s.message || "Identifiants incorrects"}`));
                        return;
                    }
                } else {
                    if (s.type === "done") {
                        clearTimeout(timer);
                        socket.destroy();
                        resolve({ success: true, data: results });
                        return;
                    } else if (s.type === "trap") {
                        clearTimeout(timer);
                        socket.destroy();
                        reject(new Error(`Erreur Mikrotik: ${s.message || "Commande échouée"}`));
                        return;
                    } else if (s.type === "re") {
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
 * Créer un utilisateur Hotspot (ticket) sur Mikrotik
 */
async function creerUtilisateurHotspot(code, profilNom, duree) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        // Convertir la durée en format Mikrotik (ex: "1 heure" → "01:00:00")
        const dureeMap = {
            "30 minutes": "00:30:00",
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

        await mikrotikCommand([
            "/ip/hotspot/user/add",
            `=name=${code}`,
            `=password=${code}`,
            `=profile=${profilNom}`,
            `=limit-uptime=${dureesMK}`,
        ]);
        return { success: true, message: `Utilisateur "${code}" créé sur Mikrotik` };
    } catch (err) {
        return { success: false, message: `Erreur Mikrotik: ${err.message}` };
    }
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

async function creerUtilisateurHotspot(code, profilNom, duree, mac) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        // Convertir la durée en format Mikrotik (ex: "1 heure" → "01:00:00")
        const dureeMap = {
            "30 minutes": "00:30:00",
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
        // Lier l'utilisateur à une seule adresse MAC si connue (appareil unique)
        const macMK = normaliserMac(mac);
        if (macMK) words.push(`=mac-address=${macMK}`);

        await mikrotikCommand(words);
        return { success: true, message: `Utilisateur "${code}" créé sur Mikrotik${macMK ? ` (MAC ${macMK})` : ""}` };
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
        return { success: true, existe: true, actif, restant, limite, utilise };
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
 * Ajouter une adresse MAC en bypass hotspot (accès sans portail captif)
 * Utilise /ip/hotspot/user avec le profil "bypass" ou crée un utilisateur sans limite
 * @param {string} mac - Adresse MAC (ex: AA:BB:CC:DD:EE:FF)
 * @param {string} nom - Nom du compte (commentaire)
 * @param {string} debit - Débit en format Mikrotik (ex: "10M" ou "0" pour illimité)
 */
async function ajouterMacBypass(mac, nom, debit) {
    if (!MIKROTIK_ENABLED) return { success: false, message: "Mikrotik désactivé" };
    try {
        // Normaliser la MAC au format Mikrotik (minuscules avec tirets)
        const macMK = mac.toLowerCase().replace(/:/g, ":");

        // Vérifier si l'entrée existe déjà
        const existing = await mikrotikCommand([
            "/ip/hotspot/user/print",
            `?mac-address=${macMK}`
        ]);

        const rateLimit = debit && debit !== "0" ? `${debit}/${debit}` : "";

        if (existing.data && existing.data.length > 0) {
            // Mettre à jour l'entrée existante
            const id = existing.data[0][".id"];
            const words = [
                "/ip/hotspot/user/set",
                `=.id=${id}`,
                `=comment=Compte privilégié: ${nom}`,
            ];
            if (rateLimit) words.push(`=rate-limit=${rateLimit}`);
            await mikrotikCommand(words);
            return { success: true, message: `Bypass MAC "${mac}" mis à jour sur Mikrotik pour "${nom}"` };
        } else {
            // Créer un utilisateur hotspot avec la MAC (pas de mot de passe = bypass)
            const words = [
                "/ip/hotspot/user/add",
                `=name=${macMK}`,
                `=mac-address=${macMK}`,
                `=comment=Compte privilégié: ${nom}`,
                `=password=`,
            ];
            if (rateLimit) words.push(`=rate-limit=${rateLimit}`);
            await mikrotikCommand(words);
            return { success: true, message: `Bypass MAC "${mac}" ajouté sur Mikrotik pour "${nom}" — accès sans portail captif activé` };
        }
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
        const macMK = mac.toLowerCase().replace(/:/g, ":");

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

module.exports = {
    MIKROTIK_ENABLED,
    testerConnexion,
    creerProfilHotspot,
    supprimerProfilHotspot,
    creerUtilisateurHotspot,
    supprimerUtilisateurHotspot,
    definirMacUtilisateurHotspot,
    retirerSessionActiveParId,
    deconnecterClient,
    informationsUtilisateurHotspot,
    listerClientsActifs,
    listerProfils,
    ajouterMacBypass,
    supprimerMacBypass,
};
