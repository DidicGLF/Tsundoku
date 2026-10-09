# Serveur de synchronisation Tsundoku : installation sur Proxmox

Un conteneur LXC Debian fait tourner le serveur (Node + PostgreSQL). Tailscale le rend joignable en HTTPS
depuis le téléphone et le PC, chez toi comme dehors, sans ouvrir de port sur ta box.

## 1. Le conteneur (interface Proxmox)

- Modèle **Debian 12** (ou 13), 1 cœur, 512 Mo de RAM, 4 Go de disque suffisent. Démarrer au boot du serveur.
- Pour Tailscale, le conteneur doit pouvoir utiliser `/dev/net/tun`. Sur l'hôte Proxmox, éditer
  `/etc/pve/lxc/<id>.conf` et ajouter :

  ```
  lxc.cgroup2.devices.allow: c 10:200 rwm
  lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
  ```
  puis redémarrer le conteneur.

## 2. Copier et installer le serveur

Sur le PC de développement :

```bash
nix-shell --run 'pnpm --filter @tsundoku/sync-server release'
scp packages/sync-server/release/tsundoku-sync.tgz root@<adresse-du-conteneur>:/root/
```

Dans le conteneur :

```bash
tar xzf tsundoku-sync.tgz && cd tsundoku-sync && ./deploy/install.sh
```

Le script installe PostgreSQL et Node, crée la base, génère un **jeton secret** (affiché une fois, relisible avec
`grep SYNC_TOKEN /etc/tsundoku-sync.env`) et démarre le service `tsundoku-sync`. Le relancer plus tard met le
code à jour sans toucher aux données ni au jeton.

## 3. L'HTTPS avec Tailscale

1. Dans la console d'administration Tailscale (login.tailscale.com), onglet **DNS** : activer **MagicDNS**
   et **HTTPS Certificates**.
2. Dans le conteneur : `curl -fsSL https://tailscale.com/install.sh | sh`, puis `tailscale up`
   (ouvrir le lien affiché pour autoriser l'appareil).
3. Publier le serveur en HTTPS : `tailscale serve --bg --https=443 http://127.0.0.1:8787`.
4. `tailscale serve status` affiche l'adresse, du genre `https://tsundoku.tailxxxx.ts.net`.

Installer l'application **Tailscale** sur le téléphone (et le PC) avec le même compte, et la laisser active.

## 4. Dans l'application

Paramètres → Synchronisation : saisir l'adresse (`https://tsundoku.tailxxxx.ts.net`) et le jeton, puis
« Tester la connexion ».

## Notes

- Sauvegarde du serveur : `su postgres -c "pg_dump tsundoku" > tsundoku.sql` (ou un instantané Proxmox).
  Les appareils gardent chacun une copie complète : en cas de perte du serveur, une nouvelle installation
  se remplit à la première synchronisation.
- Changer de jeton : modifier `SYNC_TOKEN` dans `/etc/tsundoku-sync.env`, `systemctl restart tsundoku-sync`,
  puis saisir le nouveau dans l'application.
- Journaux : `journalctl -u tsundoku-sync -f`.
