# 🔍 Diagnostic — Portail captif contourné derrière répéteurs / AP

**Date :** 2026-11-24  
**Statut :** diagnostic seul — **aucune modification appliquée**, en attente du feu vert.  
**Périmètre :** `portail-captif` (backend Node.js + MikroTik RouterOS + PostgreSQL).

---

## 1. Symptôme rapporté

Avec des répéteurs / boosters Wi-Fi utilisés pour étendre l'AP :

- le **premier utilisateur** qui se connecte via l'AP passe bien par le portail captif et paie ;
- les **utilisateurs suivants** se retrouvent connectés automatiquement, sans page de portail et sans paiement.

---

## 2. Méthode d'investigation

Lecture seule (aucun changement de code, aucun redémarrage, aucune règle modifiée) :

1. Code : `backend/server.js`, `backend/mikrotik.js`, `backend/db.js`, `frontend/src/App.jsx`.
2. Historique git (`git log`, `git log -S/-G`, `git rev-list --all | git grep`) et docs/council reports existants.
3. État **réel** du routeur via l'API MikroTik (8728) depuis le VPS :
   `/ip/hotspot/*`, `/ip/dhcp-server/lease`, `/ip/arp`, `/ip/firewall/*`,
   `/interface/bridge/host`, `/ip/address`, `/ip/route`.
4. État PostgreSQL en lecture seule (`clients`, `connexions`, `comptes_privilegies`).

> Aucune occurrence de *repeater / répéteur / range extender / booster* n'existe dans le code,
> les commits ou les council reports : le scénario n'avait jamais été diagnostiqué explicitement.

---

## 3. Observations (preuves relevées)

### 3.1 Le hotspot identifie un client par MAC + IP

- `/ip/hotspot/print` : `hs1` sur `bridge1`, `address-pool=dhcp`, `addresses-per-mac=2`.
- `/ip/hotspot/host/print` et `/ip/hotspot/active/print` : chaque entrée porte
  `mac-address`, `address`, `authorized` et `login-by`.
- Le backend fait pareil : `genDeviceId()` / `resolverMac()` dans
  `backend/server.js:139-185`, et `macDepuisIp()` (ARP puis bail DHCP) dans
  `backend/mikrotik.js:311-332`.

**Conséquence :** tout ce qui est derrière un équipement qui NAT est vu comme **un seul**
client (la MAC/IP de l'équipement), pas comme plusieurs téléphones.

### 3.2 L'auto-connexion est activée et mémorisée 3 jours

`/ip/hotspot/profile/print` (profils serveur `hsprof1`, `nanostation-prof`, `default`) :

```
login-by=mac,cookie,http-chap,http-pap
mac-auth-mode=mac-as-username
http-cookie-lifetime=3d
```

`/ip/hotspot/user/profile/print` (tous les profils forfaits, y compris `default`) :

```
add-mac-cookie=true
mac-cookie-timeout=3d
shared-users=1
```

Côté code, la création d'un hotspot (`backend/mikrotik.js:1039`) pose déjà
`login-by=cookie,mac,http-chap,http-pap`, et `creerProfilHotspot()`
(`backend/mikrotik.js:203-209`) prévoit `shared-users=unlimited` sauf
`appareilUnique` — mais **en production tous les profils sont à `1`** : l'intention du code
n'est pas appliquée sur les profils existants.

### 3.3 Les comptes privilégiés ne sont PAS la cause ici

- `MIKROTIK_BYPASS_MODE=on` sur le VPS, 3 règles `action=return` `comment=smd-bypass`
  présentes en tête de `hs-unauth` (nat + filter) et `hs-unauth-to` (filter).
- Mais `/ip/firewall/address-list/print` → **liste vide**, et les compteurs des 3 règles
  `smd-bypass` sont à **0 packets**.
- `/ip/hotspot/ip-binding/print` : seulement 3 MAC en `type=bypassed`
  (`4A:A1:2F:F6:60:F6`, `42:3D:48:93:9D:C5`, `30:03:C8:28:C4:95`).
- 5 comptes privilégiés actifs en DB, dont les MAC ne correspondent à aucun client
  observé dans les baux/ARP au moment du diagnostic.

→ Le mécanisme `smd-bypass` n'a donc pas pu faire « passer » les autres utilisateurs.

### 3.4 Ce n'est pas non plus le « ticket partagé » du frontend

- `verifierAppareil()` (`backend/server.js:187-199`) autorise toujours tout appareil :
  la restriction MAC a été supprimée intentionnellement pour les forfaits payants.
- Les hotspot users payants sont créés **sans** `mac-address` (`backend/mikrotik.js:334-387`).
- La reconnexion auto du frontend (`frontend/src/App.jsx:87-146`) dépend du
  `localStorage` de **chaque navigateur** : elle ne peut pas faire passer un autre téléphone.

---

## 4. Cause retenue (hypothèse principale, ~85 %)

Le hotspot ne facture pas une personne : il autorise **l'identité L2 visible par RouterOS**.

1. Un répéteur en **mode routeur / NAT** (cas fréquent des boosters Wi-Fi grand public)
   cache les MAC des téléphones : le MikroTik ne voit que la MAC + l'IP du répéteur.
2. Le premier utilisateur ouvre le portail, paie, et le hotspot autorise **cette unique
   identité**. RouterOS ajoute en plus un **MAC cookie valable 3 jours**
   (`add-mac-cookie=true`, `mac-cookie-timeout=3d`).
3. Tous les appareils derrière le répéteur sortent par cette même session déjà autorisée :
   aucune redirection HTTP, aucun `hs-unauth`, aucun deuxième paiement.

Le même défaut frappe les forfaits gratuits limités par MAC : `resolverMac()` résout la MAC
du répéteur pour tous les utilisateurs, donc le « 1× par appareil » devient « 1× par répéteur ».

**Corollaire important :** si le répéteur est au contraire en vrai **bridge / WDS / AP pur**
(sans NAT ni DHCP), chaque téléphone reçoit son propre bail `192.168.88.x` et sa propre MAC
apparaît dans `/ip/hotspot/host` — dans ce cas le scénario ci-dessus ne s'applique pas et il
faut chercher ailleurs (cookie MAC résiduel sur un MAC partagé, `shared-users=1`).

---

## 5. Confirmation terrain en 2 minutes

Sur **deux téléphones connectés au même répéteur** :

1. Noter l'IP WiFi de chaque téléphone :
   - si elle n'est **pas** dans `192.168.88.0/24` (ex. `192.168.0.x`, `10.x`, `192.168.1.x`),
     le répéteur fait du NAT → diagnostic confirmé ;
   - si elle est dans `192.168.88.0/24`, comparer la MAC WiFi du téléphone avec la ligne
     correspondante dans `/ip/hotspot/host/print`.
2. Vérifier qu'un seul `host` MikroTik correspond à plusieurs téléphones, ou que la MAC vue
   différe de la MAC réelle du téléphone.
3. Noter le modèle du répéteur et son mode (Routeur / AP / Bridge / Repeater / WDS).

---

## 6. Correctifs envisagés (à valider avant exécution)

### Option A — Topologie (recommandée)

Configurer les répéteurs en **bridge / WDS / AP pur** : NAT désactivé, DHCP désactivé,
le DHCP du MikroTik (`dhcp1`, pool `dhcp`) fournit les adresses.

- ✅ Chaque téléphone devient un client hotspot distinct → portail et paiement par appareil.
- ✅ Aucune modification de code, aucun redémarrage du backend.
- ⚠️ Action sur le matériel réseau, à faire sur site (ou via l'interface du répéteur).

### Option B — Répéteurs nécessairement en NAT

Si les équipements ne peuvent pas passer en bridge, **aucun correctif logiciel de ce repo ne
permet de facturer chaque appareil derrière le NAT** : le MikroTik ne les voit pas.
Il faut soit remplacer le matériel, soit utiliser un répéteur qui porte son propre hotspot
avec authentification par client, soit accepter un abonnement par répéteur.
Bloquer l'identité unique après le premier paiement couperait Internet à tout le monde.

### Option C — Durcissement RouterOS (à faire avec A ou B)

- Retirer `mac` de `login-by` pour les hotspot users **normaux** et s'appuyer sur
  `ip-binding` / firewall `smd-bypass` pour les comptes privilégiés.
- Passer `add-mac-cookie=false` (ou `mac-cookie-timeout` court) pour les profils payants.
- Aligner `shared-users` avec `backend/mikrotik.js:209` (`unlimited` sauf
  `appareilUnique`) sur les profils existants.
- ⚠️ Risque : 5 comptes privilégiés dépendent encore de `login-by=mac` + users
  `mac-address` (`backend/mikrotik.js:602-651`) ; la liste `smd-bypass` étant vide,
  il faut d'abord réparer sa synchronisation avant de supprimer `login-by=mac`.

---

## 7. Références utiles

| Sujet | Fichier / commande |
|---|---|
| Identité client, deviceId, MAC | `backend/server.js:139-185` |
| Résolution MAC via ARP/DHCP | `backend/mikrotik.js:311-332` |
| Forfaits gratuits limités par MAC | `backend/server.js:510-607`, `backend/mikrotik.js:334-387` |
| Profils hotspot & `shared-users` | `backend/mikrotik.js:203-209`, `:1027-1043` |
| Bypass firewall `smd-bypass` | `backend/mikrotik.js:678-737`, `DEPLOIEMENT.md:208-224` |
| Reconnexion automatique frontend | `frontend/src/App.jsx:87-146` |
| Diagnostic NAT/second routeur (historique) | `council-report-20261103-140229Z-e24b1ef9.html:290` |
| Pièges `login-by=mac` / cookies (historique) | `council-report-20261020-083235Z-q55fdb9e4.html:251-254` |

---

## 8. Décision

**Correctif logiciel appliqué et durci selon le council 2026-11-24 (D) puis revalidé le 2026-11-25 (B modifié : pilote terrain borné, production bloquée) — en attente de déploiement.**
Le code durcit l'authentification RouterOS : retrait de `mac` du `login-by`,
`add-mac-cookie=false`, alignement de `shared-users`, bypass privilégié via
`ip-binding` + `smd-bypass` (détails : `DEPLOIEMENT.md` §9). Le retrait de `login-by=mac`
est conditionné à un preflight read-only : synchronisation réussie, 5 MAC actives
exactement en `ip-binding`, aucune identité inconnue, ARP statique exactement
concordant, et 3 règles firewall **par couple IP+MAC** avec `src-mac-address`
(les règles génériques IP-only sont désactivées). La sync n'accepte une IP qu'avec
une entrée ARP **statique** concordante ; un durcissement partiel annule tous les
profils. Le rollback est durable (drapeau persisté en DB, `login-by=mac` restauré,
règles, liste et `ip-binding type=bypassed` retirés) et un endpoint de réactivation
recrée la sync avant un nouveau preflight. Le mode `MIKROTIK_MAC_LOGIN=on` est
explicitement ignoré (ni durci, ni purge de cookies). Aucune modification n'a été appliquée au routeur ni à la topologie :
le feu vert du propriétaire reste nécessaire avant connexion au VPS et
déploiement. La confirmation du mode des répéteurs, le test à deux téléphones
avec compteurs et la tentative d'usurpation d'IP restent indispensables : si un
répéteur NAT persiste, l'Option A (bridge/WDS) demeure la seule correction
complète.
