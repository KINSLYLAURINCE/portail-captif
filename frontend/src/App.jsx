import { useState, useEffect } from "react";
import axios from "axios";
import "./App.css";

// ─── Générer/récupérer un identifiant unique d'appareil ───────────────────
function getDeviceId() {
  let id = localStorage.getItem("smd_device_id");
  if (!id) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjklmnpqrstuvwxyz23456789";
    id = "DEV-";
    for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)];
    localStorage.setItem("smd_device_id", id);
  }
  return id;
}

// ─── Sauvegarder / récupérer le dernier ticket ────────────────────────────
function sauvegarderTicket(ticket, forfait) {
  localStorage.setItem("smd_last_ticket", JSON.stringify({ ticket, forfait, date: new Date().toISOString() }));
}
function recupererDernierTicket() {
  try {
    const raw = localStorage.getItem("smd_last_ticket");
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Ticket valide pendant 7 jours max
    if (Date.now() - new Date(data.date).getTime() > 7 * 24 * 3600 * 1000) {
      localStorage.removeItem("smd_last_ticket");
      return null;
    }
    return data;
  } catch { return null; }
}

// ─── QR Code SVG natif (sans dépendance) ──────────────────────────────────
function QRCodeSVG({ value, size = 140 }) {
  // Génère une matrice QR simplifiée basée sur le code (affichage visuel)
  // Pour un vrai QR code, on utilise l'API Google Charts (fallback si offline: affiche le code)
  const [imgOk, setImgOk] = useState(true);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=ffffff&color=1e3a8a&margin=2`;

  return (
    <div className="qr-container">
      {imgOk ? (
        <img
          src={qrUrl}
          alt={`QR Code: ${value}`}
          width={size}
          height={size}
          className="qr-img"
          onError={() => setImgOk(false)}
        />
      ) : (
        <div className="qr-fallback">
          <div className="qr-fallback-code">{value}</div>
          <div className="qr-fallback-hint">Saisir ce code pour se connecter</div>
        </div>
      )}
    </div>
  );
}

// ─── Indicateur d'étapes ───────────────────────────────────────────────────
function StepIndicator({ etape }) {
  const steps = [
    { id: "forfaits", label: "Forfait", num: 1 },
    { id: "paiement", label: "Paiement", num: 2 },
    { id: "ticket",   label: "Ticket",   num: 3 },
  ];
  const activeIndex = steps.findIndex(s => s.id === etape);
  if (activeIndex === -1) return null;
  return (
    <div className="step-indicator">
      {steps.map((s, i) => (
        <div key={s.id} className="step-item">
          <div className={`step-circle ${i < activeIndex ? "done" : i === activeIndex ? "active" : ""}`}>
            {i < activeIndex ? "✓" : s.num}
          </div>
          <div className={`step-label ${i === activeIndex ? "active" : ""}`}>{s.label}</div>
          {i < steps.length - 1 && <div className={`step-line ${i < activeIndex ? "done" : ""}`}></div>}
        </div>
      ))}
    </div>
  );
}

// ─── Sélecteur de langue ───────────────────────────────────────────────────
const LANGS = {
  fr: {
    bienvenue: "Bienvenue sur notre réseau Wi-Fi",
    acceder: "🚀 Accéder à Internet",
    dejaCode: "Vous avez déjà un code ?",
    utiliserCode: "🎫 Utiliser mon code existant",
    wifi: "📶 Wi-Fi rapide et sécurisé",
    acces: "🔐 Accès par ticket",
    compat: "📱 Compatible téléphone, tablette et PC",
    choisirForfait: "Choisissez votre forfait",
    selectionner: "Sélectionnez le forfait qui vous convient",
    payer: "💳 Payer par Mobile Money",
    retour: "← Retour",
    paiementMM: "Paiement Mobile Money",
    confirmer: "Confirmer le paiement",
    connexionRapide: "Connexion rapide",
    votreCode: "Votre code de ticket",
    seConnecter: "🌐 SE CONNECTER",
    paiementReussi: "Paiement réussi !",
    votreTicket: "Votre ticket d'accès a été généré",
    codeAcces: "Votre code d'accès",
    copier: "📋 Copier",
    copie: "✅ Copié !",
    connecterMaintenant: "🌐 SE CONNECTER MAINTENANT",
    connecte: "Vous êtes connecté ! Redirection dans",
    secondes: "s...",
    populaire: "⭐ Populaire",
    partager: "📤 Partager",
    dernierTicket: "Reprendre mon dernier ticket",
    sessionActive: "Session active",
    tempsRestant: "Temps restant estimé",
    quota: "Quota",
    debit: "Débit",
    duree: "Durée",
    numeroPaiement: "Numéro Mobile Money",
    numeroPaiementPlaceholder: "Ex: 07 00 00 00 00",
    erreurNumero: "Numéro invalide (min. 8 chiffres).",
    erreurOperateur: "Veuillez choisir un opérateur.",
    erreurCode: "Veuillez entrer votre code.",
    chargement: "Chargement...",
    aucunForfait: "Aucun forfait disponible.",
    erreurForfaits: "Impossible de charger les forfaits.",
    partagerWhatsApp: "Partager sur WhatsApp",
    imprimerTicket: "🖨️ Imprimer le ticket",
    choisirAutreForfait: "← Choisir un autre forfait",
    valideAppareil: "⚠️ Valide uniquement sur cet appareil",
    scannerConnexion: "Scanner pour se connecter",
    traitement: "Traitement en cours...",
    verifierAvantPayer: "Vérifiez avant de payer",
    confirmerPayer: "✅ Confirmer et Payer",
    modifier: "← Modifier",
    forfait: "Forfait",
    montant: "Montant",
    operateur: "Opérateur",
    numero: "Numéro",
    demandeEnvoyee: "📲 Demande envoyée au",
    confirmerTelephone: "Confirmez sur votre téléphone.",
    continuer: "Continuer →",
    changerForfait: "← Changer de forfait",
    connexionReussie: "Connexion réussie",
    besoinAide: "🛟 Besoin d'aide ?",
    contactAssistance: "Contactez notre assistance",
  },
  en: {
    bienvenue: "Welcome to our Wi-Fi network",
    acceder: "🚀 Access Internet",
    dejaCode: "Already have a code?",
    utiliserCode: "🎫 Use my existing code",
    wifi: "📶 Fast and secure Wi-Fi",
    acces: "🔐 Ticket-based access",
    compat: "📱 Compatible with phone, tablet and PC",
    choisirForfait: "Choose your plan",
    selectionner: "Select the plan that suits you",
    payer: "💳 Pay by Mobile Money",
    retour: "← Back",
    paiementMM: "Mobile Money Payment",
    confirmer: "Confirm payment",
    connexionRapide: "Quick connection",
    votreCode: "Your ticket code",
    seConnecter: "🌐 CONNECT",
    paiementReussi: "Payment successful!",
    votreTicket: "Your access ticket has been generated",
    codeAcces: "Your access code",
    copier: "📋 Copy",
    copie: "✅ Copied!",
    connecterMaintenant: "🌐 CONNECT NOW",
    connecte: "You are connected! Redirecting in",
    secondes: "s...",
    populaire: "⭐ Popular",
    partager: "📤 Share",
    dernierTicket: "Resume my last ticket",
    sessionActive: "Active session",
    tempsRestant: "Estimated time remaining",
    quota: "Quota",
    debit: "Speed",
    duree: "Duration",
    numeroPaiement: "Mobile Money Number",
    numeroPaiementPlaceholder: "Ex: 07 00 00 00 00",
    erreurNumero: "Invalid number (min. 8 digits).",
    erreurOperateur: "Please choose an operator.",
    erreurCode: "Please enter your code.",
    chargement: "Loading...",
    aucunForfait: "No plans available.",
    erreurForfaits: "Unable to load plans.",
    partagerWhatsApp: "Share on WhatsApp",
    imprimerTicket: "🖨️ Print ticket",
    choisirAutreForfait: "← Choose another plan",
    valideAppareil: "⚠️ Valid on this device only",
    scannerConnexion: "Scan to connect",
    traitement: "Processing...",
    verifierAvantPayer: "Check before paying",
    confirmerPayer: "✅ Confirm and Pay",
    modifier: "← Edit",
    forfait: "Plan",
    montant: "Amount",
    operateur: "Operator",
    numero: "Number",
    demandeEnvoyee: "📲 Request sent to",
    confirmerTelephone: "Confirm on your phone.",
    continuer: "Continue →",
    changerForfait: "← Change plan",
    connexionReussie: "Connection successful",
    besoinAide: "🛟 Need help?",
    contactAssistance: "Contact our support",
  }
};

// ─── Étape 1 : Page d'accueil ──────────────────────────────────────────────
function PageAccueil({ onCommencer, onDejaCode, onDernierTicket, lang, setLang }) {
  const t = LANGS[lang];
  const dernierTicket = recupererDernierTicket();

  return (
    <div className="portal">
      <div className="portal-card">
        <div className="lang-switcher">
          <button className={lang === "fr" ? "active" : ""} onClick={() => setLang("fr")}>FR</button>
          <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
        </div>

        <div className="logo-hero">
          <div className="logo">SMD</div>
          <div className="logo-pulse"></div>
        </div>

        <h1>SMD-CONNECT</h1>
        <p className="subtitle">{t.bienvenue}</p>

        {/* Indicateurs de qualité */}
        <div className="quality-badges">
          <span className="quality-badge">📶 Haut débit</span>
          <span className="quality-badge">🔒 Sécurisé</span>
          <span className="quality-badge">⚡ Rapide</span>
        </div>

        <button className="btn-primary btn-glow" onClick={onCommencer}>
          {t.acceder}
        </button>

        {/* Reprendre dernier ticket */}
        {dernierTicket && (
          <button className="btn-resume" onClick={onDernierTicket}>
            🔄 {t.dernierTicket} — <strong>{dernierTicket.forfait?.nom}</strong>
          </button>
        )}

        <div className="deja-code-section">
          <p className="deja-code-text">{t.dejaCode}</p>
          <button className="btn-secondary" onClick={onDejaCode}>
            {t.utiliserCode}
          </button>
        </div>

        <div className="info">
          <p>{t.wifi}</p>
          <p>{t.acces}</p>
          <p>{t.compat}</p>
        </div>

        <div className="assistance-box">
          <p className="assistance-text">{t.besoinAide} {t.contactAssistance}</p>
          <div className="assistance-numero">📞 673 256 143</div>
          <div className="assistance-links">
            <a className="btn-whatsapp" href="https://wa.me/673256143" target="_blank" rel="noreferrer">
              💬 WhatsApp
            </a>
            <a className="btn-appel" href="tel:+673256143">
              📲 Appeler
            </a>
          </div>
        </div>

        <footer>© 2026 SMD-CONNECT</footer>
      </div>
    </div>
  );
}

// ─── Connexion directe avec code existant ─────────────────────────────────
function PageCodeExistant({ onRetour, lang }) {
  const t = LANGS[lang];
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");
  const [loading, setLoading] = useState(false);
  const [connecte, setConnecte] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [forfaitInfo, setForfaitInfo] = useState(null);

  useEffect(() => {
    if (connecte) {
      const timer = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            clearInterval(timer);
            window.location.href = "http://www.google.com";
            return 0;
          }
          return c - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [connecte]);

  // Formater automatiquement le code (majuscules + tiret)
  const handleCodeChange = (e) => {
    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    // Auto-ajouter le préfixe ST- si l'utilisateur tape sans
    if (val.length === 2 && !val.startsWith("ST")) val = "ST-" + val;
    setCode(val);
  };

  const handleConnecter = async (e) => {
    e.preventDefault();
    if (!code.trim()) { setMessage(t.erreurCode); setMessageType("error"); return; }
    setLoading(true);
    setMessage("");
    try {
      const deviceId = getDeviceId();
      const response = await axios.post("/api/login-code", { code: code.trim().toUpperCase(), deviceId });
      setForfaitInfo({
        nom: response.data.forfait,
        quota: response.data.quota,
        debit: response.data.debit,
      });
      setMessage(response.data.message);
      setMessageType("success");
      setConnecte(true);
    } catch (error) {
      setMessage(error.response?.data?.message || "Impossible de contacter le serveur.");
      setMessageType("error");
    } finally { setLoading(false); }
  };

  return (
    <div className="portal">
      <div className="portal-card">
        <div className="logo">🎫</div>
        <h1>{t.connexionRapide}</h1>
        <p className="subtitle">{t.votreCode}</p>

        {!connecte ? (
          <form onSubmit={handleConnecter}>
            <div className="form-field">
              <label>{t.votreCode}</label>
              <input
                type="text"
                placeholder="Ex: ST-A1B2C3D4"
                value={code}
                onChange={handleCodeChange}
                autoFocus
                maxLength={12}
                className="code-input"
              />
            </div>
            {message && <div className={`message ${messageType}`}>{message}</div>}
            <button type="submit" className="btn-primary" disabled={loading || !code.trim()}>
              {loading ? <span className="btn-loading"><span className="dot-pulse"></span> Connexion...</span> : t.seConnecter}
            </button>
          </form>
        ) : (
          <div className="connexion-success-card">
            <div className="success-icon-big">✅</div>
            <h2 className="success-title">{t.connexionReussie}</h2>
            {forfaitInfo && (
              <div className="session-info-grid">
                {forfaitInfo.nom  && <div className="session-info-item"><span>📦</span><strong>{forfaitInfo.nom}</strong></div>}
                {forfaitInfo.quota && <div className="session-info-item"><span>{t.quota}</span><strong>{forfaitInfo.quota}</strong></div>}
                {forfaitInfo.debit && <div className="session-info-item"><span>⚡</span><strong>{forfaitInfo.debit}</strong></div>}
              </div>
            )}
            <div className="countdown-bar">
              <div className="countdown-fill" style={{ animationDuration: `${countdown}s` }}></div>
            </div>
            <p className="countdown-text">{t.connecte} <strong>{countdown}</strong>{t.secondes}</p>
          </div>
        )}

        <button className="btn-secondary" onClick={onRetour}>{t.retour}</button>
        <footer>© 2026 SMD-CONNECT</footer>
      </div>
    </div>
  );
}

// ─── Étape 2 : Choix du forfait ────────────────────────────────────────────
function PageForfaits({ onChoisir, onRetour, lang }) {
  const t = LANGS[lang];
  const [forfaits, setForfaits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState("");
  const [selection, setSelection] = useState(null);

  useEffect(() => {
    axios.get("/api/forfaits")
      .then(r => { setForfaits(r.data.forfaits); setLoading(false); })
      .catch(() => { setErreur(t.erreurForfaits); setLoading(false); });
  }, []);

  // Déterminer le forfait "populaire" (le plus cher parmi les actifs, ou le 2e)
  const forfaitPopulaireId = forfaits.length >= 2
    ? forfaits[Math.floor(forfaits.length / 2)]?.id
    : forfaits[0]?.id;

  return (
    <div className="portal">
      <div className="portal-card wide">
        <StepIndicator etape="forfaits" />
        <div className="logo">ST</div>
        <h1>{t.choisirForfait}</h1>
        <p className="subtitle">{t.selectionner}</p>

        {loading && (
          <div className="loading-skeleton">
            {[1,2,3].map(i => <div key={i} className="skeleton-card"></div>)}
          </div>
        )}
        {erreur && <div className="message error">{erreur}</div>}
        {!loading && forfaits.length === 0 && <div className="message error">{t.aucunForfait}</div>}

        <div className="forfaits-grid">
          {forfaits.map(f => (
            <div
              key={f.id}
              className={`forfait-card ${selection?.id === f.id ? "selected" : ""} ${f.id === forfaitPopulaireId ? "populaire" : ""}`}
              onClick={() => setSelection(f)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === "Enter" && setSelection(f)}
            >
              {f.id === forfaitPopulaireId && (
                <div className="badge-populaire">{t.populaire}</div>
              )}
              <div className="forfait-nom">{f.nom}</div>
              <div className="forfait-prix">{f.prix.toLocaleString()} <span>FCFA</span></div>
              <div className="forfait-details">
                {f.duree  && <span>⏱️ {f.duree}</span>}
                {f.quota  && <span>📦 {f.quota}</span>}
                {f.debit  && <span>⚡ {f.debit}</span>}
              </div>
              {selection?.id === f.id && <div className="forfait-check">✓</div>}
            </div>
          ))}
        </div>

        {selection && (
          <div className="selection-recap">
            <strong>{t.forfait} :</strong> {selection.nom} — <strong className="prix-recap">{selection.prix.toLocaleString()} FCFA</strong>
          </div>
        )}

        <button className="btn-primary" onClick={() => onChoisir(selection)} disabled={!selection}>
          {t.payer}
        </button>
        <button className="btn-secondary" onClick={onRetour}>{t.retour}</button>
        <footer>© 2026 SMD-CONNECT</footer>
      </div>
    </div>
  );
}

// ─── Étape 3 : Paiement Mobile Money (Campay) ─────────────────────────────
function PagePaiement({ forfait, onPaiementValide, onRetour, lang }) {
  const t = LANGS[lang];
  const [operateur, setOperateur] = useState("");
  const [telephone, setTelephone] = useState("");
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState("");
  // etapePaiement: "saisie" | "confirmation" | "attente" | "echec"
  const [etapePaiement, setEtapePaiement] = useState("saisie");
  // Données Campay
  const [campayRef, setCampayRef] = useState(null);
  const [ussdCode, setUssdCode] = useState(null);
  const [tentatives, setTentatives] = useState(0);
  const [messageAttente, setMessageAttente] = useState("");
  // Compteur de secondes restantes (60s max)
  const [secondesRestantes, setSecondesRestantes] = useState(60);

  // Opérateurs supportés par Campay (Orange Money + MTN MoMo)
  const operateurs = [
    { id: "orange", nom: "Orange Money", emoji: "🟠", couleur: "#ff6600", campay: true },
    { id: "mtn",    nom: "MTN MoMo",     emoji: "🟡", couleur: "#ffcc00", campay: true },
    { id: "moov",   nom: "Moov Money",   emoji: "🔵", couleur: "#0066cc", campay: false },
    { id: "wave",   nom: "Wave",         emoji: "🌊", couleur: "#1a9bfc", campay: false },
  ];

  const MAX_TENTATIVES = 20; // 20 × 3s = 60s max

  // Validation numéro de téléphone
  const validerTelephone = (tel) => {
    const chiffres = tel.replace(/\D/g, "");
    return chiffres.length >= 8;
  };

  const handleConfirmer = () => {
    if (!operateur) { setErreur(t.erreurOperateur); return; }
    if (!validerTelephone(telephone)) { setErreur(t.erreurNumero); return; }
    setErreur("");
    setEtapePaiement("confirmation");
  };

  // ── Lancer le paiement Campay ──────────────────────────────────────────
  const handlePayer = async () => {
    setLoading(true);
    setErreur("");

    const op = operateurs.find(o => o.id === operateur);

    // Si opérateur non supporté par Campay → fallback vers l'ancienne route /api/acheter
    if (!op?.campay) {
      try {
        const deviceId = getDeviceId();
        const r = await axios.post("/api/acheter", {
          forfaitId: forfait.id,
          telephone: telephone.trim(),
          operateur,
          deviceId
        });
        onPaiementValide(r.data.ticket, forfait);
      } catch (err) {
        setErreur(err.response?.data?.message || "Erreur lors du paiement.");
        setEtapePaiement("confirmation");
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Paiement via Campay (Orange Money / MTN MoMo) ──────────────────
    try {
      const deviceId = getDeviceId();
      const r = await axios.post("/api/paiement/initier", {
        forfaitId: forfait.id,
        telephone: telephone.trim(),
        operateur,
        deviceId
      });

      if (r.data.success) {
        setCampayRef(r.data.reference);
        setUssdCode(r.data.ussd_code || null);
        setTentatives(0);
        setSecondesRestantes(60);
        setMessageAttente(r.data.message || t.confirmerTelephone);
        setEtapePaiement("attente");
      } else {
        setErreur(r.data.message || "Erreur lors de l'initiation du paiement.");
        setEtapePaiement("confirmation");
      }
    } catch (err) {
      const msg = err.response?.data?.message || "Impossible de contacter le serveur de paiement.";
      // Si Campay non configuré → fallback vers /api/acheter
      if (err.response?.data?.campayManquant) {
        try {
          const deviceId = getDeviceId();
          const r = await axios.post("/api/acheter", {
            forfaitId: forfait.id,
            telephone: telephone.trim(),
            operateur,
            deviceId
          });
          onPaiementValide(r.data.ticket, forfait);
          return;
        } catch (err2) {
          setErreur(err2.response?.data?.message || "Erreur lors du paiement.");
        }
      } else {
        setErreur(msg);
      }
      setEtapePaiement("confirmation");
    } finally {
      setLoading(false);
    }
  };

  // ── Polling : vérifier le statut du paiement Campay ───────────────────
  useEffect(() => {
    if (etapePaiement !== "attente" || !campayRef) return;

    let annule = false;
    let compteur = 0;

    const verifier = async () => {
      if (annule) return;
      try {
        const deviceId = getDeviceId();
        const r = await axios.post("/api/paiement/verifier", {
          reference: campayRef,
          deviceId
        });

        if (annule) return;

        if (r.data.status === "SUCCESSFUL") {
          onPaiementValide(r.data.ticket, r.data.forfait || forfait);
          return;
        }

        if (r.data.status === "FAILED") {
          setErreur(r.data.message || "Paiement refusé ou échoué.");
          setEtapePaiement("echec");
          return;
        }

        // PENDING → continuer le polling
        compteur++;
        setTentatives(compteur);
        setSecondesRestantes(Math.max(0, 60 - compteur * 3));

        if (compteur >= MAX_TENTATIVES) {
          setErreur("Délai d'attente dépassé (60s). Vérifiez votre téléphone et réessayez.");
          setEtapePaiement("echec");
          return;
        }

        // Attendre 3 secondes avant la prochaine vérification
        setTimeout(verifier, 3000);
      } catch (err) {
        if (!annule) {
          // Erreur réseau temporaire → réessayer une fois
          compteur++;
          setTentatives(compteur);
          if (compteur < MAX_TENTATIVES) {
            setTimeout(verifier, 5000);
          } else {
            setErreur("Erreur de vérification du paiement. Réessayez.");
            setEtapePaiement("echec");
          }
        }
      }
    };

    // Première vérification après 5 secondes (laisser le temps à l'utilisateur de confirmer)
    const timer = setTimeout(verifier, 5000);
    return () => { annule = true; clearTimeout(timer); };
  }, [etapePaiement, campayRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Écran d'attente (polling en cours) ────────────────────────────────
  if (etapePaiement === "attente") {
    const op = operateurs.find(o => o.id === operateur);
    const progression = Math.min((tentatives / MAX_TENTATIVES) * 100, 95);
    return (
      <div className="portal">
        <div className="portal-card">
          <StepIndicator etape="paiement" />
          <div className="paiement-traitement">
            <div className="traitement-icon" style={{ color: op?.couleur }}>
              {op?.emoji}
            </div>
            <h2>📲 Confirmez sur votre téléphone</h2>
            <p style={{ fontSize: "0.95rem", color: "#555", marginBottom: "0.5rem" }}>
              Une demande a été envoyée au <strong>{telephone}</strong>
            </p>
            <div className="paiement-montant">{forfait.prix.toLocaleString()} FCFA</div>

            {/* Code USSD si disponible */}
            {ussdCode && (
              <div className="ussd-box">
                <div className="ussd-label">📞 Code USSD à composer :</div>
                <div className="ussd-code">{ussdCode}</div>
                <div className="ussd-hint">Composez ce code sur votre téléphone pour confirmer</div>
              </div>
            )}

            <p style={{ fontSize: "0.85rem", color: "#888", margin: "0.5rem 0 1rem" }}>
              {messageAttente}
            </p>

            {/* Barre de progression */}
            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${progression}%`, transition: "width 0.5s" }}></div>
            </div>
            <p className="progress-label" style={{ fontSize: "0.8rem", color: "#aaa" }}>
              ⏳ Vérification en cours... {secondesRestantes > 0 ? `(${secondesRestantes}s restantes)` : ""}
            </p>

            <button
              className="btn-secondary"
              style={{ marginTop: "1.5rem" }}
              onClick={() => { setEtapePaiement("confirmation"); setCampayRef(null); setUssdCode(null); }}
            >
              ✕ Annuler
            </button>
          </div>
          <footer>© 2026 SMD-CONNECT</footer>
        </div>
      </div>
    );
  }

  // ── Écran d'échec ──────────────────────────────────────────────────────
  if (etapePaiement === "echec") {
    return (
      <div className="portal">
        <div className="portal-card">
          <StepIndicator etape="paiement" />
          <div className="logo">❌</div>
          <h1 style={{ color: "#dc2626" }}>Paiement échoué</h1>
          <p className="subtitle">{erreur}</p>
          <div className="echec-aide">
            <p>💡 <strong>Que faire ?</strong></p>
            <ul style={{ textAlign: "left", fontSize: "0.9rem", color: "#555", paddingLeft: "1.2rem" }}>
              <li>Vérifiez que votre solde est suffisant</li>
              <li>Assurez-vous d'avoir confirmé sur votre téléphone</li>
              <li>Vérifiez que le numéro est correct</li>
            </ul>
          </div>
          <button className="btn-primary" onClick={() => { setEtapePaiement("confirmation"); setErreur(""); setCampayRef(null); setUssdCode(null); setTentatives(0); setSecondesRestantes(60); }}>
            🔄 Réessayer
          </button>
          <button className="btn-secondary" onClick={onRetour}>{t.changerForfait}</button>
          <footer>© 2026 SMD-CONNECT</footer>
        </div>
      </div>
    );
  }

  // ── Écran de confirmation (récapitulatif avant paiement) ───────────────
  if (etapePaiement === "confirmation") {
    const op = operateurs.find(o => o.id === operateur);
    return (
      <div className="portal">
        <div className="portal-card">
          <StepIndicator etape="paiement" />
          <div className="logo">💳</div>
          <h1>{t.confirmer}</h1>
          <p className="subtitle">{t.verifierAvantPayer}</p>
          <div className="confirmation-box">
            <div className="confirmation-ligne">
              <span>{t.forfait}</span>
              <strong>{forfait.nom}</strong>
            </div>
            <div className="confirmation-ligne">
              <span>{t.montant}</span>
              <strong className="montant-highlight">{forfait.prix.toLocaleString()} FCFA</strong>
            </div>
            <div className="confirmation-ligne">
              <span>{t.operateur}</span>
              <strong>{op?.emoji} {op?.nom}</strong>
            </div>
            <div className="confirmation-ligne">
              <span>{t.numero}</span>
              <strong>{telephone}</strong>
            </div>
          </div>
          {op?.campay && (
            <p className="paiement-instruction">
              📲 Une notification USSD sera envoyée au <strong>{telephone}</strong>. Confirmez sur votre téléphone pour valider le paiement.
            </p>
          )}
          {!op?.campay && (
            <p className="paiement-instruction" style={{ color: "#f59e0b" }}>
              ⚠️ {op?.nom} : paiement manuel. Effectuez le virement puis cliquez Confirmer.
            </p>
          )}
          {erreur && <div className="message error">{erreur}</div>}
          <button className="btn-primary btn-glow" onClick={handlePayer} disabled={loading}>
            {loading
              ? <span className="btn-loading"><span className="dot-pulse"></span> Envoi en cours...</span>
              : t.confirmerPayer}
          </button>
          <button className="btn-secondary" onClick={() => setEtapePaiement("saisie")}>{t.modifier}</button>
          <footer>© 2026 SMD-CONNECT</footer>
        </div>
      </div>
    );
  }

  // ── Écran de saisie (choix opérateur + numéro) ─────────────────────────
  return (
    <div className="portal">
      <div className="portal-card">
        <StepIndicator etape="paiement" />
        <div className="logo">💳</div>
        <h1>{t.paiementMM}</h1>
        <p className="subtitle">Payez {forfait.prix.toLocaleString()} FCFA — {forfait.nom}</p>

        <div className="operateurs-grid">
          {operateurs.map(op => (
            <div
              key={op.id}
              className={`operateur-card ${operateur === op.id ? "selected" : ""}`}
              onClick={() => setOperateur(op.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === "Enter" && setOperateur(op.id)}
              style={operateur === op.id ? { borderColor: op.couleur, background: `${op.couleur}10` } : {}}
            >
              <div className="operateur-emoji">{op.emoji}</div>
              <div className="operateur-nom">{op.nom}</div>
              {op.campay && <div className="operateur-badge">✅ Campay</div>}
              {operateur === op.id && <div className="forfait-check" style={{ background: op.couleur }}>✓</div>}
            </div>
          ))}
        </div>

        <div className="form-field">
          <label>{t.numeroPaiement}</label>
          <input
            type="tel"
            placeholder={t.numeroPaiementPlaceholder}
            value={telephone}
            onChange={e => setTelephone(e.target.value)}
            maxLength={15}
            inputMode="numeric"
          />
        </div>

        {erreur && <div className="message error">{erreur}</div>}

        <button
          className="btn-primary"
          onClick={handleConfirmer}
          disabled={!operateur || !telephone.trim()}
        >
          {t.continuer}
        </button>
        <button className="btn-secondary" onClick={onRetour}>{t.changerForfait}</button>
        <footer>© 2026 SMD-CONNECT</footer>
      </div>
    </div>
  );
}

// ─── Étape 4 : Ticket + connexion ─────────────────────────────────────────
function PageTicket({ ticket, forfait, onRetour, lang }) {
  const t = LANGS[lang];
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");
  const [loading, setLoading] = useState(false);
  const [connecte, setConnecte] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [copie, setCopie] = useState(false);
  const [forfaitInfo, setForfaitInfo] = useState(null);

  // Sauvegarder le ticket dans le localStorage
  useEffect(() => {
    sauvegarderTicket(ticket, forfait);
  }, [ticket, forfait]);

  useEffect(() => {
    if (connecte) {
      const timer = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) { clearInterval(timer); window.location.href = "http://www.google.com"; return 0; }
          return c - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [connecte]);

  const handleCopier = () => {
    navigator.clipboard.writeText(ticket.code).then(() => {
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    }).catch(() => {
      // Fallback pour les navigateurs sans clipboard API
      const el = document.createElement("textarea");
      el.value = ticket.code;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    });
  };

  const handlePartagerWhatsApp = () => {
    const msg = `🌐 Mon code Wi-Fi SMD-CONNECT :\n*${ticket.code}*\n📦 Forfait : ${forfait.nom}\n⏱️ Durée : ${forfait.duree || "—"}\n\nConnectez-vous sur le portail Wi-Fi et entrez ce code.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const handleConnecter = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await axios.post("/api/login", { ticket: ticket.code, forfaitId: forfait.id });
      setForfaitInfo({
        nom: response.data.forfait,
        quota: response.data.quota,
        debit: response.data.debit,
      });
      setMessage(response.data.message);
      setMessageType("success");
      setConnecte(true);
    } catch (error) {
      setMessage(error.response?.data?.message || "Impossible de contacter le serveur.");
      setMessageType("error");
    } finally { setLoading(false); }
  };

  const handleImprimer = () => window.print();

  return (
    <div className="portal">
      <div className="portal-card printable">
        <StepIndicator etape="ticket" />
        <div className="logo">🎫</div>
        <h1>{t.paiementReussi}</h1>
        <p className="subtitle">{t.votreTicket}</p>

        {/* Récapitulatif forfait */}
        <div className="ticket-forfait">
          <div className="ticket-forfait-nom">{forfait.nom}</div>
          <div className="ticket-forfait-details">
            {forfait.duree  && <span>⏱️ {forfait.duree}</span>}
            {forfait.quota  && <span>📦 {forfait.quota}</span>}
            {forfait.debit  && <span>⚡ {forfait.debit}</span>}
          </div>
          <div className="ticket-forfait-prix">{forfait.prix.toLocaleString()} FCFA</div>
        </div>

        {/* Code d'accès */}
        <div className="ticket-code-box">
          <div className="ticket-code-label">{t.codeAcces}</div>
          <div className="ticket-code">{ticket.code}</div>
          <div className="ticket-code-actions">
            <button className="btn-copier" onClick={handleCopier}>
              {copie ? t.copie : t.copier}
            </button>
            <button className="btn-partager no-print" onClick={handlePartagerWhatsApp}>
              💬 WhatsApp
            </button>
          </div>
          <div className="ticket-code-hint">{t.valideAppareil}</div>
        </div>

        {/* QR Code */}
        <div className="qr-section no-print">
          <div className="qr-label">{t.scannerConnexion}</div>
          <QRCodeSVG value={ticket.code} size={140} />
        </div>

        {/* Message de statut */}
        {message && <div className={`message ${messageType}`}>{message}</div>}

        {/* Bouton connexion ou succès */}
        {!connecte ? (
          <button className="btn-primary btn-glow" onClick={handleConnecter} disabled={loading}>
            {loading
              ? <span className="btn-loading"><span className="dot-pulse"></span> Connexion...</span>
              : t.connecterMaintenant}
          </button>
        ) : (
          <div className="connexion-success-card">
            <div className="success-icon-big">✅</div>
            <h2 className="success-title">{t.connexionReussie}</h2>
            {forfaitInfo && (
              <div className="session-info-grid">
                {forfaitInfo.nom   && <div className="session-info-item"><span>📦</span><strong>{forfaitInfo.nom}</strong></div>}
                {forfaitInfo.quota && <div className="session-info-item"><span>{t.quota}</span><strong>{forfaitInfo.quota}</strong></div>}
                {forfaitInfo.debit && <div className="session-info-item"><span>⚡</span><strong>{forfaitInfo.debit}</strong></div>}
              </div>
            )}
            <div className="countdown-bar">
              <div className="countdown-fill" style={{ animationDuration: `${countdown}s` }}></div>
            </div>
            <p className="countdown-text">{t.connecte} <strong>{countdown}</strong>{t.secondes}</p>
          </div>
        )}

        <button className="btn-imprimer no-print" onClick={handleImprimer}>{t.imprimerTicket}</button>
        <button className="btn-secondary no-print" onClick={onRetour}>{t.choisirAutreForfait}</button>
        <footer>© 2026 SMD-CONNECT</footer>
      </div>
    </div>
  );
}

// ─── Étape session active (restaurée au chargement) ────────────────────────
function PageSessionActive({ session, onRetour, lang }) {
  const t = LANGS[lang];
  const [countdown, setCountdown] = useState(session.secondesRestantes || 0);
  const [connecte, setConnecte] = useState(false);
  const [redirectCount, setRedirectCount] = useState(5);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(timer); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (connecte) {
      const timer = setInterval(() => {
        setRedirectCount(c => {
          if (c <= 1) { clearInterval(timer); window.location.href = "http://www.google.com"; return 0; }
          return c - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [connecte]);

  const formatTime = (s) => {
    if (s === null || s === undefined) return "Illimité";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  };

  const handleConnecter = async () => {
    setConnecte(true);
  };

  if (connecte) {
    return (
      <div className="portal">
        <div className="portal-card">
          <div className="success-icon-big">✅</div>
          <h2 className="success-title">{t.connexionReussie}</h2>
          <div className="session-info-grid">
            {session.forfait && <div className="session-info-item"><span>📦</span><strong>{session.forfait}</strong></div>}
            {session.quota && <div className="session-info-item"><span>{t.quota}</span><strong>{session.quota}</strong></div>}
            {session.debit && <div className="session-info-item"><span>⚡</span><strong>{session.debit}</strong></div>}
            <div className="session-info-item"><span>⏱️</span><strong>{formatTime(session.secondesRestantes)}</strong></div>
          </div>
          <div className="countdown-bar">
            <div className="countdown-fill" style={{ animationDuration: `${redirectCount}s` }}></div>
          </div>
          <p className="countdown-text">{t.connecte} <strong>{redirectCount}</strong>{t.secondes}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="portal">
      <div className="portal-card">
        <div className="logo">📶</div>
        <h1>{t.sessionActive}</h1>
        <p className="subtitle">{session.forfait}</p>

        <div className="ticket-forfait">
          <div className="ticket-forfait-nom">{session.forfait}</div>
          <div className="ticket-forfait-details">
            {session.quota && <span>📦 {session.quota}</span>}
            {session.debit && <span>⚡ {session.debit}</span>}
          </div>
        </div>

        <div className="ticket-code-box">
          <div className="ticket-code-label">{t.codeAcces}</div>
          <div className="ticket-code">{session.ticket}</div>
        </div>

        {session.secondesRestantes !== null && (
          <div style={{ textAlign: "center", margin: "1rem 0" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#2563eb" }}>
              ⏱️ {formatTime(session.secondesRestantes)}
            </div>
            <div style={{ fontSize: "0.85rem", color: "#888" }}>{t.tempsRestant}</div>
          </div>
        )}

        <button className="btn-primary btn-glow" onClick={handleConnecter}>
          {t.connecterMaintenant}
        </button>
        <button className="btn-secondary" onClick={onRetour}>{t.retour}</button>
        <footer>© 2026 SMD-CONNECT</footer>
      </div>
    </div>
  );
}

// ─── App principale ────────────────────────────────────────────────────────
function App() {
  const [etape, setEtape] = useState("accueil");
  const [forfaitChoisi, setForfaitChoisi] = useState(null);
  const [ticketGenere, setTicketGenere] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem("smd_lang");
    if (saved) return saved;
    const nav = navigator.language?.slice(0, 2);
    return nav === "en" ? "en" : "fr";
  });

  useEffect(() => {
    localStorage.setItem("smd_lang", lang);
  }, [lang]);

  // Vérifier la session au chargement
  useEffect(() => {
    const deviceId = getDeviceId();
    axios.get(`/api/session?deviceId=${encodeURIComponent(deviceId)}`)
      .then(r => {
        if (r.data.connecte) {
          setSessionData({
            ticket: r.data.ticket,
            forfait: r.data.forfait,
            quota: r.data.quota,
            debit: r.data.debit,
            duree: r.data.duree,
            debut: r.data.debut,
            secondesRestantes: r.data.secondesRestantes,
          });
          setEtape("session-active");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChoisirForfait = (forfait) => { setForfaitChoisi(forfait); setEtape("paiement"); };
  const handlePaiementValide = (ticket, forfait) => { setTicketGenere(ticket); setForfaitChoisi(forfait); setEtape("ticket"); };

  const handleDernierTicket = () => {
    const data = recupererDernierTicket();
    if (data) {
      setTicketGenere(data.ticket);
      setForfaitChoisi(data.forfait);
      setEtape("ticket");
    }
  };

  if (loading) return <div className="portal"><div className="portal-card"><div className="loading-skeleton"><div className="skeleton-card"></div></div></div></div>;

  if (etape === "session-active") return <PageSessionActive session={sessionData} onRetour={() => setEtape("accueil")} lang={lang} />;
  if (etape === "accueil")        return <PageAccueil onCommencer={() => setEtape("forfaits")} onDejaCode={() => setEtape("code-existant")} onDernierTicket={handleDernierTicket} lang={lang} setLang={setLang} />;
  if (etape === "code-existant")  return <PageCodeExistant onRetour={() => setEtape("accueil")} lang={lang} />;
  if (etape === "forfaits")       return <PageForfaits onChoisir={handleChoisirForfait} onRetour={() => setEtape("accueil")} lang={lang} />;
  if (etape === "paiement")       return <PagePaiement forfait={forfaitChoisi} onPaiementValide={handlePaiementValide} onRetour={() => setEtape("forfaits")} lang={lang} />;
  if (etape === "ticket")         return <PageTicket ticket={ticketGenere} forfait={forfaitChoisi} onRetour={() => setEtape("forfaits")} lang={lang} />;
}

export default App;
