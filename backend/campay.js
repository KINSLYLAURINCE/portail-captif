/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MODULE CAMPAY — Passerelle de paiement Mobile Money (Orange Money, MTN MoMo)
 * Documentation : https://docs.campay.net
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios = require("axios");

const CAMPAY_BASE_URL =
    process.env.CAMPAY_BASE_URL || "https://demo.campay.net/api";
const CAMPAY_USERNAME = process.env.CAMPAY_APP_USERNAME || "";
const CAMPAY_PASSWORD = process.env.CAMPAY_APP_PASSWORD || "";

// ── Cache du token (valide 60 min côté Campay, on renouvelle à 55 min) ──────
let _token = null;
let _tokenExpiry = 0;
let _tokenRefreshing = false;   // Évite les appels concurrents

/**
 * Obtenir un token d'accès Campay (avec cache + protection concurrence)
 */
async function obtenirToken() {
    const now = Date.now();

    // Token encore valide
    if (_token && now < _tokenExpiry) return _token;

    // Attendre si un refresh est déjà en cours (évite les appels parallèles)
    if (_tokenRefreshing) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (_token && Date.now() < _tokenExpiry) return _token;
    }

    if (!CAMPAY_USERNAME || !CAMPAY_PASSWORD) {
        throw new Error(
            "Credentials Campay manquants. Vérifiez CAMPAY_APP_USERNAME et CAMPAY_APP_PASSWORD dans .env"
        );
    }

    _tokenRefreshing = true;
    try {
        const response = await axios.post(
            `${CAMPAY_BASE_URL}/token/`,
            { username: CAMPAY_USERNAME, password: CAMPAY_PASSWORD },
            { timeout: 15000 }
        );

        _token = response.data.token;
        // Token valide 55 minutes (expire à 60 min côté Campay)
        _tokenExpiry = Date.now() + 55 * 60 * 1000;
        console.log("✅ [Campay] Token obtenu avec succès");
        return _token;
    } catch (err) {
        _token = null;
        _tokenExpiry = 0;
        const msg =
            err.response?.data?.detail ||
            err.response?.data?.message ||
            err.message;
        console.error("❌ [Campay] Erreur d'authentification:", msg);
        throw new Error(`Campay auth échouée: ${msg}`);
    } finally {
        _tokenRefreshing = false;
    }
}

/**
 * Invalider le token en cache (utile après une erreur 401)
 */
function invaliderToken() {
    _token = null;
    _tokenExpiry = 0;
}

/**
 * Initier un paiement Mobile Money via Campay
 *
 * @param {string} telephone   - Numéro au format international ex: "237670000000"
 * @param {number} montant     - Montant en FCFA (entier)
 * @param {string} description - Description de la transaction
 * @param {string} reference   - Référence externe unique (ex: ticket code)
 * @param {string} [webhookUrl]- URL de callback Campay (optionnel)
 * @returns {{ success, reference, ussd_code, operator, message }}
 */
async function initierPaiement(telephone, montant, description, reference, webhookUrl) {
    const MAX_RETRIES = 2;

    for (let tentative = 0; tentative <= MAX_RETRIES; tentative++) {
        try {
            const token = await obtenirToken();
            const tel = normaliserTelephone(telephone);

            const payload = {
                amount: String(montant),
                from: tel,
                description: description || "Achat forfait Wi-Fi SMD-CONNECT",
                external_reference: reference || "",
            };

            // Ajouter le webhook si fourni
            if (webhookUrl) {
                payload.redirect_url = webhookUrl;
            }

            console.log(
                `📲 [Campay] Initiation paiement: ${montant} FCFA → ${tel} (tentative ${tentative + 1})`
            );

            const response = await axios.post(
                `${CAMPAY_BASE_URL}/collect/`,
                payload,
                {
                    headers: {
                        Authorization: `Token ${token}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 30000,
                }
            );

            const data = response.data;
            console.log(
                `✅ [Campay] Paiement initié — référence Campay: ${data.reference}`
            );

            return {
                success: true,
                reference: data.reference,
                ussd_code: data.ussd_code || null,
                operator: data.operator || null,
                message: "Demande de paiement envoyée. Confirmez sur votre téléphone.",
            };
        } catch (err) {
            // Si erreur 401 → invalider le token et réessayer
            if (err.response?.status === 401 && tentative < MAX_RETRIES) {
                console.warn(
                    `⚠️ [Campay] Token expiré (401), renouvellement... (tentative ${tentative + 1})`
                );
                invaliderToken();
                continue;
            }

            const errData = err.response?.data;
            const msg =
                errData?.message ||
                errData?.detail ||
                errData?.error ||
                (typeof errData === "string" ? errData : null) ||
                err.message ||
                "Erreur lors de l'initiation du paiement.";

            console.error("❌ [Campay] Erreur initiation:", msg, errData);

            return { success: false, message: msg };
        }
    }

    return { success: false, message: "Échec après plusieurs tentatives." };
}

/**
 * Vérifier le statut d'une transaction Campay
 *
 * @param {string} reference - Référence Campay retournée par initierPaiement
 * @returns {{ success, status: "SUCCESSFUL"|"FAILED"|"PENDING", message, operator, amount }}
 */
async function verifierPaiement(reference) {
    const MAX_RETRIES = 2;

    for (let tentative = 0; tentative <= MAX_RETRIES; tentative++) {
        try {
            const token = await obtenirToken();

            const response = await axios.get(
                `${CAMPAY_BASE_URL}/transaction/${reference}/`,
                {
                    headers: { Authorization: `Token ${token}` },
                    timeout: 15000,
                }
            );

            const data = response.data;
            const status = data.status; // "SUCCESSFUL", "FAILED", "PENDING"

            console.log(
                `🔍 [Campay] Statut transaction ${reference}: ${status}`
            );

            return {
                success: true,
                status,
                operator: data.operator || null,
                amount: data.amount || null,
                currency: data.currency || "XAF",
                message: statusMessage(status),
            };
        } catch (err) {
            // Si erreur 401 → invalider le token et réessayer
            if (err.response?.status === 401 && tentative < MAX_RETRIES) {
                console.warn(
                    `⚠️ [Campay] Token expiré (401), renouvellement...`
                );
                invaliderToken();
                continue;
            }

            const msg =
                err.response?.data?.detail ||
                err.response?.data?.message ||
                err.message;
            console.error("❌ [Campay] Erreur vérification:", msg);

            return {
                success: false,
                status: "FAILED",
                message: `Impossible de vérifier le paiement: ${msg}`,
            };
        }
    }

    return {
        success: false,
        status: "FAILED",
        message: "Échec de vérification après plusieurs tentatives.",
    };
}

/**
 * Normaliser un numéro de téléphone au format Campay (237XXXXXXXXX)
 * Supporte : +237XXXXXXXXX, 00237XXXXXXXXX, 237XXXXXXXXX, XXXXXXXXX (9 chiffres)
 */
function normaliserTelephone(tel) {
    if (!tel) return "";

    // Retirer tout sauf les chiffres
    let chiffres = String(tel).replace(/\D/g, "");

    // Si commence par 00237, retirer le 00
    if (chiffres.startsWith("00237")) {
        chiffres = chiffres.slice(2); // → 237XXXXXXXXX
    }

    // Si commence par 237 et a 12 chiffres → OK
    if (chiffres.startsWith("237") && chiffres.length === 12) {
        return chiffres;
    }

    // Si 9 chiffres (format local camerounais), ajouter 237
    if (chiffres.length === 9) {
        return "237" + chiffres;
    }

    // Si 8 chiffres (certains anciens formats), ajouter 237
    if (chiffres.length === 8) {
        return "237" + chiffres;
    }

    // Retourner tel quel (laisser Campay valider)
    return chiffres;
}

/**
 * Message lisible selon le statut
 */
function statusMessage(status) {
    switch (status) {
        case "SUCCESSFUL":
            return "Paiement confirmé avec succès !";
        case "FAILED":
            return "Paiement échoué ou refusé.";
        case "PENDING":
            return "Paiement en attente de confirmation.";
        default:
            return `Statut inconnu: ${status}`;
    }
}

/**
 * Vérifier si Campay est correctement configuré
 */
function estConfigure() {
    return !!(CAMPAY_USERNAME && CAMPAY_PASSWORD);
}

/**
 * Retourner l'état du cache token (pour diagnostic)
 */
function etatToken() {
    return {
        present: !!_token,
        expiresIn: _token ? Math.max(0, Math.round((_tokenExpiry - Date.now()) / 1000)) : 0,
        refreshing: _tokenRefreshing,
    };
}

module.exports = {
    initierPaiement,
    verifierPaiement,
    obtenirToken,
    invaliderToken,
    normaliserTelephone,
    estConfigure,
    etatToken,
    CAMPAY_BASE_URL,
};
