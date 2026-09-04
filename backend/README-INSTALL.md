# SMD-CONNECT — Portail Captif Wi-Fi

> Backend Express + PostgreSQL pour gestion de portail captif avec tickets Wi-Fi,
> paiement Mobile Money (Campay) et intégration Mikrotik RouterOS.

---

## 📋 Contexte du projet

**Date de migration vers PostgreSQL : 21/08/2026**

Le projet stockait initialement toutes ses données dans un fichier `data.json`.
Il a été migré vers une base de données **PostgreSQL** (`portail_captif`) :

| Avant | Après |
|---|---|
| `data.json` réécrit à chaque modification | Base PostgreSQL ACID |
| Données perdues si crash entre 2 sauvegardes | Chaque écriture est immédiate et durable |
| Compteurs d'ID en mémoire | Séquences `SERIAL` PostgreSQL |
| `paiementsEnCours` en mémoire (déjà le cas) | Idem (volontaire, géré par fallback) |

### Données migrées depuis data.json
- ✅ 7 forfaits (IDs 5–11 conservés)
- ✅ 5 tickets (dont 1 paiement Campay réel : ref `29e3dcc3-7c20-...`)
- ✅ 5 connexions (recette historique : **2 550 FCFA**)
- ✅ 51 logs
- ✅ Paramètres (nom réseau, couleur, email admin)

Les anciennes tables d'une précédente itération (`vouchers`, `logs_connexion`)
sont archivées dans la base sous les noms `vouchers_legacy` et `logs_connexion_legacy`.

`data.json` n'est **plus utilisé** par le serveur (conservé comme backup).

---

## 🏗️ Architecture

```
portail-captif/
├── backend/
│   ├── server.js      ← API Express (toutes routes lisent/écrivent dans PostgreSQL)
│   ├── db.js          ← Pool pg + création auto du schéma + seeds par défaut
│   ├── seed.js        ← Restauration data.json → PostgreSQL (réutilisable)
│   ├── schema.sql     ← DDL complet (référence, exécutable via psql)
│   ├── mikrotik.js    ← Client TCP natif API RouterOS (port 8728)
│   ├── campay.js      ← Passerelle Mobile Money Orange/MTN
│   ├── .env           ← Configuration (DB, admin, mikrotik, campay)
│   └── data.json      ← BACKUP uniquement (plus lu par le serveur)
└── frontend/          ← React + Vite (portail client + interface admin)
```

## 🗄️ Schéma de base de données (11 tables)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `forfaits` | Plans Wi-Fi | nom UNIQUE, prix, quota, debit, duree, profil_mikrotik, gratuit, appareil_unique |
| `tickets` | Codes générés | code UNIQUE, forfait_id FK, statut (`disponible/utilise/expire`), campay_reference UNIQUE |
| `hotspots` | Points d'accès | ip UNIQUE, statut, clients |
| `clients` | Clients connectés | ip, mac, statut |
| `connexions` | Historique facturé | ticket, debut, fin, montant |
| `domiciles` | Abonnés nano-station | mac UNIQUE, date_expiration |
| `comptes_privilegies` | Bypass portail par MAC | mac UNIQUE, statut (`actif/suspendu`) |
| `blacklist` | IP/MAC bannis | type (`ip/mac`), valeur UNIQUE |
| `logs` | Journal événements | type, message (limité à 500 entrées) |
| `parametres` | Config portail (1 ligne) | nom_reseau, message_accueil, logo_texte, couleur_primaire |
| `appareils_gratuits` | Anti-rejeu forfait gratuit | UNIQUE(appareil_id, forfait_id) |

---

## 🚀 Installation sur une nouvelle machine

### Prérequis
- Node.js ≥ 18
- PostgreSQL ≥ 14

### Étapes

```powershell
# 1. Créer la base (une seule fois)
psql -U postgres -c "CREATE DATABASE portail_captif;"

# 2. Copier le dossier backend/, puis configurer .env :
#    PGHOST=localhost
#    PGPORT=5432
#    PGDATABASE=portail_captif
#    PGUSER=postgres
#    PGPASSWORD=<mot_de_passe_pg>

# 3. Installer les dépendances
npm install

# 4. Lancer le serveur
node server.js
```

**⚠️ Aucun script SQL à exécuter manuellement** : au démarrage, `db.js → initDb()`
crée automatiquement toutes les tables (`CREATE TABLE IF NOT EXISTS`) et insère
les données par défaut (4 forfaits types, paramètres, 3 hotspots) si les tables sont vides.

### Restaurer les données existantes (optionnel)

```powershell
# Copier data.json dans backend/ puis :
node seed.js
```

`seed.js` vide les tables de données puis importe tout le contenu de `data.json`
en préservant les IDs et en réalignant les séquences. Hotspots et paramètres par
défaut sont conservés.

### Sauvegarde / restauration PostgreSQL

```powershell
# Backup
pg_dump -U postgres -d portail_captif -f backup_2026-08-21.sql

# Restore
psql -U postgres -d portail_captif -f backup_2026-08-21.sql
```

---

## ⚙️ Variables .env

```ini
PORT=5000
ADMIN_PASSWORD=admin123            # ⚠️ À CHANGER EN PRODUCTION

PGHOST=localhost
PGPORT=5432
PGDATABASE=portail_captif
PGUSER=postgres
PGPASSWORD=***

MIKROTIK_ENABLED=false             # true en production
MIKROTIK_HOST=192.168.88.1
MIKROTIK_PORT=8728
MIKROTIK_USER=admin
MIKROTIK_PASSWORD=

CAMPAY_BASE_URL=https://demo.campay.net/api   # https://campay.net/api en prod
CAMPAY_APP_USERNAME=***
CAMPAY_APP_PASSWORD=***
CAMPAY_WEBHOOK_URL=                # URL publique HTTPS du webhook
```

---

## 🔌 API — Endpoints principaux

### Publics
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/forfaits` | Liste des forfaits actifs |
| GET | `/api/session?deviceId=X` | Statut de session d'un appareil |
| GET | `/api/verifier-code/:code` | Vérifier un code sans le consommer |
| POST | `/api/acces-gratuit` | Forfait gratuit (1× par appareil) |
| POST | `/api/acheter` | Générer un ticket |
| POST | `/api/login-code` | Connexion avec un code |
| POST | `/api/paiement/initier` | Initier paiement Campay |
| POST | `/api/paiement/verifier` | Polling statut paiement |
| POST | `/api/paiement/webhook` | Callback Campay |

### Admin (header `password: <ADMIN_PASSWORD>`)
Dashboard, CRUD forfaits/tickets/hotspots/domiciles/blacklist/logs/paramètres,
stats, comptabilité, comptes privilégiés (bypass MAC), outils Mikrotik
(`/api/admin/mikrotik/sync-tickets`, `sync-forfaits`, `test`), outils Campay
(`/api/admin/campay/statut`, `paiements`, `forcer-verification/:ref`).

---

## ⚠️ Ce qui manque pour la MISE EN PRODUCTION

1. **Activer Mikrotik** (bloquant — sans ça les tickets n'ouvrent pas internet) :
   - RouterOS : activer le service API (IP → Services → `api`, port 8728)
   - Créer le Hotspot sur l'interface WiFi + page de login pointant vers le portail
   - `.env` → `MIKROTIK_ENABLED=true` + identifiants
   - Synchroniser les tickets : `POST /api/admin/mikrotik/sync-tickets`

2. **Campay production** : compte réel sur campay.net,
   `CAMPAY_BASE_URL=https://campay.net/api`, webhook HTTPS public configuré.

3. **Sécurité** : changer `ADMIN_PASSWORD`, restreindre l'accès PG (hôte/mot de passe fort).

4. **Servir le frontend** : builder (`npm run build` dans `frontend/`) puis servir
   `dist/` (nginx ou ajouter `express.static` au backend). La machine doit être
   joignable des clients du hotspot.

5. **Process daemon** : PM2 (`pm2 start server.js --name smd-connect`) ou service Windows/NSSM
   pour redémarrage automatique.

---

## ✅ Tests effectués (21/08/2026)

- [x] Migration data.json → PostgreSQL (séquences réalignées)
- [x] Achat ticket → connexion → code marqué « utilisé »
- [x] Session appareil persistante après redémarrage serveur
- [x] Dashboard/comptabilité exacts (2 550 FCFA historique + 500 test = 3 050)
- [x] Logs écrits en base à chaque action
- [x] Redémarrage serveur : aucune perte de données
