#!/usr/bin/env bash
set -Eeuo pipefail

base_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="$base_dir/backups"
name="${1:-checkys-base-pb-data-$(date +%Y%m%d-%H%M%S).tar.gz}"
was_running=false

if [[ ! "$name" =~ ^[A-Za-z0-9._-]+\.tar\.gz$ ]]; then
  echo "Backup name must contain only letters, numbers, dots, underscores, and dashes, and end in .tar.gz." >&2
  exit 1
fi

mkdir -p "$backup_dir"
cd "$base_dir"

container_id="$(docker compose ps -q pocketbase)"
if [[ -n "$container_id" ]]; then
  running_state="$(docker inspect --format '{{.State.Running}}' "$container_id")"
  if [[ "$running_state" == "true" ]]; then
    was_running=true
    docker compose stop pocketbase
  fi
fi

restore_pocketbase() {
  if [[ "$was_running" == "true" ]]; then
    docker compose start pocketbase
  fi
}
trap restore_pocketbase EXIT

BACKUP_NAME="$name" docker compose --profile tools run --rm backup

backup_path="$backup_dir/$name"
if [[ ! -f "$backup_path" ]]; then
  echo "The backup container finished without creating $backup_path." >&2
  exit 1
fi

echo "Backup created: $backup_path"
