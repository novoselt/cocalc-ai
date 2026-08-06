#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID=${PROJECT_ID:-}
REGION=${REGION:-us-central1}
SA_NAME=${SA_NAME:-cocalc-compute-vm}
NETWORK=${NETWORK:-cocalc-compute-vm}
SUBNET=${SUBNET:-cocalc-compute-vm-${REGION}}
SUBNET_RANGE=${SUBNET_RANGE:-10.250.0.0/20}
NETWORK_TAG=${NETWORK_TAG:-cocalc-compute-vm}

if [[ -z "$PROJECT_ID" ]]; then
  echo "PROJECT_ID is required" >&2
  exit 1
fi

gcloud services enable compute.googleapis.com logging.googleapis.com monitoring.googleapis.com \
  --project "$PROJECT_ID"

gcloud compute networks describe "$NETWORK" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud compute networks create "$NETWORK" --project "$PROJECT_ID" --subnet-mode=custom

gcloud compute networks subnets describe "$SUBNET" --project "$PROJECT_ID" --region "$REGION" >/dev/null 2>&1 || \
  gcloud compute networks subnets create "$SUBNET" \
    --project "$PROJECT_ID" --region "$REGION" --network "$NETWORK" \
    --range "$SUBNET_RANGE" --enable-flow-logs \
    --logging-aggregation-interval=interval-5-sec \
    --logging-flow-sampling=1.0 --logging-metadata=include-all

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

KEY_FILE=$(mktemp)
trap 'rm -f "$KEY_FILE"' EXIT
gcloud iam service-accounts keys create "$KEY_FILE" \
  --project "$PROJECT_ID" --iam-account "$SA_EMAIL"

python3 - "$KEY_FILE" "$PROJECT_ID" "$REGION" "$SUBNET" <<'PY'
import json, sys
key_path, project, region, subnet = sys.argv[1:]
with open(key_path) as f:
    key = json.load(f)
payload = {
    "compute_vm_gcp_service_account_json": key,
    "compute_vm_gcp_subnetwork": f"projects/{project}/regions/{region}/subnetworks/{subnet}",
}
print("=== COCALC GCP CONFIG START ===")
print(json.dumps(payload, indent=2))
print("=== COCALC GCP CONFIG END ===")
PY

if [[ -n "${COCALC_SETUP_UPLOAD_URL:-}" && -n "${COCALC_SETUP_TOKEN:-}" ]]; then
  python3 - "$KEY_FILE" "$PROJECT_ID" "$REGION" "$SUBNET" <<'PY' | \
    curl -fsS -X POST -H "Authorization: Bearer ${COCALC_SETUP_TOKEN}" \
      -H 'Content-Type: application/json' --data-binary @- "$COCALC_SETUP_UPLOAD_URL"
import json, sys
key_path, project, region, subnet = sys.argv[1:]
with open(key_path) as f:
    key = json.load(f)
print(json.dumps({
    "compute_vm_gcp_service_account_json": key,
    "compute_vm_gcp_subnetwork": f"projects/{project}/regions/{region}/subnetworks/{subnet}",
}))
PY
fi
