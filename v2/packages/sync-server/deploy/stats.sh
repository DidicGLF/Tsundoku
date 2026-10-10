#!/usr/bin/env bash
# Chiffres d'usage du serveur Tsundoku (à lancer en root dans le conteneur) : tsundoku-stats
# Seulement des comptages : le serveur ne connaît ni les noms ni le contenu des bibliothèques.
# Pour essayer sur une autre base : STATS_DATABASE_URL=postgres://… ./stats.sh
set -euo pipefail
export LC_ALL=C.UTF-8 # largeurs de colonnes calculées en caractères (accents, « · »)

sql() {
  if [ -n "${STATS_DATABASE_URL:-}" ]; then psql "$STATS_DATABASE_URL" -X -q -At -F '|'
  else su postgres -c "psql tsundoku -X -q -At -F '|'"; fi
}

# Couleurs seulement sur un terminal (pas dans un fichier ni un tube) et sans NO_COLOR.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\e[1m'; D=$'\e[2m'; G=$'\e[32m'; Y=$'\e[33m'; C=$'\e[36m'; R=$'\e[0m'
else B=""; D=""; G=""; Y=""; C=""; R=""; fi

IFS='|' read -r users new1 new7 new30 act1 act7 act30 idle90 live dead avg max size <<<"$(sql <<'SQL'
SELECT
  (SELECT count(*) FROM users),
  (SELECT count(*) FROM users WHERE created_at > now() - interval '1 day'),
  (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days'),
  (SELECT count(*) FROM users WHERE created_at > now() - interval '30 days'),
  (SELECT count(*) FROM users WHERE last_seen > now() - interval '1 day'),
  (SELECT count(*) FROM users WHERE last_seen > now() - interval '7 days'),
  (SELECT count(*) FROM users WHERE last_seen > now() - interval '30 days'),
  (SELECT count(*) FROM users WHERE last_seen < now() - interval '90 days'),
  (SELECT count(*) FROM entries WHERE NOT (doc ? 'deletedAt')),
  (SELECT count(*) FROM entries WHERE doc ? 'deletedAt'),
  coalesce((SELECT round(avg(n)) FROM (SELECT count(*) AS n FROM entries WHERE NOT (doc ? 'deletedAt') GROUP BY user_id) p), 0),
  coalesce((SELECT max(n) FROM (SELECT count(*) AS n FROM entries WHERE NOT (doc ? 'deletedAt') GROUP BY user_id) p), 0),
  pg_size_pretty(pg_database_size('tsundoku'));
SQL
)"

limit="$(grep -E '^MAX_USERS=' /etc/tsundoku-sync.env 2>/dev/null | cut -d= -f2 || true)"
limit="${limit:-200}"

# Remplissage calculé en caractères (printf compte des octets : les accents décaleraient les colonnes).
padr() { printf '%s%*s' "$1" "$(($2 - ${#1}))" ''; }
padl() { printf '%*s%s' "$(($2 - ${#1}))" '' "$1"; }
rule() { printf '%s%s%s\n' "$D" "──────────────────────────────────────────────────────────────" "$R"; }
row() { printf '  %s %s%s%s\n' "$(padr "$1" 31)" "$B" "$2" "$R"; }

echo
printf '  %sTsundoku%s · serveur de synchronisation   %s%s%s\n' "$B$C" "$R" "$D" "$(date '+%d/%m/%Y %H:%M')" "$R"
rule
printf '  %sUTILISATEURS%s\n' "$C" "$R"
row "Inscrits" "$users / $limit"
row "Nouveaux (24 h · 7 j · 30 j)" "$new1 · $new7 · $new30"
row "Actifs   (24 h · 7 j · 30 j)" "$act1 · $act7 · $act30"
row "Inactifs depuis plus de 90 j" "$idle90"
echo
printf '  %sLIVRES%s\n' "$C" "$R"
row "Synchronisés" "$live"
row "Par utilisateur (moy. · max)" "$avg · $max"
row "Supprimés (ménage à 90 jours)" "$dead"
echo
printf '  %sBASE%s\n' "$C" "$R"
row "Taille" "$size"
echo
printf '  %sBIBLIOTHÈQUES%s  %s(identifiant = début de l'"'"'empreinte de la clé)%s\n' "$C" "$R" "$D" "$R"
printf '  %s%s %s %s %s %s%s\n' "$D" "$(padr id 10)" "$(padr créée 17)" "$(padr 'dernière activité' 17)" "$(padl livres 7)" "$(padl supprimés 9)" "$R"
sql <<'SQL' | while IFS='|' read -r id created seen books deleted; do
SELECT left(u.user_id, 8), to_char(u.created_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YY HH24:MI'),
       to_char(u.last_seen AT TIME ZONE 'Europe/Paris', 'DD/MM/YY HH24:MI'),
       count(e.id) FILTER (WHERE NOT (e.doc ? 'deletedAt')), count(e.id) FILTER (WHERE e.doc ? 'deletedAt')
FROM users u LEFT JOIN entries e ON e.user_id = u.user_id
GROUP BY u.user_id, u.created_at, u.last_seen
ORDER BY u.last_seen DESC
LIMIT 15;
SQL
  printf '  %s %s %s %s%s%s %s\n' "$(padr "$id" 10)" "$(padr "$created" 17)" "$(padr "$seen" 17)" "$B" "$(padl "$books" 7)" "$R" "$(padl "$deleted" 9)"
done
if [ "$users" -gt 15 ]; then printf '  %s… et %s autre(s)%s\n' "$D" "$((users - 15))" "$R"; fi
rule
if [ "$users" -ge "$limit" ]; then printf '  %sLimite d'"'"'inscription atteinte : MAX_USERS dans /etc/tsundoku-sync.env%s\n' "$Y" "$R"; fi
echo
