#!/usr/bin/env bash
# Chiffres d'usage du serveur Tsundoku (à lancer en root dans le conteneur) : tsundoku-stats
# Seulement des comptages : le serveur ne connaît ni les noms ni le contenu des bibliothèques.
set -euo pipefail
su postgres -c "psql tsundoku -X -q" <<'SQL'
\pset tuples_only on
\pset format aligned
SELECT 'Utilisateurs inscrits' AS indicateur, count(*)::text AS valeur FROM users
UNION ALL SELECT 'Nouveaux (24 h / 7 j / 30 j)',
  count(*) FILTER (WHERE created_at > now() - interval '1 day') || ' / ' ||
  count(*) FILTER (WHERE created_at > now() - interval '7 days') || ' / ' ||
  count(*) FILTER (WHERE created_at > now() - interval '30 days') FROM users
UNION ALL SELECT 'Actifs (24 h / 7 j / 30 j)',
  count(*) FILTER (WHERE last_seen > now() - interval '1 day') || ' / ' ||
  count(*) FILTER (WHERE last_seen > now() - interval '7 days') || ' / ' ||
  count(*) FILTER (WHERE last_seen > now() - interval '30 days') FROM users
UNION ALL SELECT 'Inactifs depuis plus de 90 jours', count(*)::text FROM users WHERE last_seen < now() - interval '90 days'
UNION ALL SELECT 'Livres synchronisés (total)', count(*)::text FROM entries WHERE NOT (doc ? 'deletedAt')
UNION ALL SELECT 'Livres par utilisateur (moyenne / maximum)',
  coalesce(round(avg(n))::text, '0') || ' / ' || coalesce(max(n)::text, '0')
  FROM (SELECT count(*) AS n FROM entries WHERE NOT (doc ? 'deletedAt') GROUP BY user_id) per_user
UNION ALL SELECT 'Taille de la base', pg_size_pretty(pg_database_size('tsundoku'));
SQL
echo
echo "Limite d'inscription : MAX_USERS=$(grep -E '^MAX_USERS=' /etc/tsundoku-sync.env 2>/dev/null | cut -d= -f2 || true) (200 par défaut, voir /etc/tsundoku-sync.env)"
