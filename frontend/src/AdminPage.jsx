import { useState, useEffect } from "react";
import axios from "axios";
import {
  LayoutDashboard, Package, Ticket, Wifi, Router, CreditCard, Home, Star,
  Users, BarChart3, DollarSign, ShieldBan, ScrollText, Settings, Plus,
  List, RefreshCw, Trash2, Edit3, Check, X, Clock, Search, Download,
  Save, ChevronLeft, ChevronRight, AlertTriangle, Info, Zap, Globe,
  Lock, Unlock, WifiOff, CircleDot, ArrowRight, Copy
} from "lucide-react";
import "./AdminPage.css";

// ─── Utilitaires ───────────────────────────────────────────────────────────
function useSearch(items, keys) {
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? items.filter(item => keys.some(k => String(item[k] || "").toLowerCase().includes(query.toLowerCase())))
    : items;
  return { query, setQuery, filtered };
}

function usePagination(items, perPage = 10) {
  const [page, setPage] = useState(1);
  const total = Math.ceil(items.length / perPage);
  const paginated = items.slice((page - 1) * perPage, page * perPage);
  const reset = () => setPage(1);
  return { page, setPage, total, paginated, reset };
}

function Pagination({ page, total, setPage }) {
  if (total <= 1) return null;
  return (
    <div className="pagination">
      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
      {Array.from({ length: total }, (_, i) => (
        <button key={i + 1} className={page === i + 1 ? "active" : ""} onClick={() => setPage(i + 1)}>{i + 1}</button>
      ))}
      <button onClick={() => setPage(p => Math.min(total, p + 1))} disabled={page === total}>›</button>
    </div>
  );
}

function exportCSV(data, filename) {
  if (!data.length) return;
  const headers = Object.keys(data[0]).join(",");
  const rows = data.map(r => Object.values(r).map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(","));
  const csv = [headers, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Dashboard ─────────────────────────────────────────────────────────────
function Dashboard({ token }) {
  const [stats, setStats] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const charger = () => {
    axios.get("/api/admin/dashboard", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setStats(r.data.stats); setLastUpdate(new Date()); })
      .catch(() => {});
  };

  useEffect(() => {
    charger();
    // Actualisation automatique toutes les 30 secondes
    const interval = setInterval(charger, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return <div className="loading">Chargement...</div>;

  return (
    <div className="tab-content">
      <h2 className="section-title">
        <><LayoutDashboard size={22} /> Tableau de bord</>
        {lastUpdate && (
          <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "normal", marginLeft: "12px" }}>
            <><RefreshCw size={12} /> Mis à jour à {lastUpdate.toLocaleTimeString("fr-FR")} (auto 30s)</>
          </span>
        )}
      </h2>
      <div className="stats-grid">
        {[
          { icon: <Package size={24} />, value: stats.totalForfaits,    label: "Total Forfaits",       color: "blue"   },
          { icon: <Check size={24} />, value: stats.forfaitsActifs,   label: "Forfaits Actifs",      color: "green"  },
          { icon: <Ticket size={24} />, value: stats.totalTickets,     label: "Total Tickets",        color: "purple" },
          { icon: <Ticket size={24} />, value: stats.ticketsDispos,    label: "Tickets Disponibles",  color: "teal"   },
          { icon: <Wifi size={24} />, value: `${stats.hotspotsActifs}/${stats.totalHotspots}`, label: "Hotspots Actifs", color: "orange" },
          { icon: <Users size={24} />, value: stats.clientsConnectes, label: "Clients Connectés",    color: "red"    },
          { icon: <Home size={24} />, value: `${stats.domicilesActifs}/${stats.totalDomiciles}`, label: "Domiciles Actifs", color: "dark" },
          { icon: <DollarSign size={24} />, value: `${stats.recetteAujourdhui.toLocaleString()} F`, label: "Recette Aujourd'hui", color: "yellow" },
          { icon: <BarChart3 size={24} />, value: `${stats.recetteTotal.toLocaleString()} F`,      label: "Recette Totale",      color: "blue"   },
        ].map((c, i) => (
          <div key={i} className={`stat-card ${c.color}`}>
            <div className="stat-icon">{c.icon}</div>
            <div className="stat-info">
              <div className="stat-value">{c.value}</div>
              <div className="stat-label">{c.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Forfaits (avec durée + profil Mikrotik) ──────────────────────────────
function Forfaits({ token }) {
  const [forfaits, setForfaits] = useState([]);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [form, setForm] = useState({ nom: "", prix: "", quota: "", debit: "10 Mbps", duree: "", profilMikrotik: "", statut: "actif", gratuit: false, appareilUnique: false });
  const [loading, setLoading] = useState(false);
  const debits = ["1 Mbps","2 Mbps","5 Mbps","10 Mbps","20 Mbps","50 Mbps","100 Mbps","Illimité"];
  const durees = ["30 minutes","1 heure","2 heures","3 heures","6 heures","12 heures","24 heures","3 jours","7 jours","30 jours","Illimité"];
  const showMsg = (text, type = "success") => { setMsg({ text, type }); setTimeout(() => setMsg({ text: "", type: "" }), 3000); };
  const charger = () => axios.get("/api/admin/forfaits", { headers: { Authorization: `Bearer ${token}` } }).then(r => setForfaits(r.data.forfaits)).catch(() => {});
  useEffect(() => { charger(); }, []);

  const handleCreer = async (e) => {
    e.preventDefault();
    if (!form.nom.trim() || !form.prix) { showMsg("Nom et prix requis.", "error"); return; }
    setLoading(true);
    try {
      await axios.post("/api/admin/forfaits", form, { headers: { Authorization: `Bearer ${token}` } });
      showMsg(`Forfait "${form.nom}" créé !`);
      setForm({ nom: "", prix: "", quota: "", debit: "10 Mbps", duree: "", profilMikrotik: "", statut: "actif", gratuit: false, appareilUnique: false });
      charger();
    } catch (err) { showMsg(err.response?.data?.message || "Erreur.", "error"); }
    finally { setLoading(false); }
  };

  const handleToggle = async (id) => {
    try { const r = await axios.patch(`/api/admin/forfaits/${id}/toggle`, {}, { headers: { Authorization: `Bearer ${token}` } }); showMsg(r.data.message); charger(); }
    catch { showMsg("Erreur.", "error"); }
  };

  const handleSupprimer = async (id, nom) => {
    if (!window.confirm(`Supprimer "${nom}" ?`)) return;
    try { await axios.delete(`/api/admin/forfaits/${id}`, { headers: { Authorization: `Bearer ${token}` } }); showMsg(`"${nom}" supprimé.`); charger(); }
    catch { showMsg("Erreur.", "error"); }
  };

  const [editForfait, setEditForfait] = useState(null);
  const [editForm, setEditForm] = useState({});

  const handleModifier = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.put(`/api/admin/forfaits/${editForfait.id}`, editForm, { headers: { Authorization: `Bearer ${token}` } });
      showMsg(`Forfait "${editForm.nom}" mis à jour !`);
      setEditForfait(null);
      charger();
    } catch (err) { showMsg(err.response?.data?.message || "Erreur.", "error"); }
    finally { setLoading(false); }
  };

  return (
    <div className="tab-content">
      <h2 className="section-title"><><Package size={20} /> Gestion des Forfaits</></h2>
      {msg.text && <div className={`feedback ${msg.type}`}>{msg.text}</div>}
      <div className="admin-section">
        <h3><><Plus size={16} /> Créer un forfait</></h3>
        <form onSubmit={handleCreer}>
          <div className="form-row">
            <div className="form-group"><label>Nom du profil</label><input type="text" placeholder="Ex: Forfait 1H" value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} /></div>
            <div className="form-group"><label>Prix (FCFA)</label><input type="number" placeholder="Ex: 500" value={form.prix} onChange={e => setForm({ ...form, prix: e.target.value })} /></div>
            <div className="form-group"><label>Quota</label><input type="text" placeholder="Ex: 500 Mo" value={form.quota} onChange={e => setForm({ ...form, quota: e.target.value })} /></div>
            <div className="form-group"><label>Débit max</label><select value={form.debit} onChange={e => setForm({ ...form, debit: e.target.value })}>{debits.map(d => <option key={d}>{d}</option>)}</select></div>
            <div className="form-group"><label>Durée</label><select value={form.duree} onChange={e => setForm({ ...form, duree: e.target.value })}><option value="">-- Choisir --</option>{durees.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
            <div className="form-group"><label>Profil Mikrotik</label><input type="text" placeholder="Ex: profil-1h" value={form.profilMikrotik} onChange={e => setForm({ ...form, profilMikrotik: e.target.value })} /></div>
            <div className="form-group"><label>Statut</label><select value={form.statut} onChange={e => setForm({ ...form, statut: e.target.value })}><option value="actif">Actif</option><option value="inactif">Inactif</option></select></div>
            <div className="form-group-check"><input type="checkbox" id="gratuit" checked={form.gratuit || false} onChange={e => setForm({ ...form, gratuit: e.target.checked })} /><label htmlFor="gratuit">Forfait gratuit</label></div>
            <div className="form-group-check"><input type="checkbox" id="appareilUnique" checked={form.appareilUnique || false} onChange={e => setForm({ ...form, appareilUnique: e.target.checked })} /><label htmlFor="appareilUnique">1 appareil max</label></div>
            <div className="form-group form-btn"><button type="submit" disabled={loading}>{loading ? "..." : "Créer"}</button></div>
          </div>
        </form>
      </div>
      <div className="admin-section">
        <h3><><List size={16} /> Liste des forfaits ({forfaits.length})</></h3>
        <div className="table-wrapper"><table>
          <thead><tr><th>Nom</th><th>Prix</th><th>Quota</th><th>Débit</th><th>Durée</th><th>Profil Mikrotik</th><th>Statut</th><th>Options</th><th>Actions</th></tr></thead>
          <tbody>{forfaits.length === 0 ? <tr><td colSpan="9" className="empty-msg">Aucun forfait.</td></tr> : forfaits.map(f => (
            <tr key={f.id}>
              <td><strong>{f.nom}</strong></td>
              <td><span className="badge blue">{f.prix.toLocaleString()} FCFA</span></td>
              <td>{f.quota || "—"}</td>
              <td>{f.debit}</td>
              <td>{f.duree || "—"}</td>
              <td><span className="code-cell" style={{ fontSize: "12px" }}>{f.profilMikrotik || "—"}</span></td>
              <td><span className={`badge ${f.statut === "actif" ? "actif" : "inactif"}`}>{f.statut === "actif" ? "Actif" : "Inactif"}</span></td>
              <td>{f.gratuit && <span className="badge green">Gratuit</span>} {f.appareilUnique && <span className="badge orange">1 App.</span>}</td>
              <td className="actions-cell">
                <button className="btn-edit" onClick={() => { setEditForfait(f); setEditForm({ nom: f.nom, prix: f.prix, quota: f.quota, debit: f.debit, duree: f.duree, profilMikrotik: f.profilMikrotik, statut: f.statut, gratuit: f.gratuit || false, appareilUnique: f.appareilUnique || false }); }}>Modifier</button>
                <button className={`btn-toggle ${f.statut === "actif" ? "desactiver" : "activer"}`} onClick={() => handleToggle(f.id)}>{f.statut === "actif" ? "Désactiver" : "Activer"}</button>
                <button className="btn-supprimer" onClick={() => handleSupprimer(f.id, f.nom)}>Supprimer</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      {editForfait && (
        <div className="modal-overlay" onClick={() => setEditForfait(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>Modifier "{editForfait.nom}"</h3>
            <form onSubmit={handleModifier}>
              <div className="form-row">
                <div className="form-group"><label>Nom</label><input type="text" value={editForm.nom || ""} onChange={e => setEditForm({ ...editForm, nom: e.target.value })} /></div>
                <div className="form-group"><label>Prix (FCFA)</label><input type="number" value={editForm.prix || ""} onChange={e => setEditForm({ ...editForm, prix: e.target.value })} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Quota</label><input type="text" value={editForm.quota || ""} onChange={e => setEditForm({ ...editForm, quota: e.target.value })} /></div>
                <div className="form-group"><label>Débit</label><select value={editForm.debit || "10 Mbps"} onChange={e => setEditForm({ ...editForm, debit: e.target.value })}>{debits.map(d => <option key={d}>{d}</option>)}</select></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Durée</label><select value={editForm.duree || ""} onChange={e => setEditForm({ ...editForm, duree: e.target.value })}>{durees.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
                <div className="form-group"><label>Profil Mikrotik</label><input type="text" value={editForm.profilMikrotik || ""} onChange={e => setEditForm({ ...editForm, profilMikrotik: e.target.value })} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Statut</label><select value={editForm.statut || "actif"} onChange={e => setEditForm({ ...editForm, statut: e.target.value })}><option value="actif">Actif</option><option value="inactif">Inactif</option></select></div>
                <div className="form-group-check"><input type="checkbox" id="edit-gratuit" checked={editForm.gratuit || false} onChange={e => setEditForm({ ...editForm, gratuit: e.target.checked })} /><label htmlFor="edit-gratuit">Forfait gratuit</label></div>
                <div className="form-group-check"><input type="checkbox" id="edit-appareil" checked={editForm.appareilUnique || false} onChange={e => setEditForm({ ...editForm, appareilUnique: e.target.checked })} /><label htmlFor="edit-appareil">1 appareil max</label></div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setEditForfait(null)}>Annuler</button>
                <button type="submit" className="btn-save" disabled={loading}>{loading ? "..." : "Sauvegarder"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tickets (anciennement Vouchers) ──────────────────────────────────────
function Tickets({ token }) {
  const [tickets, setTickets] = useState([]);
  const [forfaits, setForfaits] = useState([]);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [form, setForm] = useState({ forfaitId: "", quantite: "1" });
  const [loading, setLoading] = useState(false);
  const [filtre, setFiltre] = useState("tous");
  const showMsg = (text, type = "success") => { setMsg({ text, type }); setTimeout(() => setMsg({ text: "", type: "" }), 3000); };
  const charger = () => {
    axios.get("/api/admin/tickets", { headers: { Authorization: `Bearer ${token}` } }).then(r => setTickets(r.data.tickets)).catch(() => {});
    axios.get("/api/admin/forfaits", { headers: { Authorization: `Bearer ${token}` } }).then(r => setForfaits(r.data.forfaits.filter(f => f.statut === "actif"))).catch(() => {});
  };
  useEffect(() => { charger(); }, []);

  const handleGenerer = async (e) => {
    e.preventDefault();
    if (!form.forfaitId) { showMsg("Sélectionnez un forfait.", "error"); return; }
    setLoading(true);
    try { const r = await axios.post("/api/admin/tickets", form, { headers: { Authorization: `Bearer ${token}` } }); showMsg(r.data.message); charger(); }
    catch (err) { showMsg(err.response?.data?.message || "Erreur.", "error"); }
    finally { setLoading(false); }
  };

  const handleSupprimer = async (id) => {
    if (!window.confirm("Supprimer ce ticket ?")) return;
    try { await axios.delete(`/api/admin/tickets/${id}`, { headers: { Authorization: `Bearer ${token}` } }); showMsg("Ticket supprimé."); charger(); }
    catch { showMsg("Erreur.", "error"); }
  };

  const filtresData = tickets.filter(t => filtre === "tous" ? true : t.statut === filtre);

  return (
    <div className="tab-content">
      <h2 className="section-title"><><Ticket size={20} /> Gestion des Tickets</></h2>
      {msg.text && <div className={`feedback ${msg.type}`}>{msg.text}</div>}
      <div className="admin-section">
        <h3><><Plus size={16} /> Générer des tickets</></h3>
        <form onSubmit={handleGenerer}>
          <div className="form-row">
            <div className="form-group"><label>Forfait</label>
              <select value={form.forfaitId} onChange={e => setForm({ ...form, forfaitId: e.target.value })}>
                <option value="">-- Choisir un forfait --</option>
                {forfaits.map(f => <option key={f.id} value={f.id}>{f.nom} — {f.prix.toLocaleString()} FCFA</option>)}
              </select>
            </div>
            <div className="form-group"><label>Quantité (max 50)</label><input type="number" min="1" max="50" value={form.quantite} onChange={e => setForm({ ...form, quantite: e.target.value })} /></div>
            <div className="form-group form-btn"><button type="submit" disabled={loading}>{loading ? "..." : "Générer"}</button></div>
          </div>
        </form>
      </div>
      <div className="admin-section">
        <div className="section-header">
          <h3><><List size={16} /> Liste des tickets ({tickets.length})</></h3>
          <div className="filtres">
            {["tous","disponible","utilise","expire"].map(f => (
              <button key={f} className={`filtre-btn ${filtre === f ? "actif" : ""}`} onClick={() => setFiltre(f)}>
                {f === "tous" ? "Tous" : f === "disponible" ? "Disponibles" : f === "expire" ? "Expirés" : "Utilisés"}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrapper"><table>
          <thead><tr><th>Code</th><th>Forfait</th><th>Prix</th><th>Statut</th><th>Créé le</th><th>Actions</th></tr></thead>
          <tbody>{filtresData.length === 0 ? <tr><td colSpan="6" className="empty-msg">Aucun ticket.</td></tr> : filtresData.map(t => (
            <tr key={t.id}>
              <td className="code-cell">{t.code}</td>
              <td>{t.forfaitNom}</td>
              <td><span className="badge blue">{t.prix.toLocaleString()} FCFA</span></td>
              <td><span className={`badge ${t.statut === "disponible" ? "actif" : "orange"}`}>{t.statut === "disponible" ? "Disponible" : "Utilisé"}</span></td>
              <td>{t.dateCreation ? new Date(t.dateCreation).toLocaleDateString("fr-FR") : "—"}</td>
              <td className="actions-cell"><button className="btn-supprimer" onClick={() => handleSupprimer(t.id)}>Supprimer</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}

// ─── Domicile (nano station) ───────────────────────────────────────────────
function Domicile({ token }) {
  const [domiciles, setDomiciles] = useState([]);
  const [forfaits, setForfaits] = useState([]);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [form, setForm] = useState({ nom: "", telephone: "", mac: "", forfaitId: "", dateExpiration: "" });
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [loading, setLoading] = useState(false);

  const showMsg = (text, type = "success") => { setMsg({ text, type }); setTimeout(() => setMsg({ text: "", type: "" }), 3000); };

  const charger = () => {
    axios.get("/api/admin/domiciles", { headers: { Authorization: `Bearer ${token}` } }).then(r => setDomiciles(r.data.domiciles)).catch(() => {});
    axios.get("/api/admin/forfaits", { headers: { Authorization: `Bearer ${token}` } }).then(r => setForfaits(r.data.forfaits.filter(f => f.statut === "actif"))).catch(() => {});
  };
  useEffect(() => { charger(); }, []);

  const handleAjouter = async (e) => {
    e.preventDefault();
    if (!form.nom || !form.telephone || !form.mac || !form.forfaitId || !form.dateExpiration) {
      showMsg("Tous les champs sont requis.", "error"); return;
    }
    setLoading(true);
    try {
      await axios.post("/api/admin/domiciles", form, { headers: { Authorization: `Bearer ${token}` } });
      showMsg(`Domicile "${form.nom}" enregistré !`);
      setForm({ nom: "", telephone: "", mac: "", forfaitId: "", dateExpiration: "" });
      charger();
    } catch (err) { showMsg(err.response?.data?.message || "Erreur.", "error"); }
    finally { setLoading(false); }
  };

  const handleModifier = async (id) => {
    try {
      await axios.patch(`/api/admin/domiciles/${id}`, editForm, { headers: { Authorization: `Bearer ${token}` } });
      showMsg("Domicile mis à jour !");
      setEditId(null);
      charger();
    } catch (err) { showMsg(err.response?.data?.message || "Erreur.", "error"); }
  };

  const handleSupprimer = async (id, nom) => {
    if (!window.confirm(`Supprimer le domicile "${nom}" ?`)) return;
    try { await axios.delete(`/api/admin/domiciles/${id}`, { headers: { Authorization: `Bearer ${token}` } }); showMsg(`"${nom}" supprimé.`); charger(); }
    catch { showMsg("Erreur.", "error"); }
  };

  const isExpire = (date) => date && new Date(date) < new Date();
  const joursRestants = (date) => {
    if (!date) return null;
    const diff = Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  return (
    <div className="tab-content">
      <h2 className="section-title"><><Home size={20} /> Connexions Domicile (Nano Station)</></h2>
      {msg.text && <div className={`feedback ${msg.type}`}>{msg.text}</div>}

      {/* Formulaire d'ajout */}
      <div className="admin-section">
        <h3><><Plus size={16} /> Enregistrer une connexion domicile</></h3>
        <form onSubmit={handleAjouter}>
          <div className="form-row">
            <div className="form-group"><label>Nom du client</label><input type="text" placeholder="Ex: Jean Dupont" value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} /></div>
            <div className="form-group"><label>Numéro de téléphone</label><input type="tel" placeholder="Ex: +225 07 00 00 00" value={form.telephone} onChange={e => setForm({ ...form, telephone: e.target.value })} /></div>
            <div className="form-group"><label>Adresse MAC</label><input type="text" placeholder="Ex: AA:BB:CC:DD:EE:FF" value={form.mac} onChange={e => setForm({ ...form, mac: e.target.value })} /></div>
          </div>
          <div className="form-row" style={{ marginTop: "12px" }}>
            <div className="form-group"><label>Forfait</label>
              <select value={form.forfaitId} onChange={e => setForm({ ...form, forfaitId: e.target.value })}>
                <option value="">-- Choisir un forfait --</option>
                {forfaits.map(f => <option key={f.id} value={f.id}>{f.nom} — {f.prix.toLocaleString()} FCFA</option>)}
              </select>
            </div>
            <div className="form-group"><label>Date d'expiration</label><input type="date" value={form.dateExpiration} onChange={e => setForm({ ...form, dateExpiration: e.target.value })} /></div>
            <div className="form-group form-btn"><button type="submit" disabled={loading}>{loading ? "..." : "Enregistrer"}</button></div>
          </div>
        </form>
      </div>

      {/* Tableau des domiciles */}
      <div className="admin-section">
        <h3><><List size={16} /> Liste des connexions domicile ({domiciles.length})</></h3>
        <div className="table-wrapper"><table>
          <thead>
            <tr><th>Nom</th><th>Téléphone</th><th>Adresse MAC</th><th>Forfait</th><th>Expiration</th><th>Statut</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {domiciles.length === 0 ? (
              <tr><td colSpan="7" className="empty-msg">Aucune connexion domicile.</td></tr>
            ) : domiciles.map(d => (
              <tr key={d.id}>
                {editId === d.id ? (
                  <>
                    <td><input type="text" value={editForm.nom || ""} onChange={e => setEditForm({ ...editForm, nom: e.target.value })} style={{ width: "100%", padding: "6px", borderRadius: "6px", border: "1px solid #cbd5e1" }} /></td>
                    <td><input type="tel" value={editForm.telephone || ""} onChange={e => setEditForm({ ...editForm, telephone: e.target.value })} style={{ width: "100%", padding: "6px", borderRadius: "6px", border: "1px solid #cbd5e1" }} /></td>
                    <td className="code-cell">{d.mac}</td>
                    <td>
                      <select value={editForm.forfaitId || d.forfaitId} onChange={e => setEditForm({ ...editForm, forfaitId: e.target.value })} style={{ padding: "6px", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
                        {forfaits.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
                      </select>
                    </td>
                    <td><input type="date" value={editForm.dateExpiration || d.dateExpiration} onChange={e => setEditForm({ ...editForm, dateExpiration: e.target.value })} style={{ padding: "6px", borderRadius: "6px", border: "1px solid #cbd5e1" }} /></td>
                    <td>—</td>
                    <td className="actions-cell">
                      <button className="btn-toggle activer" onClick={() => handleModifier(d.id)}><><Save size={14} /> Sauver</></button>
                      <button className="btn-toggle desactiver" onClick={() => setEditId(null)}>Annuler</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td><strong>{d.nom}</strong></td>
                    <td>{d.telephone}</td>
                    <td className="code-cell">{d.mac}</td>
                    <td><span className="badge blue">{d.forfaitNom}</span></td>
                    <td>
                      {d.dateExpiration ? (
                        <div>
                          <span className={`badge ${isExpire(d.dateExpiration) ? "inactif" : joursRestants(d.dateExpiration) <= 3 ? "orange" : "green"}`}>
                            {new Date(d.dateExpiration).toLocaleDateString("fr-FR")}
                          </span>
                          {!isExpire(d.dateExpiration) && (
                            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                              {joursRestants(d.dateExpiration)} jour{joursRestants(d.dateExpiration) > 1 ? "s" : ""} restant{joursRestants(d.dateExpiration) > 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                      ) : "—"}
                    </td>
                    <td>
                      <span className={`badge ${d.statut === "actif" ? "actif" : "inactif"}`}>
                        {d.statut === "actif" ? "Actif" : "Expiré"}
                      </span>
                    </td>
                    <td className="actions-cell">
                      <button className="btn-toggle activer" onClick={() => { setEditId(d.id); setEditForm({ nom: d.nom, telephone: d.telephone, forfaitId: d.forfaitId, dateExpiration: d.dateExpiration }); }}><><Edit3 size={14} /> Modifier</></button>
                      <button className="btn-supprimer" onClick={() => handleSupprimer(d.id, d.nom)}>Supprimer</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// ─── Compte Privilégié ─────────────────────────────────────────────────────
function ComptePrivilegie({ token }) {
  const [comptes, setComptes] = useState([]);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [form, setForm] = useState({ nom: "", telephone: "", mac: "", debit: "Illimité", commentaire: "" });
  const [loading, setLoading] = useState(false);

  const debits = ["1 Mbps","2 Mbps","5 Mbps","10 Mbps","20 Mbps","50 Mbps","100 Mbps","Illimité"];

  const showMsg = (text, type = "success") => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "", type: "" }), 4000);
  };

  const charger = () =>
    axios.get("/api/admin/comptes-privilegies", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setComptes(r.data.comptes))
      .catch(() => {});

  useEffect(() => { charger(); }, []);

  const handleAjouter = async (e) => {
    e.preventDefault();
    if (!form.nom.trim() || !form.mac.trim()) {
      showMsg("Nom et adresse MAC requis.", "error"); return;
    }
    // Validation format MAC
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    if (!macRegex.test(form.mac.trim())) {
      showMsg("Format MAC invalide. Ex: AA:BB:CC:DD:EE:FF", "error"); return;
    }
    setLoading(true);
    try {
      await axios.post("/api/admin/comptes-privilegies", form, { headers: { Authorization: `Bearer ${token}` } });
      showMsg(`Compte privilégié "${form.nom}" ajouté ! Accès internet sans portail captif activé.`);
      setForm({ nom: "", telephone: "", mac: "", debit: "Illimité", commentaire: "" });
      charger();
    } catch (err) {
      showMsg(err.response?.data?.message || "Erreur.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (id) => {
    try {
      const r = await axios.patch(`/api/admin/comptes-privilegies/${id}/toggle`, {}, { headers: { Authorization: `Bearer ${token}` } });
      showMsg(r.data.message);
      charger();
    } catch { showMsg("Erreur.", "error"); }
  };

  const handleSupprimer = async (id, nom) => {
    if (!window.confirm(`Supprimer le compte privilégié "${nom}" ?\nCet appareil devra repasser par le portail captif.`)) return;
    try {
      await axios.delete(`/api/admin/comptes-privilegies/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      showMsg(`"${nom}" supprimé. Accès portail captif rétabli.`);
      charger();
    } catch { showMsg("Erreur.", "error"); }
  };

  return (
    <div className="tab-content">
      <h2 className="section-title"><><Star size={20} /> Comptes Privilégiés</></h2>

      {/* Bandeau d'information */}
      <div style={{
        background: "linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%)",
        color: "#fff",
        borderRadius: "12px",
        padding: "16px 20px",
        marginBottom: "20px",
        display: "flex",
        alignItems: "flex-start",
        gap: "14px",
        boxShadow: "0 4px 12px rgba(37,99,235,0.25)"
      }}>
        <span style={{ fontSize: "28px", lineHeight: 1 }}><Unlock size={28} color="white" /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "4px" }}>
            Accès Internet sans portail captif
          </div>
          <div style={{ fontSize: "13px", opacity: 0.9, lineHeight: 1.5 }}>
            Les appareils enregistrés ici accèdent directement à Internet <strong>sans avoir à saisir un code ticket</strong>.
            L'adresse MAC de l'appareil est ajoutée à la liste blanche du routeur Mikrotik (bypass hotspot).
            Idéal pour les employés, partenaires ou équipements de confiance.
          </div>
        </div>
      </div>

      {msg.text && <div className={`feedback ${msg.type}`}>{msg.text}</div>}

      {/* Formulaire d'ajout */}
      <div className="admin-section">
        <h3><><Plus size={16} /> Ajouter un compte privilégié</></h3>
        <form onSubmit={handleAjouter}>
          <div className="form-row">
            <div className="form-group">
              <label>Nom / Identifiant</label>
              <input type="text" placeholder="Ex: Jean Dupont" value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Téléphone (optionnel)</label>
              <input type="tel" placeholder="Ex: +225 07 00 00 00" value={form.telephone} onChange={e => setForm({ ...form, telephone: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Adresse MAC de l'appareil</label>
              <input
                type="text"
                placeholder="Ex: AA:BB:CC:DD:EE:FF"
                value={form.mac}
                onChange={e => setForm({ ...form, mac: e.target.value })}
                style={{ fontFamily: "monospace" }}
              />
            </div>
            <div className="form-group">
              <label>Débit autorisé</label>
              <select value={form.debit} onChange={e => setForm({ ...form, debit: e.target.value })}>
                {debits.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Commentaire (optionnel)</label>
              <input type="text" placeholder="Ex: Employé, Partenaire..." value={form.commentaire} onChange={e => setForm({ ...form, commentaire: e.target.value })} />
            </div>
            <div className="form-group form-btn">
              <button type="submit" disabled={loading}>{loading ? "..." : "Ajouter"}</button>
            </div>
          </div>
        </form>
      </div>

      {/* Tableau des comptes */}
      <div className="admin-section">
        <h3><><List size={16} /> Liste des comptes privilégiés ({comptes.length})</></h3>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Téléphone</th>
                <th>Adresse MAC</th>
                <th>Débit</th>
                <th>Commentaire</th>
                <th>Statut</th>
                <th>Ajouté le</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {comptes.length === 0 ? (
                <tr><td colSpan="8" className="empty-msg">Aucun compte privilégié. Ajoutez des appareils pour leur permettre d'accéder à Internet sans portail captif.</td></tr>
              ) : comptes.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.nom}</strong></td>
                  <td>{c.telephone || "—"}</td>
                  <td className="code-cell" style={{ fontFamily: "monospace", fontSize: "13px" }}>{c.mac}</td>
                  <td>
                    <span className="badge blue">{c.debit}</span>
                  </td>
                  <td style={{ fontSize: "13px", color: "#64748b" }}>{c.commentaire || "—"}</td>
                  <td>
                    <span className={`badge ${c.statut === "actif" ? "actif" : "inactif"}`}>
                      {c.statut === "actif" ? "Actif (bypass)" : "Suspendu"}
                    </span>
                  </td>
                  <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                    {c.dateCreation ? new Date(c.dateCreation).toLocaleDateString("fr-FR") : "—"}
                  </td>
                  <td className="actions-cell">
                    <button
                      className={`btn-toggle ${c.statut === "actif" ? "desactiver" : "activer"}`}
                      onClick={() => handleToggle(c.id)}
                    >
                      {c.statut === "actif" ? "Suspendre" : "Réactiver"}
                    </button>
                    <button className="btn-supprimer" onClick={() => handleSupprimer(c.id, c.nom)}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section info technique */}
      <div className="admin-section" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
        <h3 style={{ color: "#475569" }}><><Info size={16} /> Comment ça fonctionne ?</></h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px", marginTop: "10px" }}>
          {[
            { icon: "1", titre: "Enregistrement MAC", desc: "L'adresse MAC de l'appareil est enregistrée dans la base de données du portail." },
            { icon: "2", titre: "Bypass Mikrotik", desc: "La MAC est ajoutée à la liste blanche du hotspot Mikrotik via l'API RouterOS." },
            { icon: "3", titre: "Accès direct", desc: "L'appareil se connecte au Wi-Fi et accède à Internet sans page de connexion." },
            { icon: "4", titre: "Contrôle admin", desc: "L'admin peut suspendre ou supprimer l'accès à tout moment depuis cette page." },
          ].map((s, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: "10px", padding: "14px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "22px", marginBottom: "6px" }}>{s.icon}</div>
              <div style={{ fontWeight: 600, fontSize: "13px", color: "#1e293b", marginBottom: "4px" }}>{s.titre}</div>
              <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.5 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Clients connectés ─────────────────────────────────────────────────────
function Clients({ token }) {
  const [clients, setClients] = useState([]);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const showMsg = (text, type = "success") => { setMsg({ text, type }); setTimeout(() => setMsg({ text: "", type: "" }), 3000); };
  const charger = () => axios.get("/api/admin/clients", { headers: { Authorization: `Bearer ${token}` } }).then(r => setClients(r.data.clients)).catch(() => {});
  useEffect(() => { charger(); const t = setInterval(charger, 10000); return () => clearInterval(t); }, []);
  const handleDeconnecter = async (id, ip) => {
    if (!window.confirm(`Déconnecter le client ${ip} ?`)) return;
    try { await axios.delete(`/api/admin/clients/${id}`, { headers: { Authorization: `Bearer ${token}` } }); showMsg(`Client ${ip} déconnecté.`); charger(); }
    catch { showMsg("Erreur.", "error"); }
  };
  const duree = (debut) => {
    const diff = Math.floor((Date.now() - new Date(debut)) / 1000);
    const h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  };
  return (
    <div className="tab-content">
      <h2 className="section-title"><><Users size={20} /> Clients Connectés</></h2>
      {msg.text && <div className={`feedback ${msg.type}`}>{msg.text}</div>}
      <div className="admin-section">
        <div className="section-header">
          <h3><><CircleDot size={16} /> Clients en ligne ({clients.filter(c => c.statut === "connecte").length})</></h3>
          <button className="filtre-btn actif" onClick={charger}><><RefreshCw size={14} /> Actualiser</></button>
        </div>
        <div className="table-wrapper"><table>
          <thead><tr><th>IP</th><th>MAC</th><th>Forfait</th><th>Hotspot</th><th>Connecté depuis</th><th>Quota consommé</th><th>Débit</th><th>Actions</th></tr></thead>
          <tbody>{clients.length === 0 ? <tr><td colSpan="8" className="empty-msg">Aucun client connecté.</td></tr> : clients.map(c => (
            <tr key={c.id}>
              <td className="code-cell">{c.ip}</td>
              <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{c.mac}</td>
              <td><span className="badge blue">{c.forfait}</span></td>
              <td>{c.hotspot}</td>
              <td><span className="badge green">{duree(c.debut)}</span></td>
              <td>{c.quotaConsomme}</td>
              <td>{c.debit}</td>
              <td className="actions-cell"><button className="btn-supprimer" onClick={() => handleDeconnecter(c.id, c.ip)}>Déconnecter</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}

// ─── Blacklist ─────────────────────────────────────────────────────────────
function Blacklist({ token }) {
  const [blacklist, setBlacklist] = useState([]);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [form, setForm] = useState({ type: "ip", valeur: "", raison: "" });
  const [loading, setLoading] = useState(false);
  const showMsg = (text, type = "success") => { setMsg({ text, type }); setTimeout(() => setMsg({ text: "", type: "" }), 3000); };
  const charger = () => axios.get("/api/admin/blacklist", { headers: { Authorization: `Bearer ${token}` } }).then(r => setBlacklist(r.data.blacklist)).catch(() => {});
  useEffect(() => { charger(); }, []);
  const handleAjouter = async (e) => {
    e.preventDefault();
    if (!form.valeur.trim()) { showMsg("Valeur requise.", "error"); return; }
    setLoading(true);
    try { await axios.post("/api/admin/blacklist", form, { headers: { Authorization: `Bearer ${token}` } }); showMsg(`${form.valeur} bloqué !`); setForm({ type: "ip", valeur: "", raison: "" }); charger(); }
    catch (err) { showMsg(err.response?.data?.message || "Erreur.", "error"); }
    finally { setLoading(false); }
  };
  const handleRetirer = async (id, val) => { if (!window.confirm(`Retirer "${val}" ?`)) return; try { await axios.delete(`/api/admin/blacklist/${id}`, { headers: { Authorization: `Bearer ${token}` } }); showMsg(`"${val}" retiré.`); charger(); } catch { showMsg("Erreur.", "error"); } };
  return (
    <div className="tab-content">
      <h2 className="section-title"><><ShieldBan size={20} /> Blacklist</></h2>
      {msg.text && <div className={`feedback ${msg.type}`}>{msg.text}</div>}
      <div className="admin-section">
        <h3><><Plus size={16} /> Bloquer une IP ou MAC</></h3>
        <form onSubmit={handleAjouter}>
          <div className="form-row">
            <div className="form-group"><label>Type</label><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="ip">Adresse IP</option><option value="mac">Adresse MAC</option></select></div>
            <div className="form-group"><label>Valeur</label><input type="text" placeholder={form.type === "ip" ? "Ex: 192.168.1.50" : "Ex: AA:BB:CC:DD:EE:FF"} value={form.valeur} onChange={e => setForm({ ...form, valeur: e.target.value })} /></div>
            <div className="form-group"><label>Raison</label><input type="text" placeholder="Ex: Abus" value={form.raison} onChange={e => setForm({ ...form, raison: e.target.value })} /></div>
            <div className="form-group form-btn"><button type="submit" disabled={loading}>{loading ? "..." : "Bloquer"}</button></div>
          </div>
        </form>
      </div>
      <div className="admin-section">
        <h3><><List size={16} /> Liste noire ({blacklist.length})</></h3>
        <div className="table-wrapper"><table>
          <thead><tr><th>Type</th><th>Valeur</th><th>Raison</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody>{blacklist.length === 0 ? <tr><td colSpan="5" className="empty-msg">Blacklist vide.</td></tr> : blacklist.map(b => (
            <tr key={b.id}>
              <td><span className={`badge ${b.type === "ip" ? "blue" : "orange"}`}>{b.type.toUpperCase()}</span></td>
              <td className="code-cell">{b.valeur}</td>
              <td>{b.raison || "—"}</td>
              <td>{b.dateAjout ? new Date(b.dateAjout).toLocaleDateString("fr-FR") : "—"}</td>
              <td className="actions-cell"><button className="btn-toggle activer" onClick={() => handleRetirer(b.id, b.valeur)}>Retirer</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}

// ─── Logs ──────────────────────────────────────────────────────────────────
function Logs({ token }) {
  const [logs, setLogs] = useState([]);
  const [filtre, setFiltre] = useState("tous");
  const [msg, setMsg] = useState({ text: "", type: "" });
  const showMsg = (text, type = "success") => { setMsg({ text, type }); setTimeout(() => setMsg({ text: "", type: "" }), 3000); };
  const charger = (type) => {
    const url = type && type !== "tous" ? `/api/admin/logs?type=${type}` : "/api/admin/logs";
    axios.get(url, { headers: { Authorization: `Bearer ${token}` } }).then(r => setLogs(r.data.logs)).catch(() => {});
  };
  useEffect(() => { charger(filtre); }, [filtre]);
  const handleEffacer = async () => {
    if (!window.confirm("Effacer tous les journaux ?")) return;
    try { await axios.delete("/api/admin/logs", { headers: { Authorization: `Bearer ${token}` } }); showMsg("Journaux effacés."); setLogs([]); }
    catch { showMsg("Erreur.", "error"); }
  };
  const typeColors = { connexion: "green", admin: "blue", forfait: "purple", hotspot: "teal", ticket: "orange", blacklist: "red", client: "yellow", domicile: "dark" };
  const types = ["tous","connexion","admin","forfait","hotspot","ticket","blacklist","client","domicile"];
  return (
    <div className="tab-content">
      <h2 className="section-title"><><ScrollText size={20} /> Journaux d'activité</></h2>
      {msg.text && <div className={`feedback ${msg.type}`}>{msg.text}</div>}
      <div className="admin-section">
        <div className="section-header">
          <h3><><ScrollText size={16} /> Logs ({logs.length})</></h3>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <div className="filtres">{types.map(t => <button key={t} className={`filtre-btn ${filtre === t ? "actif" : ""}`} onClick={() => setFiltre(t)}>{t === "tous" ? "Tous" : t}</button>)}</div>
            <button className="btn-supprimer" onClick={handleEffacer}><><Trash2 size={14} /> Effacer</></button>
          </div>
        </div>
        <div className="table-wrapper"><table>
          <thead><tr><th>#</th><th>Type</th><th>Message</th><th>Date/Heure</th></tr></thead>
          <tbody>{logs.length === 0 ? <tr><td colSpan="4" className="empty-msg">Aucun journal.</td></tr> : logs.map(l => (
            <tr key={l.id}>
              <td>{l.id}</td>
              <td><span className={`badge ${typeColors[l.type] || "blue"}`}>{l.type}</span></td>
              <td>{l.message}</td>
              <td style={{ whiteSpace: "nowrap", fontSize: "12px" }}>{l.date ? new Date(l.date).toLocaleString("fr-FR") : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}

// ─── Stats ─────────────────────────────────────────────────────────────────
function Stats({ token }) {
  const [data, setData] = useState(null);
  useEffect(() => { axios.get("/api/admin/stats", { headers: { Authorization: `Bearer ${token}` } }).then(r => setData(r.data)).catch(() => {}); }, []);
  if (!data) return <div className="loading">Chargement...</div>;

  const { query, setQuery, filtered: connexionsFiltrees } = useSearch(data.connexions, ["ticket", "ip", "forfait"]);
  const { page, setPage, total, paginated } = usePagination(connexionsFiltrees, 8);

  const maxC = Math.max(...data.parJour.map(j => j.connexions), 1);
  const colors = ["#2563eb","#16a34a","#ea580c","#7c3aed","#0891b2","#ca8a04"];

  return (
    <div className="tab-content">
      <h2 className="section-title"><><BarChart3 size={20} /> Statistiques & États</></h2>

      <div className="charts-grid">
        {/* Graphique barres CSS */}
        <div className="admin-section">
          <h3><><Clock size={16} /> Connexions — 7 derniers jours</></h3>
          <div className="bar-chart">
            {data.parJour.map((j, i) => (
              <div key={i} className="bar-item">
                <div className="bar-label-top">{j.connexions}</div>
                <div className="bar-wrap">
                  <div className="bar-fill" style={{ height: `${(j.connexions / maxC) * 100}%` }}></div>
                </div>
                <div className="bar-label">{j.date.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Répartition par forfait */}
        {Object.keys(data.parForfait).length > 0 && (
          <div className="admin-section">
            <h3><><Package size={16} /> Répartition par forfait</></h3>
            <div className="duree-grid">
              {Object.entries(data.parForfait).map(([nom, count], i) => (
                <div key={nom} className="duree-card" style={{ borderLeft: `4px solid ${colors[i % colors.length]}` }}>
                  <div className="duree-count" style={{ color: colors[i % colors.length] }}>{count}</div>
                  <div className="duree-label">{nom}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="admin-section">
        <div className="section-header">
          <h3><><Globe size={16} /> Dernières connexions ({data.connexions.length})</></h3>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input className="search-input" type="text" placeholder="Rechercher..." value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />
            <button className="btn-export" onClick={() => exportCSV(data.connexions, "connexions.csv")}><><Download size={14} /> CSV</></button>
          </div>
        </div>
        <div className="table-wrapper"><table>
          <thead><tr><th>#</th><th>Ticket</th><th>IP</th><th>Forfait</th><th>Date/Heure</th><th>Montant</th></tr></thead>
          <tbody>{paginated.length === 0 ? <tr><td colSpan="6" className="empty-msg">Aucune connexion.</td></tr> : paginated.map(c => (
            <tr key={c.id}><td>{c.id}</td><td className="code-cell">{c.ticket}</td><td>{c.ip}</td><td>{c.forfait || "—"}</td>
              <td>{c.debut ? new Date(c.debut).toLocaleString("fr-FR") : "—"}</td>
              <td><span className="badge green">{(c.montant || 0).toLocaleString()} F</span></td>
            </tr>
          ))}</tbody>
        </table></div>
        <Pagination page={page} total={total} setPage={setPage} />
      </div>
    </div>
  );
}

// ─── Comptabilité ──────────────────────────────────────────────────────────
function Comptabilite({ token }) {
  const [data, setData] = useState(null);
  useEffect(() => { axios.get("/api/admin/comptabilite", { headers: { Authorization: `Bearer ${token}` } }).then(r => setData(r.data)).catch(() => {}); }, []);
  if (!data) return <div className="loading">Chargement...</div>;
  return (
    <div className="tab-content">
      <h2 className="section-title"><><DollarSign size={20} /> Comptabilité</></h2>
      <div className="stats-grid">
        <div className="stat-card green"><div className="stat-icon"><DollarSign size={24} /></div><div className="stat-info"><div className="stat-value">{data.recetteAujourdhui.toLocaleString()} F</div><div className="stat-label">Recette Aujourd'hui</div></div></div>
        <div className="stat-card blue"><div className="stat-icon"><BarChart3 size={24} /></div><div className="stat-info"><div className="stat-value">{data.recetteTotal.toLocaleString()} F</div><div className="stat-label">Recette Totale</div></div></div>
      </div>
      <div className="admin-section">
        <h3><><Clock size={16} /> Recettes par mois</></h3>
        {Object.keys(data.parMois).length === 0 ? <p className="empty-msg">Aucune donnée.</p> : (
          <div className="table-wrapper"><table><thead><tr><th>Mois</th><th>Recette</th></tr></thead>
            <tbody>{Object.entries(data.parMois).sort((a, b) => b[0].localeCompare(a[0])).map(([mois, montant]) => (
              <tr key={mois}><td>{new Date(mois + "-01").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</td><td><span className="badge green">{montant.toLocaleString()} FCFA</span></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      <div className="admin-section">
        <h3><><Package size={16} /> Recettes par forfait</></h3>
        {Object.keys(data.parForfait).length === 0 ? <p className="empty-msg">Aucune donnée.</p> : (
          <div className="duree-grid">{Object.entries(data.parForfait).map(([nom, montant]) => <div key={nom} className="duree-card"><div className="duree-count">{montant.toLocaleString()} F</div><div className="duree-label">{nom}</div></div>)}</div>
        )}
      </div>
      <div className="admin-section">
        <h3>Transactions récentes</h3>
        <div className="table-wrapper"><table>
          <thead><tr><th>#</th><th>Ticket</th><th>Forfait</th><th>Date</th><th>Montant</th></tr></thead>
          <tbody>{data.transactions.length === 0 ? <tr><td colSpan="5" className="empty-msg">Aucune transaction.</td></tr> : data.transactions.map(t => (
            <tr key={t.id}><td>{t.id}</td><td className="code-cell">{t.ticket}</td><td>{t.forfait || "—"}</td>
              <td>{t.date ? new Date(t.date).toLocaleString("fr-FR") : "—"}</td>
              <td><span className="badge green">{(t.montant || 0).toLocaleString()} FCFA</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}

// ─── Paramètres ────────────────────────────────────────────────────────────
function Parametres({ token }) {
  const [params, setParams] = useState(null);
  const [form, setForm] = useState({});
  const [pwdForm, setPwdForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [msgPwd, setMsgPwd] = useState({ text: "", type: "" });
  const showMsg = (text, type = "success") => { setMsg({ text, type }); setTimeout(() => setMsg({ text: "", type: "" }), 3000); };
  const showMsgPwd = (text, type = "success") => { setMsgPwd({ text, type }); setTimeout(() => setMsgPwd({ text: "", type: "" }), 3000); };
  useEffect(() => {
    axios.get("/api/admin/parametres", { headers: { Authorization: `Bearer ${token}` } }).then(r => { setParams(r.data.parametres); setForm(r.data.parametres); }).catch(() => {});
  }, []);
  const handleSauvegarder = async (e) => {
    e.preventDefault();
    try { await axios.put("/api/admin/parametres", form, { headers: { Authorization: `Bearer ${token}` } }); showMsg("Paramètres sauvegardés !"); }
    catch { showMsg("Erreur.", "error"); }
  };
  const handleChangerMdp = async (e) => {
    e.preventDefault();
    if (pwdForm.newPassword !== pwdForm.confirm) { showMsgPwd("Les mots de passe ne correspondent pas.", "error"); return; }
    if (pwdForm.newPassword.length < 6) { showMsgPwd("Minimum 6 caractères.", "error"); return; }
    try { await axios.put("/api/admin/parametres/password", { currentPassword: pwdForm.currentPassword, newPassword: pwdForm.newPassword }, { headers: { Authorization: `Bearer ${token}` } }); showMsgPwd("Mot de passe modifié !"); setPwdForm({ currentPassword: "", newPassword: "", confirm: "" }); }
    catch (err) { showMsgPwd(err.response?.data?.message || "Erreur.", "error"); }
  };
  if (!params) return <div className="loading">Chargement...</div>;
  return (
    <div className="tab-content">
      <h2 className="section-title"><><Settings size={20} /> Paramètres</></h2>
      <div className="admin-section">
        <h3>Configuration du portail</h3>
        {msg.text && <div className={`feedback ${msg.type}`}>{msg.text}</div>}
        <form onSubmit={handleSauvegarder}>
          <div className="form-row">
            <div className="form-group"><label>Nom du réseau Wi-Fi</label><input type="text" value={form.nomReseau || ""} onChange={e => setForm({ ...form, nomReseau: e.target.value })} /></div>
            <div className="form-group"><label>Message d'accueil</label><input type="text" value={form.messageAccueil || ""} onChange={e => setForm({ ...form, messageAccueil: e.target.value })} /></div>
          </div>
          <div className="form-row" style={{ marginTop: "12px" }}>
            <div className="form-group"><label>Logo (texte)</label><input type="text" maxLength="3" value={form.logoTexte || ""} onChange={e => setForm({ ...form, logoTexte: e.target.value })} /></div>
            <div className="form-group"><label>Couleur principale</label><input type="color" value={form.couleurPrimaire || "#2563eb"} onChange={e => setForm({ ...form, couleurPrimaire: e.target.value })} style={{ height: "42px", padding: "4px" }} /></div>
            <div className="form-group"><label>Email admin</label><input type="email" value={form.adminEmail || ""} onChange={e => setForm({ ...form, adminEmail: e.target.value })} /></div>
            <div className="form-group form-btn"><button type="submit"><><Save size={14} /> Sauvegarder</></button></div>
          </div>
        </form>
      </div>
      <div className="admin-section">
        <h3>Changer le mot de passe admin</h3>
        {msgPwd.text && <div className={`feedback ${msgPwd.type}`}>{msgPwd.text}</div>}
        <form onSubmit={handleChangerMdp}>
          <div className="form-row">
            <div className="form-group"><label>Mot de passe actuel</label><input type="password" placeholder="Mot de passe actuel" value={pwdForm.currentPassword} onChange={e => setPwdForm({ ...pwdForm, currentPassword: e.target.value })} /></div>
            <div className="form-group"><label>Nouveau mot de passe</label><input type="password" placeholder="Min. 6 caractères" value={pwdForm.newPassword} onChange={e => setPwdForm({ ...pwdForm, newPassword: e.target.value })} /></div>
            <div className="form-group"><label>Confirmer</label><input type="password" placeholder="Répéter" value={pwdForm.confirm} onChange={e => setPwdForm({ ...pwdForm, confirm: e.target.value })} /></div>
            <div className="form-group form-btn"><button type="submit"><><Lock size={14} /> Modifier</></button></div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Hotspots ──────────────────────────────────────────────────────────
function Hotspots({ token }) {
  const [hotspots, setHotspots] = useState([]);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [form, setForm] = useState({ nom: "", lieu: "", ip: "", debit: "10 Mbps" });
  const [loading, setLoading] = useState(false);
  const showMsg = (text, type = "success") => { setMsg({ text, type }); setTimeout(() => setMsg({ text: "", type: "" }), 3000); };
  const charger = () => axios.get("/api/admin/hotspots", { headers: { Authorization: `Bearer ${token}` } }).then(r => setHotspots(r.data.hotspots)).catch(() => {});
  useEffect(() => { charger(); }, []);

  const handleCreer = async (e) => {
    e.preventDefault();
    if (!form.nom.trim()) { showMsg("Nom requis.", "error"); return; }
    setLoading(true);
    try {
      await axios.post("/api/admin/hotspots", form, { headers: { Authorization: `Bearer ${token}` } });
      showMsg(`Hotspot "${form.nom}" créé !`);
      setForm({ nom: "", lieu: "", ip: "", debit: "10 Mbps" });
      charger();
    } catch (err) { showMsg(err.response?.data?.message || "Erreur.", "error"); }
    finally { setLoading(false); }
  };

  const handleToggle = async (id) => {
    try { const r = await axios.patch(`/api/admin/hotspots/${id}/toggle`, {}, { headers: { Authorization: `Bearer ${token}` } }); showMsg(r.data.message); charger(); }
    catch { showMsg("Erreur.", "error"); }
  };

  const handleSupprimer = async (id, nom) => {
    if (!window.confirm(`Supprimer "${nom}" ?`)) return;
    try { await axios.delete(`/api/admin/hotspots/${id}`, { headers: { Authorization: `Bearer ${token}` } }); showMsg(`"${nom}" supprimé.`); charger(); }
    catch { showMsg("Erreur.", "error"); }
  };

  return (
    <div className="tab-content">
      <h2 className="section-title"><><Wifi size={20} /> Gestion des Hotspots</></h2>
      {msg.text && <div className={`feedback ${msg.type}`}>{msg.text}</div>}
      <div className="admin-section">
        <h3><><Plus size={16} /> Créer un hotspot</></h3>
        <form onSubmit={handleCreer}>
          <div className="form-row">
            <div className="form-group"><label>Nom</label><input type="text" placeholder="Ex: Hotspot Salle" value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} /></div>
            <div className="form-group"><label>Lieu</label><input type="text" placeholder="Ex: Salle d'attente" value={form.lieu} onChange={e => setForm({ ...form, lieu: e.target.value })} /></div>
            <div className="form-group"><label>IP</label><input type="text" placeholder="Ex: 192.168.1.1" value={form.ip} onChange={e => setForm({ ...form, ip: e.target.value })} /></div>
            <div className="form-group"><label>Débit</label><input type="text" placeholder="Ex: 10 Mbps" value={form.debit} onChange={e => setForm({ ...form, debit: e.target.value })} /></div>
            <div className="form-group form-btn"><button type="submit" disabled={loading}>{loading ? "..." : "Créer"}</button></div>
          </div>
        </form>
      </div>
      <div className="admin-section">
        <h3><><List size={16} /> Liste des hotspots ({hotspots.length})</></h3>
        <div className="table-wrapper"><table>
          <thead><tr><th>Nom</th><th>Lieu</th><th>IP</th><th>Débit</th><th>Clients</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>{hotspots.length === 0 ? <tr><td colSpan="7" className="empty-msg">Aucun hotspot.</td></tr> : hotspots.map(h => (
            <tr key={h.id}>
              <td><strong>{h.nom}</strong></td>
              <td>{h.lieu || "—"}</td>
              <td><span className="code-cell">{h.ip || "—"}</span></td>
              <td>{h.debit}</td>
              <td><span className="badge blue">{h.clients || 0}</span></td>
              <td><span className={`badge ${h.statut === "actif" ? "actif" : "inactif"}`}>{h.statut === "actif" ? "Actif" : "Inactif"}</span></td>
              <td className="actions-cell">
                <button className={`btn-toggle ${h.statut === "actif" ? "desactiver" : "activer"}`} onClick={() => handleToggle(h.id)}>{h.statut === "actif" ? "Désactiver" : "Activer"}</button>
                <button className="btn-supprimer" onClick={() => handleSupprimer(h.id, h.nom)}>Supprimer</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}

// ─── Mikrotik ───────────────────────────────────────────────────────────
function Mikrotik({ token }) {
  const [statut, setStatut] = useState(null);
  const [profils, setProfils] = useState([]);
  const [clients, setClients] = useState([]);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [syncing, setSyncing] = useState(false);
  const showMsg = (text, type = "success") => { setMsg({ text, type }); setTimeout(() => setMsg({ text: "", type: "" }), 4000); };
  const hdr = { headers: { Authorization: `Bearer ${token}` } };

  const chargerStatut = async () => {
    try { const r = await axios.get("/api/admin/mikrotik/statut", hdr); setStatut(r.data); } catch { setStatut({ connecte: false, erreur: "Impossible de contacter le serveur" }); }
  };
  const chargerProfils = async () => { try { const r = await axios.get("/api/admin/mikrotik/profils", hdr); setProfils(r.data.profils || []); } catch {} };
  const chargerClients = async () => { try { const r = await axios.get("/api/admin/mikrotik/clients", hdr); setClients(r.data.clients || []); } catch {} };

  useEffect(() => { chargerStatut(); chargerProfils(); chargerClients(); }, []);

  const handleTest = async () => {
    try { const r = await axios.get("/api/admin/mikrotik/test", hdr); showMsg(r.data.message, r.data.success ? "success" : "error"); chargerStatut(); }
    catch { showMsg("Erreur de connexion.", "error"); }
  };

  const handleSync = async (type) => {
    setSyncing(true);
    try { const r = await axios.post(`/api/admin/mikrotik/sync-${type}`, {}, hdr); showMsg(r.data.message, "success"); chargerProfils(); }
    catch (err) { showMsg(err.response?.data?.message || "Erreur.", "error"); }
    finally { setSyncing(false); }
  };

  const handleDeconnecter = async (ip) => {
    if (!window.confirm(`Déconnecter ${ip} ?`)) return;
    try { const r = await axios.delete(`/api/admin/mikrotik/clients/${ip}`, hdr); showMsg(r.data.message); chargerClients(); }
    catch { showMsg("Erreur.", "error"); }
  };

  return (
    <div className="tab-content">
      <h2 className="section-title"><><Router size={20} /> Gestion Mikrotik</></h2>
      {msg.text && <div className={`feedback ${msg.type}`}>{msg.text}</div>}

      <div className="mikrotik-status">
        <div className="mikrotik-card">
          <h4>Statut</h4>
          <div className={`value ${statut?.connecte ? "ok" : "err"}`}>{statut?.connecte ? "Connecté" : "Déconnecté"}</div>
          {statut?.ip && <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>{statut.ip}:{statut.port} — {statut.user}</p>}
          {statut?.erreur && <p style={{ fontSize: "12px", color: "#ef4444", marginTop: "4px" }}>{statut.erreur}</p>}
        </div>
        <div className="mikrotik-card">
          <h4>Profils synchronisés</h4>
          <div className="value">{profils.length}</div>
        </div>
        <div className="mikrotik-card">
          <h4>Clients actifs</h4>
          <div className="value">{clients.length}</div>
        </div>
      </div>

      <div className="admin-section">
        <h3>Actions</h3>
        <div className="form-row">
          <div className="form-group form-btn"><button className="btn-edit" onClick={handleTest}>Tester la connexion</button></div>
          <div className="form-group form-btn"><button className="btn-save" onClick={() => handleSync("forfaits")} disabled={syncing}>{syncing ? "..." : "Sync Forfaits → Mikrotik"}</button></div>
          <div className="form-group form-btn"><button className="btn-save" onClick={() => handleSync("tickets")} disabled={syncing}>{syncing ? "..." : "Sync Tickets → Mikrotik"}</button></div>
        </div>
      </div>

      {profils.length > 0 && (
        <div className="admin-section">
          <h3><><List size={16} /> Profils Mikrotik</></h3>
          <div className="table-wrapper"><table>
            <thead><tr><th>Nom</th><th>Débit</th><th>Quota</th></tr></thead>
            <tbody>{profils.map((p, i) => (
              <tr key={i}><td><strong>{p.name || p.nom || "—"}</strong></td><td>{p.rateLimit || p.debit || "—"}</td><td>{p.quota || "Illimité"}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {clients.length > 0 && (
        <div className="admin-section">
          <h3><><Users size={16} /> Clients Mikrotik actifs</></h3>
          <div className="table-wrapper"><table>
            <thead><tr><th>IP</th><th>MAC</th><th>Bytes Up</th><th>Bytes Down</th><th>Actions</th></tr></thead>
            <tbody>{clients.map((c, i) => (
              <tr key={i}>
                <td><span className="code-cell">{c.ip || c.address || "—"}</span></td>
                <td><span className="code-cell">{c.mac || c["mac-address"] || "—"}</span></td>
                <td>{c.bytesUp || c["bytes-in"] || "—"}</td>
                <td>{c.bytesDown || c["bytes-out"] || "—"}</td>
                <td><button className="btn-supprimer" onClick={() => handleDeconnecter(c.ip || c.address)}>Déconnecter</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

// ─── Campay — Paiements Mobile Money ──────────────────────────────────────
function CampayPaiements({ token }) {
  const [statut, setStatut] = useState(null);
  const [paiements, setPaiements] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [loadingStatut, setLoadingStatut] = useState(false);
  const [loadingVerif, setLoadingVerif] = useState(null);

  const showMsg = (text, type = "success") => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "", type: "" }), 4000);
  };

  const chargerStatut = async () => {
    setLoadingStatut(true);
    try {
      const r = await axios.get("/api/admin/campay/statut", { headers: { Authorization: `Bearer ${token}` } });
      setStatut(r.data);
    } catch { showMsg("Erreur chargement statut Campay.", "error"); }
    finally { setLoadingStatut(false); }
  };

  const chargerPaiements = async () => {
    try {
      const r = await axios.get("/api/admin/campay/paiements", { headers: { Authorization: `Bearer ${token}` } });
      setPaiements(r.data);
    } catch { showMsg("Erreur chargement paiements.", "error"); }
  };

  useEffect(() => {
    chargerStatut();
    chargerPaiements();
    // Actualisation automatique toutes les 15 secondes
    const interval = setInterval(() => { chargerStatut(); chargerPaiements(); }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleForcerVerification = async (reference) => {
    setLoadingVerif(reference);
    try {
      const r = await axios.post(
        `/api/admin/campay/forcer-verification/${reference}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (r.data.status === "SUCCESSFUL") {
        showMsg(`Ticket ${r.data.ticket?.code} généré pour ref ${reference}`);
      } else {
        showMsg(`Statut: ${r.data.status} — ${r.data.message}`, "error");
      }
      chargerPaiements();
    } catch (err) {
      showMsg(err.response?.data?.message || "Erreur vérification.", "error");
    } finally {
      setLoadingVerif(null);
    }
  };

  return (
    <div className="tab-content">
      <h2 className="section-title">
        <><CreditCard size={20} /> Campay — Paiements Mobile Money</>
        <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "normal", marginLeft: "12px" }}>
          <><RefreshCw size={12} /> Auto-actualisation 15s</>
        </span>
      </h2>

      {msg.text && <div className={`feedback ${msg.type}`}>{msg.text}</div>}

      {/* Statut Campay */}
      <div className="admin-section">
        <div className="section-header">
          <h3>Statut de la connexion Campay</h3>
          <button className="filtre-btn actif" onClick={chargerStatut} disabled={loadingStatut}>
            {loadingStatut ? "..." : "Tester"}
          </button>
        </div>

        {statut ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginTop: "12px" }}>
            <div className={`stat-card ${statut.configure ? "green" : "red"}`}>
              <div className="stat-icon">{statut.configure ? <Check size={24} /> : <X size={24} />}</div>
              <div className="stat-info">
                <div className="stat-value" style={{ fontSize: "14px" }}>{statut.configure ? "Configuré" : "Non configuré"}</div>
                <div className="stat-label">Credentials .env</div>
              </div>
            </div>
            <div className={`stat-card ${statut.tokenOk ? "green" : statut.configure ? "red" : "dark"}`}>
              <div className="stat-icon">{statut.tokenOk ? <Lock size={24} /> : <Unlock size={24} />}</div>
              <div className="stat-info">
                <div className="stat-value" style={{ fontSize: "14px" }}>
                  {statut.tokenOk
                    ? `Token OK (${statut.tokenEtat?.expiresIn || 0}s)`
                    : statut.configure ? "Erreur auth" : "—"}
                </div>
                <div className="stat-label">Token d'accès</div>
              </div>
            </div>
            <div className="stat-card blue">
              <div className="stat-icon"><Clock size={24} /></div>
              <div className="stat-info">
                <div className="stat-value">{statut.paiementsEnCours ?? 0}</div>
                <div className="stat-label">Paiements en cours</div>
              </div>
            </div>
            <div className="stat-card dark">
              <div className="stat-icon"><Globe size={24} /></div>
              <div className="stat-info">
                <div className="stat-value" style={{ fontSize: "11px", wordBreak: "break-all" }}>
                  {statut.baseUrl?.replace("https://", "") || "—"}
                </div>
                <div className="stat-label">API URL</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="loading">Chargement...</div>
        )}

        {statut && (
          <div style={{
            marginTop: "12px",
            padding: "10px 14px",
            borderRadius: "8px",
            background: statut.tokenOk ? "#f0fdf4" : statut.configure ? "#fef2f2" : "#f8fafc",
            border: `1px solid ${statut.tokenOk ? "#bbf7d0" : statut.configure ? "#fecaca" : "#e2e8f0"}`,
            fontSize: "13px",
            color: statut.tokenOk ? "#166534" : statut.configure ? "#991b1b" : "#475569"
          }}>
            {statut.message}
          </div>
        )}

        {!statut?.configure && (
          <div style={{ marginTop: "12px", padding: "12px 16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", fontSize: "13px", color: "#92400e" }}>
            <strong>Configuration requise :</strong> Ajoutez dans <code>backend/.env</code> :
            <pre style={{ margin: "8px 0 0", fontFamily: "monospace", fontSize: "12px", background: "#fef3c7", padding: "8px", borderRadius: "6px" }}>
{`CAMPAY_APP_USERNAME=votre_username
CAMPAY_APP_PASSWORD=votre_password
CAMPAY_BASE_URL=https://demo.campay.net/api`}
            </pre>
          </div>
        )}
      </div>

      {/* Paiements en cours */}
      {paiements && (
        <div className="admin-section">
          <div className="section-header">
            <h3><><Clock size={16} /> Paiements en cours ({paiements.totalEnCours})</></h3>
            <button className="filtre-btn actif" onClick={chargerPaiements}><><RefreshCw size={14} /> Actualiser</></button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Référence Campay</th>
                  <th>Forfait</th>
                  <th>Montant</th>
                  <th>Téléphone</th>
                  <th>Opérateur</th>
                  <th>Initié il y a</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paiements.enCours.length === 0 ? (
                  <tr><td colSpan="7" className="empty-msg">Aucun paiement en cours.</td></tr>
                ) : paiements.enCours.map(p => (
                  <tr key={p.reference}>
                    <td className="code-cell" style={{ fontSize: "11px" }}>{p.reference}</td>
                    <td><span className="badge blue">{p.forfait}</span></td>
                    <td><span className="badge green">{(p.montant || 0).toLocaleString()} FCFA</span></td>
                    <td>{p.telephone || "—"}</td>
                    <td>{p.operateur || "—"}</td>
                    <td>
                      <span className={`badge ${p.ageMins > 5 ? "orange" : "actif"}`}>
                        {p.ageMins} min
                      </span>
                    </td>
                    <td className="actions-cell">
                      <button
                        className="btn-toggle activer"
                        onClick={() => handleForcerVerification(p.reference)}
                        disabled={loadingVerif === p.reference}
                      >
                        {loadingVerif === p.reference ? "..." : "Vérifier"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Historique des paiements Campay */}
      {paiements && (
        <div className="admin-section">
          <div className="section-header">
            <h3><><List size={16} /> Historique paiements Campay ({paiements.totalHistorique})</></h3>
            <button className="btn-export" onClick={() => {
              if (!paiements.historique.length) return;
              const headers = Object.keys(paiements.historique[0]).join(",");
              const rows = paiements.historique.map(r => Object.values(r).map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(","));
              const csv = [headers, ...rows].join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = "paiements-campay.csv"; a.click();
              URL.revokeObjectURL(url);
            }}><><Download size={14} /> CSV</></button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Code Ticket</th>
                  <th>Référence Campay</th>
                  <th>Forfait</th>
                  <th>Montant</th>
                  <th>Téléphone</th>
                  <th>Opérateur</th>
                  <th>Statut</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {paiements.historique.length === 0 ? (
                  <tr><td colSpan="8" className="empty-msg">Aucun paiement Campay enregistré.</td></tr>
                ) : paiements.historique.map((p, i) => (
                  <tr key={i}>
                    <td className="code-cell">{p.code}</td>
                    <td style={{ fontSize: "11px", fontFamily: "monospace", color: "#64748b" }}>{p.reference}</td>
                    <td><span className="badge blue">{p.forfait}</span></td>
                    <td><span className="badge green">{(p.montant || 0).toLocaleString()} FCFA</span></td>
                    <td>{p.telephone || "—"}</td>
                    <td>{p.operateur || "—"}</td>
                    <td>
                      <span className={`badge ${p.statut === "disponible" ? "actif" : p.statut === "utilise" ? "orange" : "inactif"}`}>
                        {p.statut === "disponible" ? "Disponible" : p.statut === "utilise" ? "Utilisé" : p.statut}
                      </span>
                    </td>
                    <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                      {p.date ? new Date(p.date).toLocaleString("fr-FR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Guide d'intégration webhook */}
      <div className="admin-section" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
        <h3 style={{ color: "#475569" }}>Webhook Campay (notifications push)</h3>
        <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.6 }}>
          <p>Pour recevoir les confirmations de paiement en temps réel (sans polling), configurez le webhook dans votre tableau de bord Campay :</p>
          <div style={{ background: "#1e293b", color: "#e2e8f0", borderRadius: "8px", padding: "12px 16px", fontFamily: "monospace", fontSize: "12px", margin: "10px 0" }}>
            POST <span style={{ color: "#86efac" }}>https://votre-domaine.com/api/paiement/webhook</span>
          </div>
          <p>Ajoutez également dans <code>backend/.env</code> :</p>
          <pre style={{ background: "#f1f5f9", padding: "10px", borderRadius: "6px", fontSize: "12px" }}>
{`CAMPAY_WEBHOOK_URL=https://votre-domaine.com/api/paiement/webhook`}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ─── AdminPage Principal ───────────────────────────────────────────────────
function AdminPage() {
  const [connecte, setConnecte] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem("smd_admin_token") || "");
  const [loginError, setLoginError] = useState("");
  const [onglet, setOnglet] = useState("dashboard");

  // Restaurer le token au chargement
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      setConnecte(true);
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault(); setLoginError("");
    const pwd = e.target.elements[0].value;
    try {
      const r = await axios.post("/api/admin/login", { password: pwd });
      const jwt = r.data.token;
      localStorage.setItem("smd_admin_token", jwt);
      axios.defaults.headers.common["Authorization"] = `Bearer ${jwt}`;
      setToken(jwt);
      setConnecte(true);
    } catch (error) { setLoginError(error.response?.data?.message || "Impossible de contacter le serveur."); }
  };

  const handleDeconnexion = () => {
    localStorage.removeItem("smd_admin_token");
    delete axios.defaults.headers.common["Authorization"];
    setToken("");
    setConnecte(false);
    setOnglet("dashboard");
  };

  const onglets = [
    { id: "dashboard",          label: <><LayoutDashboard size={16} /> Dashboard</>           },
    { id: "forfaits",           label: <><Package size={16} /> Forfaits</>             },
    { id: "tickets",            label: <><Ticket size={16} /> Tickets</>              },
    { id: "hotspots",           label: <><Wifi size={16} /> Hotspots</>             },
    { id: "mikrotik",           label: <><Router size={16} /> Mikrotik</>             },
    { id: "campay",             label: <><CreditCard size={16} /> Paiements Campay</>     },
    { id: "domicile",           label: <><Home size={16} /> Domicile</>             },
    { id: "comptes-privilegies",label: <><Star size={16} /> Privilégiés</>          },
    { id: "clients",            label: <><Users size={16} /> Clients</>              },
    { id: "stats",              label: <><BarChart3 size={16} /> Stats</>                },
    { id: "comptabilite",       label: <><DollarSign size={16} /> Comptabilité</>         },
    { id: "blacklist",          label: <><ShieldBan size={16} /> Blacklist</>            },
    { id: "logs",               label: <><ScrollText size={16} /> Journaux</>             },
    { id: "parametres",         label: <><Settings size={16} /> Paramètres</>           },
  ];

  if (!connecte) {
    return (
      <div className="admin-portal">
        <div className="admin-login-card">
          <div className="admin-logo"><Lock size={28} color="white" /></div>
          <h1>Administration</h1>
          <p className="admin-subtitle">SMD-CONNECT — Accès réservé</p>
          <form onSubmit={handleLogin}>
            <label>Mot de passe admin</label>
            <input type="password" name="admin-password" placeholder="Entrez le mot de passe" autoFocus />
            <button type="submit">ACCÉDER</button>
          </form>
          {loginError && <div className="admin-message error">{loginError}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-portal full">
      <div className="admin-layout">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="sidebar-icon">ST</div>
            <div><div className="sidebar-title">SMD-CONNECT</div><div className="sidebar-sub">Administration</div></div>
          </div>
          <nav className="sidebar-nav">
            {onglets.map(o => (
              <button key={o.id} className={`nav-item ${onglet === o.id ? "active" : ""}`} onClick={() => setOnglet(o.id)}>{o.label}</button>
            ))}
          </nav>
          <button className="btn-deconnexion sidebar-logout" onClick={handleDeconnexion}><><X size={16} /> Déconnexion</></button>
        </aside>
        <main className="main-content">
          {onglet === "dashboard"           && <Dashboard        token={token} />}
          {onglet === "forfaits"            && <Forfaits         token={token} />}
          {onglet === "tickets"             && <Tickets          token={token} />}
          {onglet === "hotspots"            && <Hotspots         token={token} />}
          {onglet === "mikrotik"            && <Mikrotik         token={token} />}
          {onglet === "campay"              && <CampayPaiements  token={token} />}
          {onglet === "domicile"            && <Domicile         token={token} />}
          {onglet === "comptes-privilegies" && <ComptePrivilegie token={token} />}
          {onglet === "clients"             && <Clients          token={token} />}
          {onglet === "stats"               && <Stats            token={token} />}
          {onglet === "comptabilite"        && <Comptabilite     token={token} />}
          {onglet === "blacklist"           && <Blacklist        token={token} />}
          {onglet === "logs"                && <Logs             token={token} />}
          {onglet === "parametres"          && <Parametres       token={token} />}
        </main>
      </div>
    </div>
  );
}

export default AdminPage;
