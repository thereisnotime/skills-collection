# Autonomi Loki Mode - Helm Chart

Production Kubernetes deployment for the Autonomi Loki Mode multi-agent autonomous development system.

## Prerequisites

- Kubernetes 1.26+
- Helm 3.12+
- Container image `asklokesh/loki-mode` available (Docker Hub or private registry)

## Quickstart

```bash
# 1. Create namespace and secret first (recommended)
kubectl create namespace autonomi
kubectl create secret generic autonomi-secrets \
  --namespace autonomi \
  --from-literal=anthropic-api-key=sk-ant-...

# 2. Install the chart referencing the secret
helm install autonomi ./deploy/helm/autonomi \
  --namespace autonomi \
  --set secrets.existingSecret=autonomi-secrets
```

> **Note:** You can also pass keys inline with `--set secrets.anthropicApiKey=sk-ant-...`,
> but this exposes the key in your shell history and process list. Using a
> pre-created Kubernetes secret (above) is strongly recommended.

## Installation

### From local chart

```bash
helm install autonomi ./deploy/helm/autonomi \
  --namespace autonomi \
  --create-namespace \
  -f my-values.yaml
```

### Using an existing secret for API keys

Create the secret first:

```bash
kubectl create secret generic autonomi-api-keys \
  --namespace autonomi \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-... \
  --from-literal=OPENAI_API_KEY=sk-... \
  --from-literal=GOOGLE_API_KEY=AI...
```

Then reference it:

```bash
helm install autonomi ./deploy/helm/autonomi \
  --namespace autonomi \
  --set secrets.existingSecret=autonomi-api-keys
```

## Upgrade

```bash
helm upgrade autonomi ./deploy/helm/autonomi \
  --namespace autonomi \
  -f my-values.yaml
```

## Uninstall

```bash
helm uninstall autonomi --namespace autonomi
```

Note: PersistentVolumeClaims are not deleted automatically. Remove them manually if no longer needed:

```bash
kubectl delete pvc -l app.kubernetes.io/instance=autonomi -n autonomi
```

## Configuration

See `values.yaml` for the full list of configurable parameters.

### Key sections

| Section | Description |
|---------|-------------|
| `controlplane` | Dashboard/API deployment (replicas, resources, probes) |
| `worker` | RARV worker deployment (replicas, resources, autoscaling) |
| `persistence` | PVC settings for checkpoints and audit logs |
| `ingress` | Ingress with TLS and cert-manager support |
| `config` | Non-secret environment variables (log level, provider, etc.) |
| `secrets` | API keys (or reference an existing secret) |
| `security` | Pod security context, RBAC, network policies |
| `observability` | ServiceMonitor for Prometheus |

## Production Deployment

```bash
helm install autonomi ./deploy/helm/autonomi \
  --namespace autonomi \
  --create-namespace \
  -f deploy/helm/autonomi/values-production.yaml \
  --set secrets.existingSecret=autonomi-api-keys
```

Production values include:
- 2 control plane replicas
- 3+ worker replicas with HPA (scales to 10)
- Larger resource limits
- Network policies enabled
- Audit logging at WARNING level

## High Availability

```bash
helm install autonomi ./deploy/helm/autonomi \
  --namespace autonomi \
  --create-namespace \
  -f deploy/helm/autonomi/values-production.yaml \
  -f deploy/helm/autonomi/values-ha.yaml \
  --set secrets.existingSecret=autonomi-api-keys
```

HA values add:
- 3 control plane replicas with pod anti-affinity
- 5+ workers with anti-affinity (scales to 20)
- ReadWriteMany storage for shared checkpoints

## Testing

```bash
helm test autonomi --namespace autonomi
```

This runs two test pods:
1. `test-connection` - verifies the `/health` endpoint responds
2. `test-health` - verifies `/api/status` returns valid JSON

## Architecture

```
+------------------+       +-------------------+
|    Ingress       |------>|  Control Plane    |
|  (optional TLS)  |       |  (Dashboard API)  |
+------------------+       |  port 57374       |
                           +-------------------+
                                    |
                           +-------------------+
                           |  Workers (HPA)    |
                           |  RARV execution   |
                           |  1-20 replicas    |
                           +-------------------+
                                    |
                    +---------------+---------------+
                    |                               |
             +------+------+               +-------+------+
             | Checkpoints |               |  Audit Logs  |
             |   PVC       |               |    PVC       |
             +-------------+               +--------------+
```
