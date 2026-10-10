# Serveur de synchronisation Tsundoku : installation sur Proxmox

Un conteneur LXC Debian fait tourner le serveur (Node + PostgreSQL). Il est rendu joignable depuis Internet en HTTPS
avec Tailscale Funnel : **les utilisateurs n'installent rien d'autre que l'application**.

Chaque application génère sa propre clé secrète au moment d'activer la synchronisation ; le serveur ne retient que son
empreinte et crée l'utilisateur à son premier envoi. Pas de compte ni de mot de passe à gérer. Garde-fous (inscription
ouverte) : 200 utilisateurs, 20 000 fiches par utilisateur, 20 nouveaux utilisateurs par heure, 120 requêtes par minute
et par utilisateur, modifiables dans `/etc/tsundoku-sync.env` (`MAX_USERS`, `MAX_ENTRIES_PER_USER`, `NEW_USERS_PER_HOUR`).

## 1. Le conteneur (interface Proxmox)

- Modèle **Debian 12** (ou 13), 1 cœur, 512 Mo de RAM, 4 Go de disque suffisent. Démarrer au boot du serveur.
- Pour Tailscale, le conteneur doit pouvoir utiliser `/dev/net/tun`. Sur l'hôte Proxmox, éditer
  `/etc/pve/lxc/<id>.conf` et ajouter :

  ```
  lxc.cgroup2.devices.allow: c 10:200 rwm
  lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
  ```
  puis redémarrer le conteneur.

## 2. Installer le serveur (depuis GitHub)

Dans la console du conteneur (en root), une seule commande :

```bash
apt-get update && apt-get install -y curl && curl -fsSL https://raw.githubusercontent.com/DidicGLF/Tsundoku/main/v2/packages/sync-server/deploy/bootstrap.sh | bash
```

Elle récupère le code sur GitHub, installe Node et PostgreSQL, compile le serveur, crée la base, génère un
et démarre le service `tsundoku-sync`. Pour **mettre à jour** plus tard : relancer la même commande (ou `/opt/tsundoku-src/v2/packages/sync-server/deploy/bootstrap.sh`) ;
la base n'est pas touchée. Le conteneur doit avoir accès à Internet.

*Sans GitHub* : `pnpm --filter @tsundoku/sync-server release` fabrique une archive à copier avec `scp`,
puis `tar xzf tsundoku-sync.tgz && cd tsundoku-sync && ./deploy/install.sh`.

## 3. L'accès depuis Internet (Tailscale Funnel)

1. Dans la console d'administration Tailscale (login.tailscale.com), onglet **DNS** : activer **MagicDNS** et
   **HTTPS Certificates**.
2. Dans le conteneur : `curl -fsSL https://tailscale.com/install.sh | sh`, puis `tailscale up`
   (ouvrir le lien affiché pour autoriser l'appareil).
3. Ouvrir le serveur sur Internet : `tailscale funnel --bg 8787`. À la première utilisation, la commande affiche un
   lien pour autoriser Funnel dans ton compte Tailscale : l'ouvrir, accepter, relancer la commande.
4. `tailscale funnel status` affiche l'adresse publique, du genre `https://tsundoku.tailxxxx.ts.net`.
5. Test depuis n'importe où (sans Tailscale) : `curl -i https://tsundoku.tailxxxx.ts.net/v1/ping` doit répondre
   **401** (clé manquante) : le serveur est bien joignable et protégé.

Cette adresse est ensuite intégrée à l'application (variable `VITE_SYNC_URL`, voir le README) : l'utilisateur n'a
rien à saisir. Alternative avec un nom de domaine à toi : Cloudflare Tunnel (`cloudflared`) vers `http://127.0.0.1:8787`.

## 4. Dans l'application

Paramètres → Synchronisation → « Activer la synchronisation ». Pour un deuxième appareil : « Lier un autre appareil »
affiche un code court du genre `K7M4-QX2R` (5 minutes, une seule utilisation) ; l'autre appareil choisit « J'ai déjà une clé » et le tape.
Le serveur ne garde que la clé chiffrée par ce code (table `pairings`), jamais la clé ni le code.

## Notes

- Sauvegarde du serveur : `su postgres -c "pg_dump tsundoku" > tsundoku.sql` (ou un instantané Proxmox).
  Les appareils gardent chacun une copie complète : en cas de perte du serveur, une nouvelle installation
  se remplit à la première synchronisation.
- Un utilisateur peut effacer ses données du serveur depuis l'application (Paramètres → Synchronisation).
  Sa clé perdue sur tous ses appareils, ses données restent sur le serveur mais ne sont plus accessibles par lui.
  Il suffit alors d'en effacer la trace si besoin : `su postgres -c "psql tsundoku"` puis `SELECT user_id, created_at, last_seen FROM users;`.
- Les données hébergées sont des données personnelles de tiers (leur liste de lecture) : n'en fais rien d'autre que
  la synchronisation, et préviens-les de ce que le serveur stocke (l'application l'indique avant l'activation).
- **Suivi des utilisateurs** : `tsundoku-stats` (en root, dans le conteneur) affiche, en sections lisibles (couleurs sur un terminal ; `NO_COLOR=1` pour les couper), le nombre d'inscrits, les nouveaux et les actifs sur 24 h / 7 j / 30 j, les livres synchronisés et ceux marqués supprimés, la taille de la base et un tableau par bibliothèque (identifiant court, création, dernière activité, livres). Rien de nominatif : le serveur ne connaît que l'empreinte des clés. La dernière activité est mise à jour à chaque envoi, et au plus une fois par heure pour un appareil qui ne fait que lire.
- Journaux : `journalctl -u tsundoku-sync -f`.
