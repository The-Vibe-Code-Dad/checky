#!/usr/bin/env bash
set -Eeuo pipefail

base_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
data_volume_name="checkys-base_pocketbase_data"
skip_backup=false
pull_images=true
health_timeout=180
requested_data_volume=""

usage() {
  cat <<'EOF'
Usage: bash scripts/update-base.sh [options]

Options:
  --skip-backup       Update without creating a pre-update database backup.
  --no-pull           Build without pulling newer base images.
  --data-volume NAME  Use a specific existing PocketBase data volume.
  --health-timeout N  Wait N seconds for healthy containers (30-900).
  -h, --help          Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-backup)
      skip_backup=true
      shift
      ;;
    --no-pull)
      pull_images=false
      shift
      ;;
    --data-volume)
      [[ $# -ge 2 && -n "$2" ]] || { echo "--data-volume requires a value." >&2; exit 2; }
      requested_data_volume="$2"
      shift 2
      ;;
    --health-timeout)
      [[ $# -ge 2 ]] || { echo "--health-timeout requires a value." >&2; exit 2; }
      health_timeout="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "$health_timeout" =~ ^[0-9]+$ ]] || (( health_timeout < 30 || health_timeout > 900 )); then
  echo "--health-timeout must be an integer from 30 through 900." >&2
  exit 2
fi

volume_has_database() {
  local volume_name="$1"
  local probe_status

  docker run --rm --mount "type=volume,src=${volume_name},dst=/source,readonly" alpine:3.24.3 test -s /source/data.db >/dev/null 2>&1
  probe_status=$?
  case "$probe_status" in
    0) return 0 ;;
    1) return 1 ;;
    *)
      echo "Could not inspect PocketBase volume '$volume_name' (Docker exit code $probe_status). The update was cancelled instead of risking an empty database." >&2
      return 2
      ;;
  esac
}

service_health() {
  local service="$1"
  local container_id
  local health

  container_id="$(docker compose ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    printf '%s\n' "missing"
    return
  fi

  if ! health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"; then
    printf '%s\n' "unknown"
    return
  fi

  printf '%s\n' "${health:-unknown}"
}

cd "$base_dir"
docker info --format '{{.ServerVersion}}' >/dev/null

if [[ -n "$requested_data_volume" ]]; then
  if ! docker volume inspect "$requested_data_volume" >/dev/null 2>&1; then
    echo "The requested PocketBase data volume '$requested_data_volume' does not exist." >&2
    exit 1
  fi
  if volume_has_database "$requested_data_volume"; then
    data_volume_name="$requested_data_volume"
  else
    probe_status=$?
    if (( probe_status == 1 )); then
      echo "The requested PocketBase data volume '$requested_data_volume' does not contain a non-empty data.db file." >&2
    fi
    exit 1
  fi
else
  mapfile -t candidate_volumes < <(docker volume ls --filter "label=com.docker.compose.volume=pocketbase_data" --format '{{.Name}}' | sort -u)
  data_bearing_volumes=()
  for candidate_volume in "${candidate_volumes[@]}"; do
    if volume_has_database "$candidate_volume"; then
      data_bearing_volumes+=("$candidate_volume")
    else
      probe_status=$?
      if (( probe_status == 2 )); then
        exit 1
      fi
    fi
  done

  if (( ${#data_bearing_volumes[@]} == 1 )); then
    data_volume_name="${data_bearing_volumes[0]}"
  elif (( ${#data_bearing_volumes[@]} > 1 )); then
    printf 'Multiple PocketBase data volumes were found: %s\n' "${data_bearing_volumes[*]}" >&2
    echo "Re-run with --data-volume and the correct volume." >&2
    exit 1
  fi
fi

export POCKETBASE_DATA_VOLUME="$data_volume_name"
echo "Using PocketBase data volume: $data_volume_name"
docker compose config --quiet

if docker volume inspect "$data_volume_name" >/dev/null 2>&1; then
  if [[ "$skip_backup" == "true" ]]; then
    echo "WARNING: proceeding without a pre-update database backup." >&2
  else
    backup_name="pre-update-$(date +%Y%m%d-%H%M%S).tar.gz"
    bash "$base_dir/scripts/backup-pocketbase.sh" "$backup_name"
  fi
else
  echo "No existing Checky Base data volume was found; this will be treated as a first installation."
fi

build_args=(compose build)
if [[ "$pull_images" == "true" ]]; then
  build_args+=(--pull)
fi
docker "${build_args[@]}"

docker compose up -d --no-build --remove-orphans

deadline=$(( $(date +%s) + health_timeout ))
while (( $(date +%s) < deadline )); do
  pocketbase_health="$(service_health pocketbase)"
  web_health="$(service_health web)"
  echo "PocketBase: $pocketbase_health; Web: $web_health"

  if [[ "$pocketbase_health" == "healthy" && "$web_health" == "healthy" ]]; then
    echo "Checky Base update completed successfully."
    exit 0
  fi

  case "$pocketbase_health:$web_health" in
    *unhealthy*|*exited*|*dead*)
      break
      ;;
  esac

  sleep 3
done

docker compose logs --no-color --tail 50 pocketbase web
echo "The updated Checky Base stack did not become healthy. The named database volume and pre-update backup were preserved." >&2
exit 1



