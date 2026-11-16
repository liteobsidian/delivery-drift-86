#!/usr/bin/env bash
set -euo pipefail

dist_dir="${1:?Provide a path to the verified build}"
key_file="${2:?Provide a path to the SFTP private key}"
deploy_host=77.91.79.89
site=https://drift-game.liteobsidian.ru
umask 077
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

# This build contains only index.html and Vite's fingerprinted assets.
test -s "$dist_dir/index.html"
shopt -s nullglob
assets=("$dist_dir"/assets/*)
if (( ${#assets[@]} == 0 )); then
  echo "No Vite assets in $dist_dir." >&2
  exit 1
fi
for asset in "${assets[@]}"; do
  if [[ ! -s "$asset" || ! -f "$asset" || ! "${asset##*/}" =~ ^[a-zA-Z0-9._-]+-[a-zA-Z0-9_-]{8}\.[a-zA-Z0-9]+$ ]]; then
    echo "Expected a fingerprinted Vite asset: $asset" >&2
    exit 1
  fi
done

cat > "$temp_dir/known_hosts" <<'HOST_KEY'
77.91.79.89 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGSTevbhYvJwU14G8b71DE1Th992kQ1cdl9I2USp8p8e
HOST_KEY

# Stage every file before renaming it into place. Publish the index last.
# Older hashed assets stay reachable for any clients that still have old HTML.
{
  printf '%s\n' 'cd /public' '-mkdir assets'
  for asset in "${assets[@]}"; do
    name="${asset##*/}"
    printf 'put "%s" "assets/.%s.upload"\n' "$asset" "$name"
    printf 'rename "assets/.%s.upload" "assets/%s"\n' "$name" "$name"
  done
  printf 'put "%s/index.html" ".index.html.upload"\n' "$dist_dir"
  printf '%s\n' 'rename ".index.html.upload" index.html'
} > "$temp_dir/upload.sftp"

sftp -b "$temp_dir/upload.sftp" -P 22 \
  -oBatchMode=yes -oConnectTimeout=10 -oIdentitiesOnly=yes \
  -oHostKeyAlgorithms=ssh-ed25519 -oStrictHostKeyChecking=yes \
  -oUserKnownHostsFile="$temp_dir/known_hosts" -oGlobalKnownHostsFile=/dev/null \
  -i "$key_file" "drift-game-deploy@$deploy_host"

verify_file() {
  local file="$1" url="$2"
  curl -fsS --compressed --connect-timeout 10 --retry 3 --retry-max-time 150 --max-time 90 "$url" -o "$temp_dir/served"
  if ! cmp -s "$file" "$temp_dir/served"; then
    echo "HTTPS response for $url differs from this build." >&2
    exit 1
  fi
  printf 'Verified %s\n' "$url"
}

verify_file "$dist_dir/index.html" "$site/"
for asset in "${assets[@]}"; do
  verify_file "$asset" "$site/assets/${asset##*/}"
done
