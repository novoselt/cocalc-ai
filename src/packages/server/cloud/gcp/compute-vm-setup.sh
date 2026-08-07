#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID=${PROJECT_ID:-}
SA_NAME=${SA_NAME:-cocalc-compute-vm}
NETWORK=${NETWORK:-cocalc-compute-vm}
SUBNET_POOL=${SUBNET_POOL:-10.128.0.0/9}
SUBNET_PREFIX_LENGTH=${SUBNET_PREFIX_LENGTH:-20}
NETWORK_TAG=${NETWORK_TAG:-cocalc-compute-vm}
REGIONS=${REGIONS:-}

if [[ -z "$PROJECT_ID" ]]; then
  echo "PROJECT_ID is required" >&2
  exit 1
fi

gcloud services enable compute.googleapis.com logging.googleapis.com monitoring.googleapis.com \
  --project "$PROJECT_ID"

gcloud compute networks describe "$NETWORK" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud compute networks create "$NETWORK" --project "$PROJECT_ID" --subnet-mode=custom

TMP_DIR=$(mktemp -d)
KEY_FILE="$TMP_DIR/service-account.json"
trap 'rm -rf "$TMP_DIR"' EXIT

gcloud compute regions list --project "$PROJECT_ID" --format=json >"$TMP_DIR/regions.json"
gcloud compute networks subnets list --project "$PROJECT_ID" --format=json >"$TMP_DIR/subnets.json"

python3 - \
  "$TMP_DIR/regions.json" \
  "$TMP_DIR/subnets.json" \
  "$TMP_DIR/subnet-plan.tsv" \
  "$PROJECT_ID" \
  "$NETWORK" \
  "$SUBNET_POOL" \
  "$SUBNET_PREFIX_LENGTH" \
  "$REGIONS" <<'PY'
import ipaddress
import json
import re
import sys

(
    regions_path,
    subnets_path,
    plan_path,
    project,
    network,
    pool_text,
    prefix_text,
    requested_text,
) = sys.argv[1:]

with open(regions_path) as f:
    region_rows = json.load(f)
with open(subnets_path) as f:
    subnet_rows = json.load(f)

available = sorted(
    row["name"]
    for row in region_rows
    if row.get("name") and row.get("status", "UP") == "UP"
)
if requested_text.strip():
    requested = sorted(set(filter(None, re.split(r"[\s,]+", requested_text.strip()))))
    unavailable = sorted(set(requested) - set(available))
    if unavailable:
        raise SystemExit(f"requested GCP regions are not active: {', '.join(unavailable)}")
    regions = requested
else:
    regions = available
if not regions:
    raise SystemExit("GCP returned no active regions")

def resource_path(value):
    return re.sub(r"^https://[^/]+/compute/v1/", "", str(value or ""))

network_uri = f"projects/{project}/global/networks/{network}"
managed = []
used = []
for row in subnet_rows:
    if resource_path(row.get("network")) != network_uri:
        continue
    ip_range = row.get("ipCidrRange")
    if ip_range:
        used.append(ipaddress.ip_network(ip_range))
    managed.append(row)

by_name = {row.get("name"): row for row in managed if row.get("name")}
pool = ipaddress.ip_network(pool_text)
prefix = int(prefix_text)
if pool.version != 4 or prefix < pool.prefixlen or prefix > 29:
    raise SystemExit("SUBNET_POOL and SUBNET_PREFIX_LENGTH must define usable IPv4 subnets")

candidates = iter(pool.subnets(new_prefix=prefix))

def allocate():
    for candidate in candidates:
        if any(candidate.overlaps(existing) for existing in used):
            continue
        used.append(candidate)
        return candidate
    raise SystemExit(f"no unused /{prefix} remains in {pool}")

plan = []
for region in regions:
    name = f"{network}-{region}"
    existing = by_name.get(name)
    if existing:
        observed_region = resource_path(existing.get("region")).split("/")[-1]
        if observed_region != region:
            raise SystemExit(
                f"subnet {name} exists in {observed_region}, expected {region}"
            )
        cidr = ipaddress.ip_network(existing["ipCidrRange"])
        plan.append((region, name, str(cidr), "update"))
    else:
        plan.append((region, name, str(allocate()), "create"))

with open(plan_path, "w") as f:
    for row in plan:
        f.write("\t".join(row) + "\n")
print(f"Planned {len(plan)} regional subnets on {network_uri}.")
PY

while IFS=$'\t' read -r region subnet subnet_range action; do
  if [[ "$action" == "create" ]]; then
    echo "Creating $subnet in $region with $subnet_range"
    gcloud compute networks subnets create "$subnet" \
      --project "$PROJECT_ID" --region "$region" --network "$NETWORK" \
      --range "$subnet_range" --enable-flow-logs \
      --logging-aggregation-interval=interval-5-sec \
      --logging-flow-sampling=1.0 --logging-metadata=include-all
  else
    echo "Ensuring VPC Flow Logs are enabled for $subnet in $region"
    gcloud compute networks subnets update "$subnet" \
      --project "$PROJECT_ID" --region "$region" --enable-flow-logs \
      --logging-aggregation-interval=interval-5-sec \
      --logging-flow-sampling=1.0 --logging-metadata=include-all
  fi
done <"$TMP_DIR/subnet-plan.tsv"

gcloud compute firewall-rules describe cocalc-compute-ssh --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud compute firewall-rules create cocalc-compute-ssh \
    --project "$PROJECT_ID" --network "$NETWORK" --direction=INGRESS \
    --priority=1000 --action=ALLOW --rules=tcp:22 \
    --source-ranges=0.0.0.0/0 --target-tags="$NETWORK_TAG"

# Guests need the metadata endpoint for normal GCE boot, but cannot reach
# private VPC, peering, VPN, or link-local destinations.
gcloud compute firewall-rules describe cocalc-compute-metadata --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud compute firewall-rules create cocalc-compute-metadata \
    --project "$PROJECT_ID" --network "$NETWORK" --direction=EGRESS \
    --priority=800 --action=ALLOW --rules=all \
    --destination-ranges=169.254.169.254/32 --target-tags="$NETWORK_TAG"

gcloud compute firewall-rules describe cocalc-compute-deny-private --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud compute firewall-rules create cocalc-compute-deny-private \
    --project "$PROJECT_ID" --network "$NETWORK" --direction=EGRESS \
    --priority=900 --action=DENY --rules=all \
    --destination-ranges=0.0.0.0/8,10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.0.0.0/24,192.0.2.0/24,192.88.99.0/24,192.168.0.0/16,198.18.0.0/15,198.51.100.0/24,199.36.153.4/30,199.36.153.8/30,203.0.113.0/24,224.0.0.0/4,240.0.0.0/4 \
    --target-tags="$NETWORK_TAG"

gcloud compute firewall-rules describe cocalc-compute-public-egress --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud compute firewall-rules create cocalc-compute-public-egress \
    --project "$PROJECT_ID" --network "$NETWORK" --direction=EGRESS \
    --priority=1000 --action=ALLOW --rules=all \
    --destination-ranges=0.0.0.0/0 --target-tags="$NETWORK_TAG"

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT_ID" \
    --display-name="CoCalc managed compute VM controller"

for role in roles/compute.instanceAdmin.v1 roles/compute.networkUser roles/compute.networkViewer roles/monitoring.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" --role="$role" \
    --condition=None --quiet >/dev/null
done

gcloud iam service-accounts keys create "$KEY_FILE" \
  --project "$PROJECT_ID" --iam-account "$SA_EMAIL"

python3 - "$KEY_FILE" "$PROJECT_ID" "$NETWORK" <<'PY'
import json, sys
key_path, project, network = sys.argv[1:]
with open(key_path) as f:
    key = json.load(f)
payload = {
    "compute_vm_gcp_service_account_json": key,
    "compute_vm_gcp_network": f"projects/{project}/global/networks/{network}",
}
print("=== COCALC GCP CONFIG START ===")
print(json.dumps(payload, indent=2))
print("=== COCALC GCP CONFIG END ===")
PY

if [[ -n "${COCALC_SETUP_UPLOAD_URL:-}" && -n "${COCALC_SETUP_TOKEN:-}" ]]; then
  python3 - "$KEY_FILE" "$PROJECT_ID" "$NETWORK" <<'PY' | \
    curl -fsS -X POST -H "Authorization: Bearer ${COCALC_SETUP_TOKEN}" \
      -H 'Content-Type: application/json' --data-binary @- "$COCALC_SETUP_UPLOAD_URL"
import json, sys
key_path, project, network = sys.argv[1:]
with open(key_path) as f:
    key = json.load(f)
print(json.dumps({
    "compute_vm_gcp_service_account_json": key,
    "compute_vm_gcp_network": f"projects/{project}/global/networks/{network}",
}))
PY
fi
