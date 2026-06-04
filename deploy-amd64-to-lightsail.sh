#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load configuration/secrets from .env if present.
# Existing environment variables take precedence over values in .env.
if [ -f .env ]; then
    echo -e "${YELLOW}Loading configuration from .env...${NC}"
    while IFS= read -r line || [ -n "$line" ]; do
        # Trim leading whitespace
        line="${line#"${line%%[![:space:]]*}"}"
        # Skip blank lines and comments
        case "$line" in
            ''|'#'*) continue ;;
        esac
        key="${line%%=*}"
        val="${line#*=}"
        # Only set if not already defined in the environment
        if [ -z "${!key:-}" ]; then
            export "$key=$val"
        fi
    done < .env
fi

# Configuration
# Try to get region from AWS config, fallback to eu-central-1
CONFIGURED_REGION=$(aws configure get region 2>/dev/null || echo "")
# Remove availability zone suffix if present (e.g., eu-central-1a -> eu-central-1)
if [[ "$CONFIGURED_REGION" =~ ^([a-z]+-[a-z]+-[0-9]+)[a-z]$ ]]; then
    CONFIGURED_REGION="${BASH_REMATCH[1]}"
fi
AWS_REGION=${AWS_REGION:-${CONFIGURED_REGION:-eu-central-1}}
AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-}
ECR_REGISTRY_PREFIX="livescore"
LIGHTSAIL_SERVICE_NAME=${LIGHTSAIL_SERVICE_NAME:-livescore-app}

# Set AWS_DEFAULT_REGION to ensure AWS CLI uses the correct region
export AWS_DEFAULT_REGION=$AWS_REGION

echo -e "${GREEN}=== Build AMD64 Images and Deploy to Lightsail ===${NC}"
echo ""

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    exit 1
fi

# Verify AWS credentials are configured
echo -e "${YELLOW}Verifying AWS credentials...${NC}"
if ! aws sts get-caller-identity &>/dev/null; then
    echo -e "${RED}Error: AWS credentials are not configured or invalid${NC}"
    echo "Please configure AWS credentials using one of these methods:"
    echo "  1. Run 'aws configure'"
    echo "  2. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables"
    echo "  3. Use an IAM role (if running on EC2/Lambda)"
    exit 1
fi

# Get AWS account ID if not provided
if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo -e "${YELLOW}Getting AWS account ID from AWS CLI...${NC}"
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>&1)
    if [ $? -ne 0 ] || [ -z "$AWS_ACCOUNT_ID" ]; then
        echo -e "${RED}Error: Could not determine AWS account ID${NC}"
        echo "Error details: $AWS_ACCOUNT_ID"
        echo ""
        echo "Please either:"
        echo "  1. Set AWS_ACCOUNT_ID environment variable: export AWS_ACCOUNT_ID=123456789012"
        echo "  2. Ensure AWS credentials are properly configured: aws configure"
        exit 1
    fi
    echo -e "${GREEN}Found AWS Account ID: ${AWS_ACCOUNT_ID}${NC}"
else
    echo -e "${GREEN}Using provided AWS Account ID: ${AWS_ACCOUNT_ID}${NC}"
fi

# Set AWS region
export AWS_DEFAULT_REGION=$AWS_REGION
echo -e "${GREEN}Using AWS Region: ${AWS_REGION}${NC}"
echo ""

# ECR repository names (client is built into nginx, so no separate client repo needed)
REPOSITORIES=("${ECR_REGISTRY_PREFIX}-server" "${ECR_REGISTRY_PREFIX}-nginx")
ECR_BASE="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Function to create ECR repository if it doesn't exist
create_ecr_repo() {
    local repo_name=$1
    echo -e "${YELLOW}Checking ECR repository: ${repo_name}${NC}"
    
    if aws ecr describe-repositories --repository-names "$repo_name" --region "$AWS_REGION" &>/dev/null; then
        echo -e "${GREEN}Repository ${repo_name} already exists${NC}"
    else
        echo -e "${YELLOW}Creating ECR repository: ${repo_name}${NC}"
        aws ecr create-repository \
            --repository-name "$repo_name" \
            --region "$AWS_REGION" \
            --image-scanning-configuration scanOnPush=true \
            --encryption-configuration encryptionType=AES256
        echo -e "${GREEN}Repository ${repo_name} created${NC}"
    fi
}

# Function to authenticate Docker to ECR
authenticate_docker() {
    echo -e "${YELLOW}Authenticating Docker to ECR...${NC}"
    aws ecr get-login-password --region "$AWS_REGION" | \
        docker login --username AWS --password-stdin "$ECR_BASE"
    echo -e "${GREEN}Docker authenticated${NC}"
}

# Function to build, tag, and push image for amd64
build_and_push_amd64() {
    local image_name=$1
    local ecr_repo=$2
    local dockerfile=$3
    local build_args=${4:-""}
    
    local ecr_tag="${ECR_BASE}/${ecr_repo}:latest"
    
    echo ""
    echo -e "${GREEN}=== Building ${image_name} (linux/amd64) ===${NC}"
    
    # Build image for amd64 platform
    echo -e "${YELLOW}Building ${image_name} for linux/amd64...${NC}"
    if [ -n "$build_args" ]; then
        docker build --platform linux/amd64 -t "$ecr_tag" -f "$dockerfile" $build_args .
    else
        docker build --platform linux/amd64 -t "$ecr_tag" -f "$dockerfile" .
    fi
    
    # Push to ECR
    echo -e "${YELLOW}Pushing ${image_name} to ECR...${NC}"
    docker push "$ecr_tag"
    
    echo -e "${GREEN}✓ ${image_name} pushed successfully${NC}"
    echo "  Image: ${ecr_tag}"
}

# Create ECR repositories
echo -e "${GREEN}=== Creating ECR Repositories ===${NC}"
for repo in "${REPOSITORIES[@]}"; do
    create_ecr_repo "$repo"
done

# Authenticate Docker
echo ""
authenticate_docker

# Build and push images for amd64
echo ""
echo -e "${GREEN}=== Building and Pushing AMD64 Images ===${NC}"

# Nginx image (includes built client)
build_and_push_amd64 "livescore-nginx" "${ECR_REGISTRY_PREFIX}-nginx" "Dockerfile.nginx"

# Server image
build_and_push_amd64 "livescore-server" "${ECR_REGISTRY_PREFIX}-server" "Dockerfile.server"

echo ""
echo -e "${GREEN}=== Images Built and Pushed ===${NC}"
echo ""

# Deploy to Lightsail
echo -e "${GREEN}=== Deploying to Lightsail ===${NC}"
echo -e "${YELLOW}Creating container service deployment...${NC}"

# Render the deployment file: substitute account/region and inject secrets safely.
# Secret precedence: environment variable > value already on the live deployment > template.
# Reusing the live value prevents re-runs from silently wiping secrets, and the script
# refuses to deploy a placeholder GRAPHQL_API_KEY (see lightsail-deployment.json / .env.example).
TEMP_DEPLOYMENT_FILE=$(mktemp)
trap "rm -f $TEMP_DEPLOYMENT_FILE" EXIT

# Current live deployment (may be empty if the service does not exist yet).
LIVE_SERVICES_JSON=$(aws lightsail get-container-services \
    --service-name "$LIGHTSAIL_SERVICE_NAME" --region "$AWS_REGION" --output json 2>/dev/null || echo "")

if ! AWS_ACCOUNT_ID="$AWS_ACCOUNT_ID" AWS_REGION="$AWS_REGION" LIVE_SERVICES_JSON="$LIVE_SERVICES_JSON" \
    python3 - "$TEMP_DEPLOYMENT_FILE" <<'PYEOF'
import json, os, sys

out_path = sys.argv[1]
with open("lightsail-deployment.json") as f:
    raw = f.read()
raw = raw.replace("ACCOUNT_ID", os.environ["AWS_ACCOUNT_ID"]).replace("AWS_REGION", os.environ["AWS_REGION"])
dep = json.loads(raw)

# Env currently running on the live "api" container, if the service exists.
live_env = {}
live_raw = os.environ.get("LIVE_SERVICES_JSON", "").strip()
if live_raw:
    try:
        svcs = json.loads(live_raw).get("containerServices", [])
        if svcs:
            cur = svcs[0].get("currentDeployment") or {}
            live_env = (cur.get("containers", {}).get("api", {}) or {}).get("environment", {}) or {}
    except Exception:
        live_env = {}

SECRETS = [
    "GRAPHQL_API_KEY",
    "GRAPHQL_AUTH_TOKEN",
    "GRAPHQL_SESSION_COOKIE",
    "GRAPHQL_AUTH_USERNAME",
    "GRAPHQL_AUTH_PASSWORD",
]
PLACEHOLDERS = {"", "SET_ME"}

api_env = dep["containers"]["api"]["environment"]
sources = {}
for key in SECRETS:
    env_val = os.environ.get(key, "")
    if env_val:
        api_env[key] = env_val
        sources[key] = "env"
    elif live_env.get(key):
        api_env[key] = live_env[key]
        sources[key] = "live"
    else:
        sources[key] = "template"

if api_env.get("GRAPHQL_API_KEY", "") in PLACEHOLDERS:
    sys.stderr.write(
        "\nERROR: GRAPHQL_API_KEY is not set and no value exists on the live service.\n"
        "Provide it via the environment or a .env file, e.g.:\n"
        "  export GRAPHQL_API_KEY=your-ssi-api-key\n"
        "or add it to .env (see .env.example), then re-run.\n\n"
    )
    sys.exit(1)

with open(out_path, "w") as f:
    json.dump(dep, f)

# Report sources without revealing secret values.
print("Secret resolution (source | length):")
for key in SECRETS:
    print(f"  {key}: {sources[key]} | {len(api_env.get(key, ''))} chars")
PYEOF
then
    echo -e "${RED}✗ Failed to render deployment configuration${NC}"
    exit 1
fi

if aws lightsail create-container-service-deployment \
    --service-name "$LIGHTSAIL_SERVICE_NAME" \
    --cli-input-json "file://${TEMP_DEPLOYMENT_FILE}" \
    --region "$AWS_REGION" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Deployment initiated successfully${NC}"
    echo ""
    echo "Deployment is in progress. You can check the status with:"
    echo "  aws lightsail get-container-services --region $AWS_REGION"
    echo ""
    echo "Or use the status check script:"
    echo "  ./check-lightsail-status.sh"
else
    # Check if deployment is already in progress
    DEPLOYMENT_STATUS=$(aws lightsail get-container-services --region "$AWS_REGION" --output json 2>/dev/null | \
        python3 -c "import sys, json; data = json.load(sys.stdin); svc = [s for s in data['containerServices'] if s['containerServiceName'] == '$LIGHTSAIL_SERVICE_NAME'][0]; print(svc.get('state', 'UNKNOWN') + '|' + svc.get('nextDeployment', {}).get('state', 'N/A'))" 2>/dev/null || echo "UNKNOWN|N/A")
    
    STATE=$(echo "$DEPLOYMENT_STATUS" | cut -d'|' -f1)
    NEXT_DEPLOY=$(echo "$DEPLOYMENT_STATUS" | cut -d'|' -f2)
    
    if [ "$NEXT_DEPLOY" = "ACTIVATING" ] || [ "$STATE" = "DEPLOYING" ]; then
        echo -e "${YELLOW}⚠ Deployment is already in progress${NC}"
        echo "  Current state: $STATE"
        echo "  Next deployment: $NEXT_DEPLOY"
        echo ""
        echo "Please wait for the current deployment to complete before deploying again."
    else
        echo -e "${RED}✗ Failed to create deployment${NC}"
        echo "Check the error message above for details."
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "ECR Image URIs:"
echo "  Nginx:  ${ECR_BASE}/${ECR_REGISTRY_PREFIX}-nginx:latest (includes client)"
echo "  Server: ${ECR_BASE}/${ECR_REGISTRY_PREFIX}-server:latest"
echo ""
echo "Service URL:"
SERVICE_URL=$(aws lightsail get-container-services --region "$AWS_REGION" --output json 2>/dev/null | \
    python3 -c "import sys, json; data = json.load(sys.stdin); svc = [s for s in data['containerServices'] if s['containerServiceName'] == '$LIGHTSAIL_SERVICE_NAME'][0]; print(svc.get('url', 'N/A'))" 2>/dev/null || echo "N/A")
echo "  $SERVICE_URL"
