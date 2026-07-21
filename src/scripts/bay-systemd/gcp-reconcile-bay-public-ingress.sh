#!/usr/bin/env bash
set -euo pipefail

GCP_PROJECT=""
ZONE=""
REGION=""
INSTANCE=""
HOSTNAME=""
RESOURCE_PREFIX=""
NETWORK="default"
PROXY_SUBNET=""
PROXY_SUBNET_RANGE=""
BACKEND_PORT=9400
TEST_SOURCE_CIDR=""
CLOUDFLARE_TOKEN_FILE=""
APPLY=0
ALLOW_NON_STAGING=0

usage() {
  cat <<'EOF'
Usage: gcp-reconcile-bay-public-ingress.sh [options]

Provision the GCP side of a regional Standard Tier HTTPS ingress for one bay.
The load balancer remains behind Cloudflare's normal orange-cloud proxy, but
does not use Cloudflare Tunnel. By default this command only prints changes.

Required:
  --gcp-project <project>       GCP project id
  --zone <zone>                 backend VM zone
  --instance <name>             backend bay VM
  --hostname <hostname>         exact public hostname
  --resource-prefix <prefix>    unique GCP resource prefix

Networking:
  --network <network>           VPC network, default: default
  --proxy-subnet <name>         proxy-only subnet name; default derives from region
  --proxy-subnet-range <cidr>   required when the proxy-only subnet does not exist
  --backend-port <port>         bay frontdoor port, default: 9400
  --test-source-cidr <cidr>     temporarily allow one non-Cloudflare test source
  --cloudflare-token-file <p>   reconcile an exact-host Cloudflare SSL rule;
                                requires Zone > Config Rules > Edit

Control:
  --apply                       create/update resources
  --allow-non-staging           bypass staging hostname and VM-label guards
  -h, --help                    show this help

The script intentionally does not mutate Cloudflare DNS. With a Cloudflare
token it reconciles only the exact-host ssl=full configuration override needed
when the zone default is flexible. It prints the Certificate Manager CNAME
authorization and reserved load-balancer IP. Add the CNAME first, wait for the
certificate to become ACTIVE, test with --resolve and --test-source-cidr, and
only then replace the exact hostname's Cloudflare record with a proxied A
record.
EOF
}

log() {
  printf '[gcp-bay-public-ingress] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

run() {
  if [[ "$APPLY" -eq 1 ]]; then
    log "+ $*"
    "$@"
  else
    printf '[plan] ' >&2
    printf '%q ' "$@" >&2
    printf '\n' >&2
  fi
}

exists() {
  "$@" >/dev/null 2>&1
}

wait_until_exists() {
  local description="$1"
  shift
  local attempt
  for attempt in {1..20}; do
    if exists "$@"; then
      return 0
    fi
    sleep 3
  done
  die "timed out waiting for ${description} to become visible"
}

dns_authorization_is_ready() {
  local authorization="$1"
  local authorization_json name expected response actual
  authorization_json="$(gcloud certificate-manager dns-authorizations describe \
    "$authorization" --project "$GCP_PROJECT" --location "$REGION" \
    --format=json 2>/dev/null)" || return 1
  name="$(jq -r '.dnsResourceRecord.name // empty' <<<"$authorization_json")"
  expected="$(jq -r '.dnsResourceRecord.data // empty' <<<"$authorization_json")"
  [[ -n "$name" && -n "$expected" ]] || return 1
  response="$(curl -fsS --get --max-time 15 \
    --data-urlencode "name=${name%.}" --data-urlencode 'type=CNAME' \
    https://dns.google/resolve 2>/dev/null)" || return 1
  actual="$(jq -r '.Answer[]? | select(.type == 5) | .data' \
    <<<"$response" | head -1)"
  actual="${actual%.}"
  expected="${expected%.}"
  [[ "${actual,,}" == "${expected,,}" ]]
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --gcp-project)
        GCP_PROJECT="$2"
        shift 2
        ;;
      --zone)
        ZONE="$2"
        shift 2
        ;;
      --instance)
        INSTANCE="$2"
        shift 2
        ;;
      --hostname)
        HOSTNAME="$2"
        shift 2
        ;;
      --resource-prefix)
        RESOURCE_PREFIX="$2"
        shift 2
        ;;
      --network)
        NETWORK="$2"
        shift 2
        ;;
      --proxy-subnet)
        PROXY_SUBNET="$2"
        shift 2
        ;;
      --proxy-subnet-range)
        PROXY_SUBNET_RANGE="$2"
        shift 2
        ;;
      --backend-port)
        BACKEND_PORT="$2"
        shift 2
        ;;
      --test-source-cidr)
        TEST_SOURCE_CIDR="$2"
        shift 2
        ;;
      --cloudflare-token-file)
        CLOUDFLARE_TOKEN_FILE="$2"
        shift 2
        ;;
      --apply)
        APPLY=1
        shift
        ;;
      --allow-non-staging)
        ALLOW_NON_STAGING=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done
}

validate() {
  require_command curl
  require_command gcloud
  require_command jq

  [[ -n "$GCP_PROJECT" ]] || die "--gcp-project is required"
  [[ -n "$ZONE" ]] || die "--zone is required"
  [[ -n "$INSTANCE" ]] || die "--instance is required"
  [[ -n "$HOSTNAME" ]] || die "--hostname is required"
  [[ -n "$RESOURCE_PREFIX" ]] || die "--resource-prefix is required"
  [[ "$RESOURCE_PREFIX" =~ ^[a-z][a-z0-9-]{1,40}[a-z0-9]$ ]] ||
    die "--resource-prefix must be a short lowercase GCP resource prefix"
  [[ "$BACKEND_PORT" =~ ^[0-9]+$ ]] || die "--backend-port must be numeric"
  (( BACKEND_PORT >= 1 && BACKEND_PORT <= 65535 )) ||
    die "--backend-port must be between 1 and 65535"
  if [[ -n "$CLOUDFLARE_TOKEN_FILE" ]]; then
    [[ -r "$CLOUDFLARE_TOKEN_FILE" ]] ||
      die "Cloudflare token file is not readable: $CLOUDFLARE_TOKEN_FILE"
    [[ -n "$(< "$CLOUDFLARE_TOKEN_FILE")" ]] ||
      die "Cloudflare token file is empty: $CLOUDFLARE_TOKEN_FILE"
  fi

  REGION="${ZONE%-*}"
  [[ "$REGION" != "$ZONE" ]] || die "could not derive region from zone: $ZONE"
  if [[ -z "$PROXY_SUBNET" ]]; then
    PROXY_SUBNET="cocalc-regional-proxy-${REGION}"
  fi

  exists gcloud compute instances describe "$INSTANCE" \
    --project "$GCP_PROJECT" --zone "$ZONE" ||
    die "backend instance does not exist: $INSTANCE"

  if [[ "$ALLOW_NON_STAGING" -ne 1 ]]; then
    [[ "$HOSTNAME" == staging.* ]] ||
      die "refusing non-staging hostname without --allow-non-staging"
    local site_label
    site_label="$(gcloud compute instances describe "$INSTANCE" \
      --project "$GCP_PROJECT" --zone "$ZONE" \
      --format='value(labels.site)')"
    [[ "$site_label" == "staging" ]] ||
      die "refusing VM without site=staging label: $INSTANCE"
  fi

  local instance_network
  instance_network="$(gcloud compute instances describe "$INSTANCE" \
    --project "$GCP_PROJECT" --zone "$ZONE" \
    --format='value(networkInterfaces[0].network.basename())')"
  [[ "$instance_network" == "$NETWORK" ]] ||
    die "VM network is $instance_network, not requested network $NETWORK"
}

ensure_api() {
  local api="$1"
  if gcloud services list --enabled --project "$GCP_PROJECT" \
    --filter="config.name=${api}" --format='value(config.name)' | grep -qx "$api"; then
    return
  fi
  run gcloud services enable "$api" --project "$GCP_PROJECT" --quiet
}

ensure_proxy_subnet() {
  if exists gcloud compute networks subnets describe "$PROXY_SUBNET" \
    --project "$GCP_PROJECT" --region "$REGION"; then
    local purpose role network
    purpose="$(gcloud compute networks subnets describe "$PROXY_SUBNET" \
      --project "$GCP_PROJECT" --region "$REGION" --format='value(purpose)')"
    role="$(gcloud compute networks subnets describe "$PROXY_SUBNET" \
      --project "$GCP_PROJECT" --region "$REGION" --format='value(role)')"
    network="$(gcloud compute networks subnets describe "$PROXY_SUBNET" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --format='value(network.basename())')"
    [[ "$purpose" == "REGIONAL_MANAGED_PROXY" && "$role" == "ACTIVE" ]] ||
      die "existing subnet $PROXY_SUBNET is not an active proxy-only subnet"
    [[ "$network" == "$NETWORK" ]] ||
      die "existing proxy subnet is on network $network, not $NETWORK"
    return
  fi
  [[ -n "$PROXY_SUBNET_RANGE" ]] ||
    die "--proxy-subnet-range is required to create $PROXY_SUBNET"
  run gcloud compute networks subnets create "$PROXY_SUBNET" \
    --project "$GCP_PROJECT" \
    --region "$REGION" \
    --network "$NETWORK" \
    --range "$PROXY_SUBNET_RANGE" \
    --purpose REGIONAL_MANAGED_PROXY \
    --role ACTIVE \
    --quiet
}

ensure_instance_group() {
  local group="${RESOURCE_PREFIX}-ig"
  if ! exists gcloud compute instance-groups unmanaged describe "$group" \
    --project "$GCP_PROJECT" --zone "$ZONE"; then
    run gcloud compute instance-groups unmanaged create "$group" \
      --project "$GCP_PROJECT" --zone "$ZONE" --quiet
  fi
  if ! gcloud compute instance-groups unmanaged list-instances "$group" \
    --project "$GCP_PROJECT" --zone "$ZONE" \
    --format='value(instance.basename())' 2>/dev/null | grep -qx "$INSTANCE"; then
    run gcloud compute instance-groups unmanaged add-instances "$group" \
      --project "$GCP_PROJECT" --zone "$ZONE" \
      --instances "$INSTANCE" --quiet
  fi
  run gcloud compute instance-groups unmanaged set-named-ports "$group" \
    --project "$GCP_PROJECT" --zone "$ZONE" \
    --named-ports="http:${BACKEND_PORT}" --quiet
}

ensure_backend_firewall() {
  local tag="${RESOURCE_PREFIX}-backend"
  local allow_rule="${RESOURCE_PREFIX}-allow-lb"
  local deny_rule="${RESOURCE_PREFIX}-deny-direct"
  local proxy_range
  proxy_range="$(gcloud compute networks subnets describe "$PROXY_SUBNET" \
    --project "$GCP_PROJECT" --region "$REGION" \
    --format='value(ipCidrRange)' 2>/dev/null || true)"
  if [[ -z "$proxy_range" && "$APPLY" -eq 0 ]]; then
    proxy_range="$PROXY_SUBNET_RANGE"
  fi
  [[ -n "$proxy_range" ]] || die "could not determine proxy-only subnet range"

  run gcloud compute instances add-tags "$INSTANCE" \
    --project "$GCP_PROJECT" --zone "$ZONE" --tags "$tag" --quiet

  if ! exists gcloud compute firewall-rules describe "$allow_rule" \
    --project "$GCP_PROJECT"; then
    run gcloud compute firewall-rules create "$allow_rule" \
      --project "$GCP_PROJECT" --network "$NETWORK" \
      --direction INGRESS --priority 900 --action ALLOW \
      --rules="tcp:${BACKEND_PORT}" \
      --source-ranges="${proxy_range},130.211.0.0/22,35.191.0.0/16" \
      --target-tags "$tag" \
      --description "Regional HTTPS LB proxies and health checks to ${HOSTNAME}" \
      --quiet
  fi
  if ! exists gcloud compute firewall-rules describe "$deny_rule" \
    --project "$GCP_PROJECT"; then
    run gcloud compute firewall-rules create "$deny_rule" \
      --project "$GCP_PROJECT" --network "$NETWORK" \
      --direction INGRESS --priority 1000 --action DENY \
      --rules="tcp:${BACKEND_PORT}" --source-ranges="0.0.0.0/0" \
      --target-tags "$tag" \
      --description "Prevent direct access to ${HOSTNAME} bay frontdoor" \
      --quiet
  fi
}

cloudflare_ranges() {
  curl -fsS --max-time 15 https://api.cloudflare.com/client/v4/ips |
    jq -r 'if .success then .result.ipv4_cidrs[], .result.ipv6_cidrs[] else error("Cloudflare IP lookup failed") end'
}

cloudflare_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local token response http_status
  token="$(< "$CLOUDFLARE_TOKEN_FILE")"
  local args=(
    -sS
    -X "$method"
    -H "Authorization: Bearer $token"
    -H "Content-Type: application/json"
  )
  if [[ -n "$body" ]]; then
    args+=(--data "$body")
  fi
  response="$(curl "${args[@]}" -w $'\n%{http_code}' \
    "https://api.cloudflare.com/client/v4/${path}")" ||
    die "Cloudflare API request failed: $method /$path"
  http_status="${response##*$'\n'}"
  response="${response%$'\n'*}"
  if [[ ! "$http_status" =~ ^2[0-9][0-9]$ ]] ||
    ! jq -e '.success == true' <<<"$response" >/dev/null 2>&1; then
    local errors
    errors="$(jq -c '.errors // []' <<<"$response" 2>/dev/null || true)"
    die "Cloudflare API rejected $method /$path (HTTP ${http_status}): ${errors:-invalid response}"
  fi
  jq -c '.result' <<<"$response"
}

ensure_cloudflare_ssl_rule() {
  if [[ -z "$CLOUDFLARE_TOKEN_FILE" ]]; then
    log "WARNING: no Cloudflare token; exact-host ssl=full rule was not reconciled"
    return
  fi

  local zones zone_id
  zones="$(cloudflare_request GET "zones?per_page=50")"
  zone_id="$(jq -r --arg hostname "$HOSTNAME" '
    [ .[]
      | .name as $name
      | select($hostname == $name or ($hostname | endswith("." + $name)))
    ]
    | sort_by(.name | length)
    | last
    | .id // empty
  ' <<<"$zones")"
  [[ -n "$zone_id" ]] || die "Cloudflare zone not found for $HOSTNAME"

  local ref description expression rule_payload rulesets ruleset_id
  ref="cocalc_bay_direct_tls_${RESOURCE_PREFIX//-/_}"
  description="CoCalc bay direct HTTPS ingress for ${HOSTNAME}"
  expression="(http.host eq \"${HOSTNAME}\")"
  rule_payload="$(jq -nc \
    --arg ref "$ref" \
    --arg description "$description" \
    --arg expression "$expression" \
    '{ref:$ref, description:$description, expression:$expression,
      action:"set_config", action_parameters:{ssl:"full"}, enabled:true}')"
  rulesets="$(cloudflare_request GET "zones/${zone_id}/rulesets")"
  ruleset_id="$(jq -r '
    .[] | select(.kind == "zone" and .phase == "http_config_settings") | .id
  ' <<<"$rulesets" | head -1)"

  if [[ -z "$ruleset_id" ]]; then
    if [[ "$APPLY" -eq 0 ]]; then
      log "[plan] create Cloudflare http_config_settings ruleset with $ref"
      return
    fi
    local ruleset_payload
    ruleset_payload="$(jq -nc --argjson rule "$rule_payload" '
      {name:"CoCalc bay configuration",
       description:"Configuration overrides for direct CoCalc bay ingress",
       kind:"zone", phase:"http_config_settings", rules:[$rule]}')"
    ruleset_id="$(cloudflare_request POST "zones/${zone_id}/rulesets" \
      "$ruleset_payload" | jq -r '.id')"
  else
    local rules existing_rule_id matches
    rules="$(cloudflare_request GET "zones/${zone_id}/rulesets/${ruleset_id}")"
    existing_rule_id="$(jq -r --arg ref "$ref" \
      '.rules[]? | select(.ref == $ref) | .id' <<<"$rules" | head -1)"
    matches="$(jq -r --arg ref "$ref" --arg description "$description" \
      --arg expression "$expression" '
      any(.rules[]?;
        .ref == $ref and
        .description == $description and
        .expression == $expression and
        .action == "set_config" and
        .action_parameters.ssl == "full" and
        .enabled == true)
    ' <<<"$rules")"
    if [[ "$matches" != "true" ]]; then
      if [[ "$APPLY" -eq 0 ]]; then
        log "[plan] reconcile Cloudflare exact-host ssl=full rule $ref"
        return
      elif [[ -n "$existing_rule_id" ]]; then
        cloudflare_request PATCH \
          "zones/${zone_id}/rulesets/${ruleset_id}/rules/${existing_rule_id}" \
          "$rule_payload" >/dev/null
      else
        cloudflare_request POST "zones/${zone_id}/rulesets/${ruleset_id}/rules" \
          "$rule_payload" >/dev/null
      fi
    fi
  fi

  if [[ "$APPLY" -eq 1 ]]; then
    local verified
    verified="$(cloudflare_request GET "zones/${zone_id}/rulesets/${ruleset_id}")"
    jq -e --arg ref "$ref" --arg expression "$expression" '
      any(.rules[]?;
        .ref == $ref and
        .expression == $expression and
        .action == "set_config" and
        .action_parameters.ssl == "full" and
        .enabled == true)
    ' <<<"$verified" >/dev/null ||
      die "Cloudflare exact-host SSL rule verification failed"
    log "verified Cloudflare exact-host ssl=full rule: $ref"
  fi
}

ensure_armor_rule() {
  local policy="$1"
  local priority="$2"
  local ranges="$3"
  local description="$4"
  if exists gcloud compute security-policies rules describe "$priority" \
    --project "$GCP_PROJECT" --region "$REGION" \
    --security-policy "$policy"; then
    run gcloud compute security-policies rules update "$priority" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --security-policy "$policy" \
      --action allow --src-ip-ranges "$ranges" \
      --description "$description" --quiet
  else
    run gcloud compute security-policies rules create "$priority" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --security-policy "$policy" \
      --action allow --src-ip-ranges "$ranges" \
      --description "$description" --quiet
  fi
}

ensure_cloud_armor() {
  local policy="${RESOURCE_PREFIX}-cloudflare"
  if ! exists gcloud compute security-policies describe "$policy" \
    --project "$GCP_PROJECT" --region "$REGION"; then
    run gcloud compute security-policies create "$policy" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --description "Allow Cloudflare only for ${HOSTNAME}" --quiet
  fi

  local cidrs=()
  mapfile -t cidrs < <(cloudflare_ranges)
  [[ "${#cidrs[@]}" -gt 0 ]] || die "Cloudflare returned no IP ranges"
  local priority=100 index=0 chunk=()
  while (( index < ${#cidrs[@]} )); do
    chunk=("${cidrs[@]:index:10}")
    ensure_armor_rule "$policy" "$priority" \
      "$(IFS=,; printf '%s' "${chunk[*]}")" \
      "Cloudflare edge ranges $((index + 1))-$((index + ${#chunk[@]}))"
    index=$((index + 10))
    priority=$((priority + 10))
  done

  if [[ -n "$TEST_SOURCE_CIDR" ]]; then
    ensure_armor_rule "$policy" 90 "$TEST_SOURCE_CIDR" \
      "Temporary direct ingress validation source"
  elif exists gcloud compute security-policies rules describe 90 \
    --project "$GCP_PROJECT" --region "$REGION" \
    --security-policy "$policy"; then
    run gcloud compute security-policies rules delete 90 \
      --project "$GCP_PROJECT" --region "$REGION" \
      --security-policy "$policy" --quiet
  fi

  if exists gcloud compute security-policies rules describe 2147483647 \
    --project "$GCP_PROJECT" --region "$REGION" \
    --security-policy "$policy"; then
    run gcloud compute security-policies rules update 2147483647 \
      --project "$GCP_PROJECT" --region "$REGION" \
      --security-policy "$policy" \
      --action deny-403 --description "Deny non-Cloudflare traffic" --quiet
  fi
}

ensure_health_check() {
  local health="${RESOURCE_PREFIX}-health"
  if exists gcloud compute health-checks describe "$health" \
    --project "$GCP_PROJECT" --region "$REGION"; then
    run gcloud compute health-checks update http "$health" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --port "$BACKEND_PORT" \
      --request-path /_cocalc/frontdoor/healthz \
      --check-interval 10s --timeout 5s \
      --healthy-threshold 2 --unhealthy-threshold 3 --quiet
  else
    run gcloud compute health-checks create http "$health" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --port "$BACKEND_PORT" \
      --request-path /_cocalc/frontdoor/healthz \
      --check-interval 10s --timeout 5s \
      --healthy-threshold 2 --unhealthy-threshold 3 --quiet
  fi
}

ensure_backend_service() {
  local backend="${RESOURCE_PREFIX}-backend"
  local health="${RESOURCE_PREFIX}-health"
  local group="${RESOURCE_PREFIX}-ig"
  local policy="${RESOURCE_PREFIX}-cloudflare"
  if exists gcloud compute backend-services describe "$backend" \
    --project "$GCP_PROJECT" --region "$REGION"; then
    run gcloud compute backend-services update "$backend" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --protocol HTTP --port-name http --health-checks "$health" \
      --health-checks-region "$REGION" \
      --timeout 604800s --enable-logging --logging-sample-rate 1.0 --quiet
  else
    run gcloud compute backend-services create "$backend" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --load-balancing-scheme EXTERNAL_MANAGED \
      --protocol HTTP --port-name http --health-checks "$health" \
      --health-checks-region "$REGION" \
      --timeout 604800s --enable-logging --logging-sample-rate 1.0 --quiet
  fi
  run gcloud compute backend-services update "$backend" \
    --project "$GCP_PROJECT" --region "$REGION" \
    --security-policy "$policy" --quiet
  if ! gcloud compute backend-services describe "$backend" \
    --project "$GCP_PROJECT" --region "$REGION" --format=json 2>/dev/null |
    jq -e --arg group "/instanceGroups/${group}" \
      'any(.backends[]?; .group | endswith($group))' >/dev/null; then
    run gcloud compute backend-services add-backend "$backend" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --instance-group "$group" --instance-group-zone "$ZONE" \
      --balancing-mode UTILIZATION --max-utilization 0.8 \
      --capacity-scaler 1.0 --quiet
  fi
}

ensure_certificate() {
  local authorization="${RESOURCE_PREFIX}-auth"
  local certificate="${RESOURCE_PREFIX}-cert"
  if ! exists gcloud certificate-manager dns-authorizations describe "$authorization" \
    --project "$GCP_PROJECT" --location "$REGION"; then
    if [[ "$APPLY" -eq 1 ]]; then
      log "+ gcloud certificate-manager dns-authorizations create $authorization"
      gcloud certificate-manager dns-authorizations create "$authorization" \
        --project "$GCP_PROJECT" --location "$REGION" \
        --domain "$HOSTNAME" --quiet || true
      wait_until_exists "DNS authorization $authorization" \
        gcloud certificate-manager dns-authorizations describe "$authorization" \
        --project "$GCP_PROJECT" --location "$REGION"
    else
      run gcloud certificate-manager dns-authorizations create "$authorization" \
        --project "$GCP_PROJECT" --location "$REGION" \
        --domain "$HOSTNAME" --quiet
      log "apply the planned DNS authorization before creating the certificate"
      return
    fi
  fi
  if ! dns_authorization_is_ready "$authorization"; then
    log "DNS authorization CNAME is not publicly ready; skipping certificate creation"
    return
  fi
  if ! exists gcloud certificate-manager certificates describe "$certificate" \
    --project "$GCP_PROJECT" --location "$REGION"; then
    if [[ "$APPLY" -eq 1 ]]; then
      log "+ gcloud certificate-manager certificates create $certificate"
      gcloud certificate-manager certificates create "$certificate" \
        --project "$GCP_PROJECT" --location "$REGION" \
        --domains "$HOSTNAME" --dns-authorizations "$authorization" --quiet || true
      wait_until_exists "certificate $certificate" \
        gcloud certificate-manager certificates describe "$certificate" \
        --project "$GCP_PROJECT" --location "$REGION"
    else
      run gcloud certificate-manager certificates create "$certificate" \
        --project "$GCP_PROJECT" --location "$REGION" \
        --domains "$HOSTNAME" --dns-authorizations "$authorization" --quiet
    fi
  fi
}

ensure_frontend() {
  local address="${RESOURCE_PREFIX}-ip"
  local backend="${RESOURCE_PREFIX}-backend"
  local url_map="${RESOURCE_PREFIX}-url-map"
  local certificate="${RESOURCE_PREFIX}-cert"
  local proxy="${RESOURCE_PREFIX}-https-proxy"
  local forwarding="${RESOURCE_PREFIX}-https"

  if ! exists gcloud compute addresses describe "$address" \
    --project "$GCP_PROJECT" --region "$REGION"; then
    run gcloud compute addresses create "$address" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --network-tier STANDARD --quiet
  fi
  if exists gcloud compute url-maps describe "$url_map" \
    --project "$GCP_PROJECT" --region "$REGION"; then
    run gcloud compute url-maps set-default-service "$url_map" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --default-service "$backend" --quiet
  else
    run gcloud compute url-maps create "$url_map" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --default-service "$backend" --quiet
  fi

  if ! exists gcloud certificate-manager certificates describe "$certificate" \
    --project "$GCP_PROJECT" --location "$REGION"; then
    log "certificate does not exist yet; reserving frontend resources without an HTTPS proxy"
    return
  fi

  if exists gcloud compute target-https-proxies describe "$proxy" \
    --project "$GCP_PROJECT" --region "$REGION"; then
    run gcloud compute target-https-proxies update "$proxy" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --url-map "$url_map" --url-map-region "$REGION" \
      --certificate-manager-certificates "$certificate" --quiet
  else
    run gcloud compute target-https-proxies create "$proxy" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --url-map "$url_map" --url-map-region "$REGION" \
      --certificate-manager-certificates "$certificate" --quiet
  fi
  if ! exists gcloud compute forwarding-rules describe "$forwarding" \
    --project "$GCP_PROJECT" --region "$REGION"; then
    run gcloud compute forwarding-rules create "$forwarding" \
      --project "$GCP_PROJECT" --region "$REGION" \
      --load-balancing-scheme EXTERNAL_MANAGED \
      --network "$NETWORK" --network-tier STANDARD --address "$address" \
      --target-https-proxy "$proxy" --target-https-proxy-region "$REGION" \
      --ports 443 --quiet
  fi
}

print_status() {
  local authorization="${RESOURCE_PREFIX}-auth"
  local certificate="${RESOURCE_PREFIX}-cert"
  local address="${RESOURCE_PREFIX}-ip"
  local backend="${RESOURCE_PREFIX}-backend"
  printf '\n'
  log "staging direct-ingress status"
  gcloud compute addresses describe "$address" \
    --project "$GCP_PROJECT" --region "$REGION" \
    --format='yaml(name,address,networkTier,status)' 2>/dev/null || true
  gcloud certificate-manager dns-authorizations describe "$authorization" \
    --project "$GCP_PROJECT" --location "$REGION" \
    --format='yaml(dnsResourceRecord)' 2>/dev/null || true
  gcloud certificate-manager certificates describe "$certificate" \
    --project "$GCP_PROJECT" --location "$REGION" \
    --format='yaml(name,managed.state,managed.authorizationAttemptInfo)' \
    2>/dev/null || true
  gcloud compute backend-services get-health "$backend" \
    --project "$GCP_PROJECT" --region "$REGION" --format=json \
    2>/dev/null | jq -c '[.[].status.healthStatus[]? | {instance,healthState}]' || true
}

main() {
  parse_args "$@"
  validate
  ensure_api compute.googleapis.com
  ensure_api certificatemanager.googleapis.com
  ensure_cloudflare_ssl_rule
  ensure_proxy_subnet
  ensure_instance_group
  ensure_backend_firewall
  ensure_cloud_armor
  ensure_health_check
  ensure_backend_service
  ensure_certificate
  ensure_frontend
  if [[ "$APPLY" -eq 1 ]]; then
    print_status
  fi
}

main "$@"
