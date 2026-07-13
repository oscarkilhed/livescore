# AWS Lightsail Deployment Guide

This guide explains how to deploy the Livescore application to AWS Lightsail Container Service.

## Prerequisites

1. **AWS Account** with Lightsail access
2. **AWS CLI** installed and configured
3. **Docker** installed and running
4. **AWS IAM permissions** for:
   - ECR (create repositories, push images)
   - Lightsail (create/update container services)

## Quick Start

### 1. Configure AWS Credentials

```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Enter your default region (e.g., us-east-1)
# Enter default output format (json)
```

Or set environment variables:
```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_DEFAULT_REGION=us-east-1
```

### 2. Set Deployment Variables (Optional)

These can be exported in your shell **or** placed in a `.env` file in the repo
root (see `.env.example`). The deploy script auto-loads `.env`; values already
present in the environment take precedence over `.env`.

Secrets are resolved with the precedence: **environment/`.env` → value already
running on the live Lightsail service → template default**. This means re-running
the script will reuse the live secrets rather than wiping them, and the script
will **abort** if `GRAPHQL_API_KEY` ends up unset (it never deploys the `SET_ME`
placeholder from `lightsail-deployment.json`).

```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=your-account-id  # Will be auto-detected if not set
export LIGHTSAIL_SERVICE_NAME=livescore-app

# GraphQL API settings (defaults shown)
export GRAPHQL_API_URL=https://shootnscoreit.com/graphql/
export GRAPHQL_API_KEY=your-ssi-api-key            # Required (x-api-key header)
export GRAPHQL_AUTH_TOKEN=                          # Optional bearer token
export GRAPHQL_SESSION_COOKIE=                      # Optional session cookie
export GRAPHQL_AUTH_USERNAME=                       # Optional JWT login username
export GRAPHQL_AUTH_PASSWORD=                       # Optional JWT login password
export GRAPHQL_TIMEOUT=60000                    # Request timeout in ms
export GRAPHQL_CACHE_MAX_AGE_MS=259200000       # 3 days cache TTL
export GRAPHQL_CACHE_IDLE_EVICTION_MS=3600000   # Evict after 1 hour idle
export RESPONSE_CACHE_TTL_MS=5000               # Response cache TTL
```

### 3. Run Deployment Script

```bash
./deploy-amd64-to-lightsail.sh
```

This script will:
- Create ECR repositories (if they don't exist)
- Authenticate Docker to ECR
- Build and push images (nginx includes built client, server)
- Render `lightsail-deployment.json` with your account ID, region, and secrets
  (reusing live secrets when not provided; aborts if `GRAPHQL_API_KEY` is unset)
- Create a new Lightsail container-service deployment and print the service URL

## Manual Deployment Steps

If you prefer to deploy manually:

### 1. Create ECR Repositories

```bash
aws ecr create-repository --repository-name livescore-server --region us-east-1
aws ecr create-repository --repository-name livescore-nginx --region us-east-1
```

Note: The client is built into the nginx image, so no separate client repository is needed.

### 2. Authenticate Docker

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
```

### 3. Build and Tag Images

```bash
# Nginx (includes built client)
docker build -t livescore-nginx:latest -f Dockerfile.nginx .
docker tag livescore-nginx:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/livescore-nginx:latest

# Server
docker build -t livescore-server:latest -f Dockerfile.server .
docker tag livescore-server:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/livescore-server:latest
```

### 4. Push Images to ECR

```bash
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/livescore-nginx:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/livescore-server:latest
```

## Creating Lightsail Container Service

### Option 1: Using AWS CLI

```bash
# Create container service
aws lightsail create-container-service \
  --service-name livescore-app \
  --power nano \
  --scale 1 \
  --region us-east-1

# Deploy containers (use the JSON from lightsail-deployment.json)
aws lightsail create-container-service-deployment \
  --service-name livescore-app \
  --cli-input-json file://lightsail-deployment.json \
  --region us-east-1
```

### Option 2: Using AWS Console

1. Go to AWS Lightsail Console
2. Navigate to Container services
3. Click "Create container service"
4. Configure:
   - Service name: `livescore-app`
   - Power: `nano` (for testing) or `small`/`medium` (for production)
   - Scale: `1` (or higher for production)
5. Add containers:
   - **nginx**: Use ECR image URI, port 80
   - **server**: Use ECR image URI, add environment variables
6. Set public endpoint to nginx container, port 80
7. Deploy

## Updating Deployment

After pushing new images:

```bash
# Update deployment with new images
aws lightsail create-container-service-deployment \
  --service-name livescore-app \
  --cli-input-json file://lightsail-deployment.json \
  --region us-east-1
```

Or use the AWS Console to update the container service deployment.

## Environment Variables

### Server Container

- `NODE_ENV`: `production`
- `PORT`: `3000`

#### GraphQL API Settings

- `GRAPHQL_API_URL`: `https://shootnscoreit.com/graphql/` (GraphQL endpoint)
- `GRAPHQL_API_KEY`: required SSI key used as `x-api-key`
- `GRAPHQL_AUTH_TOKEN`: optional bearer token for authenticated SSI requests
- `GRAPHQL_SESSION_COOKIE`: optional cookie header for authenticated SSI requests
- `GRAPHQL_AUTH_USERNAME`: optional SSI username for JWT login mutation
- `GRAPHQL_AUTH_PASSWORD`: optional SSI password for JWT login mutation
- `GRAPHQL_TIMEOUT`: `60000` (request timeout in milliseconds, default 60 seconds)
- `GRAPHQL_CACHE_MAX_AGE_MS`: `259200000` (cache TTL, default 3 days)
- `GRAPHQL_CACHE_IDLE_EVICTION_MS`: `3600000` (evict inactive entries after 1 hour)
- `RESPONSE_CACHE_TTL_MS`: `5000` (response cache for identical requests, default 5 seconds)

#### Monitoring (Grafana Cloud / OTLP)

Metrics + logs are pushed directly to Grafana Cloud over OTLP. Monitoring is off
unless an endpoint is provided. See the README's [Monitoring](README.md#monitoring-grafana-cloud)
section for how to obtain these from Grafana Cloud.

- `MONITORING_ENABLED`: `true` (set `false` to hard-disable)
- `OTEL_EXPORTER_OTLP_ENDPOINT`: base OTLP endpoint, e.g. `https://otlp-gateway-<zone>.grafana.net/otlp`
- `OTEL_EXPORTER_OTLP_HEADERS`: `Authorization=Basic <base64 of instanceID:token>`
- `OTEL_EXPORTER_OTLP_PROTOCOL`: `http/protobuf`
- `OTEL_SERVICE_NAME`: `livescore-server`
- `OTEL_DEPLOYMENT_ENVIRONMENT`: `production`

The endpoint and headers are treated as secrets by `deploy-amd64-to-lightsail.sh`
and resolved with the same **environment → live service → template** precedence as
`GRAPHQL_API_KEY`, so redeploys reuse the live values rather than wiping them.
Provide them via the environment or `.env`:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<zone>.grafana.net/otlp
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(echo -n '<instanceID>:<token>' | base64)"
```

## Troubleshooting

### Authentication Issues

```bash
# Verify AWS credentials
aws sts get-caller-identity

# Re-authenticate Docker
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
```

### Image Push Failures

- Ensure ECR repositories exist
- Check IAM permissions for ECR
- Verify Docker is authenticated

### Container Service Issues

- Check container logs in Lightsail console
- Verify environment variables are set correctly
- Ensure public endpoint is configured correctly
- Check health check configuration

## Cost Considerations

- **ECR**: First 500MB/month free, then $0.10/GB/month
- **Lightsail Container Service**:
  - Nano: ~$7/month
  - Small: ~$15/month
  - Medium: ~$30/month
  - Large: ~$60/month

## Security Best Practices

1. Use IAM roles with least privilege
2. Enable ECR image scanning
3. Use specific image tags (not just `latest`) in production
4. Regularly update base images (Node.js, Nginx)
5. Monitor container logs for errors
6. Set up CloudWatch alarms for service health
