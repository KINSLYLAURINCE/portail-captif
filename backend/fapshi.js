const axios = require("axios");

const FAPSHI_API_USER = process.env.FAPSHI_API_USER || "";
const FAPSHI_API_KEY = process.env.FAPSHI_API_KEY || "";
const FAPSHI_WEBHOOK_SECRET = process.env.FAPSHI_WEBHOOK_SECRET || "";
const FAPSHI_PAYOUT_API_USER = process.env.FAPSHI_PAYOUT_API_USER || "";
const FAPSHI_PAYOUT_API_KEY = process.env.FAPSHI_PAYOUT_API_KEY || "";

// Auto-detect environment from API key prefix
// FAK_TEST_* → sandbox.fapshi.com | FAK_* → live.fapshi.com
function getBaseUrl() {
    if (FAPSHI_API_KEY.startsWith("FAK_TEST_")) return "https://sandbox.fapshi.com";
    return "https://live.fapshi.com";
}

const FAPSHI_BASE_URL = getBaseUrl();

function getPayoutBaseUrl() {
    if (FAPSHI_PAYOUT_API_KEY.startsWith("FAK_TEST_")) return "https://sandbox.fapshi.com";
    return "https://live.fapshi.com";
}

const FAPSHI_PAYOUT_BASE_URL = getPayoutBaseUrl();

function headers() {
    return {
        apiuser: FAPSHI_API_USER,
        apikey: FAPSHI_API_KEY,
        "Content-Type": "application/json",
    };
}

/**
 * Initier un paiement Mobile Money via Fapshi (direct pay)
 */
async function initierPaiement(telephone, montant, description, reference) {
    const MAX_RETRIES = 2;

    for (let tentative = 0; tentative <= MAX_RETRIES; tentative++) {
        try {
            const tel = normaliserTelephone(telephone);

            const payload = {
                amount: montant,
                phone: tel,
                externalId: reference || undefined,
                message: description || "Achat forfait Wi-Fi SMD-CONNECT",
            };

            console.log(
                `📲 [Fapshi] Initiation paiement: ${montant} FCFA → ${tel} (tentative ${tentative + 1})`
            );

            const response = await axios.post(
                `${FAPSHI_BASE_URL}/direct-pay`,
                payload,
                { headers: headers(), timeout: 30000 }
            );

            const data = response.data;
            console.log(
                `✅ [Fapshi] Paiement initié — transId: ${data.transId}`
            );

            return {
                success: true,
                transId: data.transId,
                message: data.message || "Demande de paiement envoyée. Confirmez sur votre téléphone.",
                dateInitiated: data.dateInitiated,
            };
        } catch (err) {
            if (err.response?.status === 429 && tentative < MAX_RETRIES) {
                console.warn(`⚠️ [Fapshi] Rate limit (429), attente... (tentative ${tentative + 1})`);
                await new Promise((r) => setTimeout(r, 2000 * (tentative + 1)));
                continue;
            }

            const errData = err.response?.data;
            const msg =
                errData?.message ||
                (typeof errData === "string" ? errData : null) ||
                err.message ||
                "Erreur lors de l'initiation du paiement.";

            console.error("❌ [Fapshi] Erreur initiation:", msg, errData);
            return { success: false, message: msg };
        }
    }

    return { success: false, message: "Échec après plusieurs tentatives." };
}

/**
 * Vérifier le statut d'une transaction Fapshi
 */
async function verifierPaiement(transId) {
    const MAX_RETRIES = 2;

    for (let tentative = 0; tentative <= MAX_RETRIES; tentative++) {
        try {
            const response = await axios.get(
                `${FAPSHI_BASE_URL}/payment-status/${transId}`,
                { headers: headers(), timeout: 15000 }
            );

            const data = response.data;
            const status = data.status; // CREATED, PENDING, SUCCESSFUL, FAILED, EXPIRED

            console.log(`🔍 [Fapshi] Statut transaction ${transId}: ${status}`);

            return {
                success: true,
                status,
                medium: data.medium || null,
                amount: data.amount || null,
                revenue: data.revenue || null,
                payerName: data.payerName || null,
                message: statusMessage(status),
            };
        } catch (err) {
            if (err.response?.status === 429) {
                console.warn(`⚠️ [Fapshi] Rate limit (429) sur ${transId} — on repasse en attente`);
                return {
                    success: true,
                    status: "PENDING",
                    medium: null,
                    amount: null,
                    message: "Vérification en attente (limite de requêtes Fapshi).",
                };
            }

            const msg =
                err.response?.data?.message ||
                err.message;
            console.error("❌ [Fapshi] Erreur vérification:", msg);

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
 * Vérifier l'authenticité d'un webhook Fapshi
 */
function verifierWebhook(req) {
    if (!FAPSHI_WEBHOOK_SECRET) return true; // pas de secret configuré → accepter
    const secret = req.headers["x-wh-secret"];
    return secret === FAPSHI_WEBHOOK_SECRET;
}

/**
 * Normaliser un numéro de téléphone au format Fapshi (9 chiffres sans indicatif)
 * Supporte : +237670000000, 00237670000000, 237670000000, 670000000
 */
function normaliserTelephone(tel) {
    if (!tel) return "";

    let chiffres = String(tel).replace(/\D/g, "");

    if (chiffres.startsWith("00237")) {
        chiffres = chiffres.slice(5); // retirer 00237 → garder 9 chiffres
    } else if (chiffres.startsWith("237") && chiffres.length === 12) {
        chiffres = chiffres.slice(3); // retirer 237 → garder 9 chiffres
    }

    // Fapshi veut 9 chiffres commençant par 6
    if (chiffres.length === 9 && chiffres.startsWith("6")) {
        return chiffres;
    }

    // Fallback: retourner tel quel
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
        case "CREATED":
            return "Paiement créé, en attente.";
        case "EXPIRED":
            return "Le paiement a expiré (24h dépassées).";
        default:
            return `Statut inconnu: ${status}`;
    }
}

function estConfigure() {
    return !!(FAPSHI_API_USER && FAPSHI_API_KEY);
}

function etatToken() {
    return { configured: estConfigure(), baseUrl: FAPSHI_BASE_URL };
}

// ─────────────────────────────────────────
// RETRAITS (PAYOUT SERVICE)
// ─────────────────────────────────────────

function estPayoutConfigure() {
    return !!(FAPSHI_PAYOUT_API_USER && FAPSHI_PAYOUT_API_KEY);
}

function payoutHeaders() {
    return {
        apiuser: FAPSHI_PAYOUT_API_USER,
        apikey: FAPSHI_PAYOUT_API_KEY,
        "Content-Type": "application/json",
    };
}

/**
 * Solde du service de retrait (GET /balance).
 * Le solde est celui du service dont on utilise les identifiants.
 */
async function soldePayout() {
    if (!estPayoutConfigure()) {
        return { success: false, message: "Service de retrait Fapshi non configuré." };
    }

    try {
        const r = await axios.get(`${FAPSHI_PAYOUT_BASE_URL}/balance`, {
            headers: payoutHeaders(),
            timeout: 15000,
        });

        return {
            success: true,
            service: r.data.service,
            balance: r.data.balance,
            currency: r.data.currency,
        };
    } catch (err) {
        const msg = err.response?.data?.message || err.message || "Erreur lecture solde Fapshi.";
        console.error("❌ [Fapshi Payout] Erreur solde:", msg);
        return { success: false, message: msg };
    }
}

/**
 * Crée un retrait (POST /payout).
 * medium: "mobile money" | "orange money" | "fapshi"
 * - mobile money / orange money → phone requis
 * - fapshi → email requis
 */
async function creerRetrait({ amount, phone, medium, name, email, userId, externalId, message }) {
    if (!estPayoutConfigure()) {
        return { success: false, message: "Service de retrait Fapshi non configuré." };
    }

    const payload = { amount, userId, externalId };
    if (message) payload.message = message;
    if (name) payload.name = name;

    if (medium === "fapshi") {
        payload.medium = "fapshi";
        payload.email = email;
    } else {
        payload.phone = normaliserTelephone(phone);
        if (medium) payload.medium = medium;
        if (email) payload.email = email;
    }

    try {
        const r = await axios.post(`${FAPSHI_PAYOUT_BASE_URL}/payout`, payload, {
            headers: payoutHeaders(),
            timeout: 30000,
        });

        return {
            success: true,
            transId: r.data.transId,
            message: r.data.message || "Retrait accepté.",
            dateInitiated: r.data.dateInitiated,
        };
    } catch (err) {
        const msg = err.response?.data?.message || err.message || "Erreur lors du retrait Fapshi.";
        const incertain = ["ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(err.code);
        console.error("❌ [Fapshi Payout] Erreur retrait:", msg, err.code || "");
        return { success: false, message: msg, incertain };
    }
}

/**
 * Récupère les transactions d'un userId (GET /transaction/:userId).
 * Sert à réconcilier un retrait après un timeout (Fapshi n'a pas d'idempotence).
 */
async function transactionParUserId(userId) {
    if (!estPayoutConfigure()) {
        return { success: false, message: "Service de retrait Fapshi non configuré." };
    }

    try {
        const r = await axios.get(
            `${FAPSHI_PAYOUT_BASE_URL}/transaction/${encodeURIComponent(userId)}`,
            { headers: payoutHeaders(), timeout: 15000 }
        );

        return {
            success: true,
            transactions: Array.isArray(r.data) ? r.data : [r.data],
        };
    } catch (err) {
        const msg = err.response?.data?.message || err.message || "Erreur lecture transaction Fapshi.";
        console.error("❌ [Fapshi Payout] Erreur transaction:", msg);
        return { success: false, message: msg };
    }
}

module.exports = {
    initierPaiement,
    verifierPaiement,
    verifierWebhook,
    normaliserTelephone,
    estConfigure,
    etatToken,
    FAPSHI_BASE_URL,
    estPayoutConfigure,
    soldePayout,
    creerRetrait,
    transactionParUserId,
    FAPSHI_PAYOUT_BASE_URL,
};
