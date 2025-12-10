#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

AWS_REGION=${AWS_REGION:-eu-central-1}
SERVICE_NAME=${SERVICE_NAME:-livescore-app}

echo -e "${GREEN}=== Lightsail Container Service Status ===${NC}"
echo ""

# Get service status
STATUS=$(aws lightsail get-container-services --region "$AWS_REGION" --query "containerServices[?containerServiceName=='$SERVICE_NAME']" --output json 2>/dev/null)

if [ -z "$STATUS" ] || [ "$STATUS" == "[]" ]; then
    echo -e "${YELLOW}Service '$SERVICE_NAME' not found${NC}"
    exit 1
fi

# Parse status
STATE=$(echo "$STATUS" | python3 -c "import sys, json; data=json.load(sys.stdin)[0]; print(data['state'])")
STATE_DETAIL=$(echo "$STATUS" | python3 -c "import sys, json; data=json.load(sys.stdin)[0]; print(data.get('stateDetail', {}).get('code', 'N/A'))")
URL=$(echo "$STATUS" | python3 -c "import sys, json; data=json.load(sys.stdin)[0]; print(data.get('url', 'N/A'))")
CURRENT_DEPLOYMENT=$(echo "$STATUS" | python3 -c "import sys, json; data=json.load(sys.stdin)[0]; print(data.get('currentDeployment', {}).get('state', 'None') if data.get('currentDeployment') else 'None')")
NEXT_DEPLOYMENT=$(echo "$STATUS" | python3 -c "import sys, json; data=json.load(sys.stdin)[0]; print(data.get('nextDeployment', {}).get('state', 'None') if data.get('nextDeployment') else 'None')")

echo "Service Name: $SERVICE_NAME"
echo "State: $STATE"
echo "State Detail: $STATE_DETAIL"
echo "Current Deployment: $CURRENT_DEPLOYMENT"
echo "Next Deployment: $NEXT_DEPLOYMENT"
echo "URL: $URL"
echo ""

# Test URL if service is running
if [ "$STATE" == "RUNNING" ]; then
    echo -e "${GREEN}✓ Service is RUNNING${NC}"
    echo ""
    echo "Testing endpoints..."
    
    # Test root
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" == "200" ]; then
        echo -e "${GREEN}✓ Root endpoint: OK (200)${NC}"
    else
        echo -e "${YELLOW}⚠ Root endpoint: $HTTP_CODE${NC}"
    fi
    
    # Test API health
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL/api/health" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" == "200" ]; then
        echo -e "${GREEN}✓ API health endpoint: OK (200)${NC}"
        curl -s --max-time 5 "$URL/api/health" | python3 -m json.tool 2>/dev/null || echo ""
    else
        echo -e "${YELLOW}⚠ API health endpoint: $HTTP_CODE${NC}"
    fi
elif [ "$STATE" == "DEPLOYING" ]; then
    echo -e "${YELLOW}⏳ Service is DEPLOYING...${NC}"
    echo "This can take 5-10 minutes for the first deployment."
    echo "Run this script again to check status."
elif [ "$STATE" == "FAILED" ]; then
    echo -e "${YELLOW}✗ Service deployment FAILED${NC}"
    echo "Check the AWS Console for details."
else
    echo -e "${YELLOW}Service state: $STATE${NC}"
fi
