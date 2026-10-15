#!/usr/bin/env bash
# Guarda data/historico en la rama actual (con reintentos si alguien empujó antes).
set -u
git add data/historico 2>/dev/null || exit 0
git diff --cached --quiet && { echo "Sin cambios"; exit 0; }
git commit -q -m "$1"
branch="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
for i in 1 2 3 4; do
  git pull -q --rebase origin "$branch" && git push -q origin "HEAD:$branch" && exit 0
  sleep $((i * 5))
done
echo "No se pudo guardar" >&2
exit 1
