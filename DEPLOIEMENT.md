# 🚀 Déploiement — Portail captif SMD-CONNECT

## Architecture

```
Poste de dev (Windows, H:\portail-captif)
        │  git push
        ▼
GitHub (master) ── github.com/KINSLYLAURINCE/portail-captif
        │  git pull / reset --hard
        ▼
VPS de production (Ubuntu, OVH)
```

Le backend Node.js sert aussi le frontend (`frontend/dist` via `express.static`) :
**pas de build séparé sur le VPS**, le `dist/` commité est utilisé tel quel.

---

## 🖥️ Informations VPS (production)

| Clé | Valeur |
|---|---|
| **Adresse SSH** | `84.247.137.170` |
| **Utilisateur** | `root` (clé `id_ed25519` du poste de dev) |
| **Hostname** | `vmi3547046` (Ubuntu, x86_64) |
| **Chemin du projet** | `/opt/portail-captif` |
| **Processus PM2** | `smd-connect` (fork, `backend/server.js`) |
| **Port backend** | `5000` |
| **PostgreSQL** | local (`portail_captif`), service `postgresql` |
| **MikroTik** | `10.10.0.2:8728` (API, `MIKROTIK_ENABLED=true`) |
| **Nginx** | site `somady.online` (autre projet, ne pas toucher)

> Les secrets (mots de passe PG, MikroTik, Fapshi) sont uniquement dans
> `/opt/portail-captif/backend/.env` sur le VPS — fichier **non tracké par git**,
> jamais modifié par un `git reset`.

---

## 📦 Processus de déploiement (standard)

### 1. Local — vérifications préalables

```powershell
# Syntaxe backend
node --check backend/server.js
node --check backend/mikrotik.js
node --check backend/db.js

# Lint + build frontend (le dist reconstruit doit être commité)
cd frontend
npm run lint
npm run build
cd ..
```

### 2. Local — commit + push

```powershell
git add -A
git commit -m "feat: <description>"
git push origin master
```

### 3. VPS — sauvegardes AVANT déploiement

```powershell
$script = @'
set -e
D=$(date +%Y-%m-%d)
# a) Sauvegarde complète du dossier projet (inclut .env)
tar -czf /root/portail-captif-backup-$D.tar.gz -C /opt portail-captif
# b) Patch des éventuelles modifications non commitées sur le VPS
cd /opt/portail-captif && git diff > /root/vps-changes-$D.patch
# c) Sauvegarde PostgreSQL
sudo -u postgres pg_dump portail_captif > /root/backup_portail_$D.sql
ls -lh /root/*$D*
'@; $script | ssh root@84.247.137.170 'bash -s'
```

### 4. VPS — mise à jour du code

```powershell
$script = @'
cd /opt/portail-captif
git fetch origin
git reset --hard origin/master
git log --oneline -3
'@; $script | ssh root@84.247.137.170 'bash -s'
```

### 5. VPS — redémarrage

```powershell
ssh root@84.247.137.170 "pm2 restart smd-connect && sleep 2 && pm2 status smd-connect"
```

> Les migrations de base (`ALTER TABLE ... IF NOT EXISTS`) s'exécutent
> automatiquement au démarrage du backend (`db.js → initDb()`).

### 6. VPS — vérifications post-déploiement

```powershell
$script = @'
echo --- PM2 ---
pm2 status smd-connect | head -8
echo --- LOGS ---
pm2 logs smd-connect --lines 15 --nostream
echo --- API ---
curl -s http://localhost:5000/api/test
echo
curl -s http://localhost:5000/api/forfaits | head -c 200
echo
echo --- COLONNE MAC ---
sudo -u postgres psql portail_captif -c "\d appareils_gratuits" | grep -i mac
'@; $script | ssh root@84.247.137.170 'bash -s'
```

Critères de succès :
- PM2 : `status = online`, `restarts = 0`
- Logs : `✅ [DB] PostgreSQL prêt` sans erreur
- `GET /api/test` → `{"success":true,...}`
- `\d appareils_gratuits` montre la colonne `mac`

---

## 🔁 Rollback

En cas de problème après déploiement :

```powershell
$script = @'
set -e
D=<date-du-deploiement>   # ex: 2026-10-18
cd /opt/portail-captif
pm2 stop smd-connect
tar -xzf /root/portail-captif-backup-$D.tar.gz -C /opt
pm2 restart smd-connect
# Si la base a été migrée et qu'on veut revenir en arrière :
# sudo -u postgres psql portail_captif < /root/backup_portail_$D.sql
'@; $script | ssh root@84.247.137.170 'bash -s'
```

Le patch des non-commités sauvegardé (`vps-changes-*.patch`) permet de
rejouer à la main d'éventuelles modifications locales du VPS :
`git apply /root/vps-changes-*.patch`

---

## ✅ Actions post-déploiement (manuelles, selon les features livrées)

| Feature | Action à faire après redémarrage |
|---|---|
| **Comptes privilégiés (bypass MAC)** | Admin → Comptes privilégiés : **Suspendre → Réactiver** chaque compte existant (applique `login-by=mac` sur les profils hotspot MikroTik) |
| **Forfaits gratuits limités par MAC** | Créer/activer un forfait gratuit dans l'admin, tester : 1er accès OK, 2e tentative bloquée (même après vidage du cache) |
| **Nouvelles colonnes DB** | Vérifier la migration : `sudo -u postgres psql portail_captif -c "\d appareils_gratuits"` |

---

## ⚠️ Règles

1. **Jamais de `git push --force` sur master**
2. **Toujours sauvegarder (étape 3) avant un `reset --hard`**
3. **Ne jamais commit `.env`** ni de secrets dans le dépôt
4. Le VPS ne doit **pas** être modifié directement (pas de patch à la main dans
   `/opt/portail-captif`) : toute modification se fait sur le poste de dev,
   commitée et pushée, sinon elle sera écrasée au prochain déploiement
5. `gestion-stock-api` (autre process PM2) et nginx `somady.online` sont
   **hors périmètre** — ne pas les redémarrer ni reconfigurer


