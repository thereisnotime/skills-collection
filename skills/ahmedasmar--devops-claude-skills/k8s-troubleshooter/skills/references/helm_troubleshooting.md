# Helm Troubleshooting Guide

Comprehensive guide for troubleshooting Helm releases, charts, and deployments.

## Table of Contents

1. [Helm Release Issues](#helm-release-issues)
2. [Chart Installation Failures](#chart-installation-failures)
3. [Upgrade and Rollback Problems](#upgrade-and-rollback-problems)
4. [Values and Configuration](#values-and-configuration)
5. [Chart Dependencies](#chart-dependencies)
6. [Hooks and Lifecycle](#hooks-and-lifecycle)
7. [Repository Issues](#repository-issues)

---

## Helm Release Issues

### Release Stuck in Pending-Install/Pending-Upgrade

**Symptoms:**
- Release shows status `pending-install` or `pending-upgrade`
- New installations or upgrades hang indefinitely
- `helm list` shows release but resources not created

**Diagnostic Commands:**
```bash
# Check release status
helm list -n <namespace>
helm status <release-name> -n <namespace>

# Check release history
helm history <release-name> -n <namespace>

# Get detailed release information
kubectl get secrets -n <namespace> -l owner=helm,status=pending-install

# Check helm operation pods/jobs
kubectl get pods -n <namespace> -l app.kubernetes.io/managed-by=Helm
```

**Common Causes:**
1. Previous installation failed and wasn't cleaned up
2. Helm hooks stuck or failed
3. Kubernetes resources can't be created (RBAC, quotas)
4. Timeout during installation

**Resolution:**

```bash
# Check for stuck hooks
kubectl get jobs -n <namespace>
kubectl get pods -n <namespace> -l "helm.sh/hook"

# Delete stuck hooks
kubectl delete job <hook-job> -n <namespace>

# Rollback to previous version
helm rollback <release-name> -n <namespace>

# Force delete release (last resort)
helm delete <release-name> -n <namespace> --no-hooks

# Clean up secrets
kubectl delete secret -n <namespace> -l owner=helm,name=<release-name>
```

### Release Shows as Deployed but Resources Missing

**Symptoms:**
- `helm list` shows release as deployed
- Expected pods/services not running
- Resources partially created

**Investigation:**
```bash
# Get manifest from release
helm get manifest <release-name> -n <namespace>

# Compare with what's actually deployed
helm get manifest <release-name> -n <namespace> | kubectl apply --dry-run=client -f -

# Check helm values used
helm get values <release-name> -n <namespace>

# Check for resource creation errors
kubectl get events -n <namespace> --sort-by='.lastTimestamp' | tail -20
```

**Resolution:**
```bash
# Reapply the release
helm upgrade <release-name> <chart> -n <namespace> --reuse-values

# Or force recreate
helm upgrade <release-name> <chart> -n <namespace> --force
```

---

## Chart Installation Failures

### "Release Already Exists" Error

**Symptoms:**
```
Error: INSTALLATION FAILED: cannot re-use a name that is still in use
```

**Resolution:**
```bash
# Check existing releases
helm list -n <namespace> --all

# Check for failed releases
helm list -n <namespace> --failed

# Uninstall existing release
helm uninstall <release-name> -n <namespace>

# Or use different release name
helm install <new-release-name> <chart> -n <namespace>
```

### "Invalid Chart" Error

**Symptoms:**
```
Error: INSTALLATION FAILED: chart requires kubeVersion: >=1.20.0 which is incompatible with Kubernetes v1.19.0
```

**Investigation:**
```bash
# Check chart requirements
helm show chart <chart-name>

# Check Kubernetes version
kubectl version --short

# Inspect chart contents
helm pull <chart> --untar
cat <chart>/Chart.yaml
```

**Resolution:**
- Upgrade Kubernetes cluster to meet requirements
- Use compatible chart version: `helm install <release> <chart> --version <compatible-version>`
- Modify Chart.yaml kubeVersion requirement (not recommended)

### Template Rendering Errors

**Symptoms:**
```
Error: INSTALLATION FAILED: template: <chart>/templates/deployment.yaml:10:4:
executing "<chart>/templates/deployment.yaml" at <.Values.invalid.path>:
nil pointer evaluating interface {}.path
```

**Investigation:**
```bash
# Render templates locally
helm template <release-name> <chart> -n <namespace>

# Render with your values
helm template <release-name> <chart> -f values.yaml -n <namespace>

# Debug mode
helm install <release-name> <chart> -n <namespace> --debug --dry-run
```

**Resolution:**
1. Check values.yaml for missing required fields
2. Verify template syntax in chart
3. Use `helm lint` to validate chart

```bash
# Lint chart
helm lint <chart-directory>

# Lint with values
helm lint <chart-directory> -f values.yaml
```

---

## Upgrade and Rollback Problems

### Upgrade Fails with "Rendered Manifests Contain Errors"

**Symptoms:**
```
Error: UPGRADE FAILED: unable to build kubernetes objects from release manifest
```

**Investigation:**
```bash
# Dry run upgrade
helm upgrade <release-name> <chart> -n <namespace> --dry-run --debug

# Compare differences
helm diff upgrade <release-name> <chart> -n <namespace>  # requires helm-diff plugin
```

**Resolution:**
```bash
# Fix values.yaml and retry
helm upgrade <release-name> <chart> -n <namespace> -f fixed-values.yaml

# Skip tests if test hooks failing
helm upgrade <release-name> <chart> -n <namespace> --no-hooks

# Force upgrade
helm upgrade <release-name> <chart> -n <namespace> --force
```

### Rollback Fails

**Symptoms:**
```
Error: ROLLBACK FAILED: release <release-name> failed, and has been rolled back due to atomic being set
```

**Investigation:**
```bash
# Check release history
helm history <release-name> -n <namespace>

# Get specific revision manifest
helm get manifest <release-name> --revision <revision-number> -n <namespace>
```

**Resolution:**
```bash
# Rollback to specific working revision
helm rollback <release-name> <revision-number> -n <namespace>

# If rollback fails, uninstall and reinstall
helm uninstall <release-name> -n <namespace>
helm install <release-name> <chart> -n <namespace> -f values.yaml

# Clean up failed rollback
kubectl get secrets -n <namespace> -l owner=helm,status=pending-rollback
kubectl delete secret <secret-name> -n <namespace>
```

### "Immutable Field" Error During Upgrade

**Symptoms:**
```
Error: UPGRADE FAILED: Service "myapp" is invalid: spec.clusterIP: Invalid value: "": field is immutable
```

**Common immutable fields:**
- Service `clusterIP`
- StatefulSet `volumeClaimTemplates`
- PVC `storageClassName`

**Resolution:**
```bash
# Option 1: Delete and recreate resource
kubectl delete service <service-name> -n <namespace>
helm upgrade <release-name> <chart> -n <namespace>

# Option 2: Use --force to recreate resources
helm upgrade <release-name> <chart> -n <namespace> --force

# Option 3: Manually patch the resource
kubectl patch service <service-name> -n <namespace> --type='json' \
  -p='[{"op": "remove", "path": "/spec/clusterIP"}]'
```

---

## Values and Configuration

### Values Not Applied

**Symptoms:**
- Deployed resources don't reflect values in values.yaml
- Default chart values used instead of custom values

**Investigation:**
```bash
# Check what values were used in deployment
helm get values <release-name> -n <namespace>

# Check all values (including defaults)
helm get values <release-name> -n <namespace> --all

# Test rendering with your values
helm template <release-name> <chart> -f values.yaml -n <namespace> | less
```

**Resolution:**
```bash
# Ensure values file is specified correctly
helm upgrade <release-name> <chart> -n <namespace> -f values.yaml

# Use multiple values files (later files override earlier)
helm upgrade <release-name> <chart> -n <namespace> \
  -f values-common.yaml \
  -f values-prod.yaml

# Set specific values via CLI
helm upgrade <release-name> <chart> -n <namespace> \
  --set image.tag=v2.0.0 \
  --set replicas=5
```

### Values File Parsing Errors

**Symptoms:**
```
Error: INSTALLATION FAILED: YAML parse error
```

**Investigation:**
```bash
# Validate YAML syntax
yamllint values.yaml

# Or use Python
python3 -c 'import yaml; yaml.safe_load(open("values.yaml"))'

# Check for tabs (YAML doesn't allow tabs)
cat -A values.yaml | grep $'\t'
```

**Resolution:**
- Fix YAML syntax errors
- Replace tabs with spaces
- Ensure proper indentation
- Quote special characters in strings

### Secret Values Not Working

**Symptoms:**
- Secrets not created or contain wrong values
- Base64 encoding issues

**Investigation:**
```bash
# Check secret in manifest
helm get manifest <release-name> -n <namespace> | grep -A 10 "kind: Secret"

# Decode secret
kubectl get secret <secret-name> -n <namespace> -o json | \
  jq '.data | map_values(@base64d)'
```

**Resolution:**
```yaml
# Use proper secret format in values.yaml
secrets:
  password: "mySecretPassword"  # Helm will base64 encode

# Or pre-encode if template expects it
secrets:
  password: "bXlTZWNyZXRQYXNzd29yZA=="  # Already base64 encoded
```

---

## Chart Dependencies

### Dependency Update Fails

**Symptoms:**
```
Error: An error occurred while checking for chart dependencies
```

**Investigation:**
```bash
# Check Chart.yaml dependencies
cat Chart.yaml

# List current dependencies
helm dependency list <chart-directory>

# Check repository access
helm repo list
helm repo update
```

**Resolution:**
```bash
# Update dependencies
helm dependency update <chart-directory>

# Build dependencies (downloads to charts/)
helm dependency build <chart-directory>

# Add missing repositories
helm repo add <repo-name> <repo-url>
helm repo update
```

### Dependency Version Conflicts

**Symptoms:**
```
Error: found in Chart.yaml, but missing in charts/ directory
```

**Resolution:**
```bash
# Clean dependencies
rm -rf <chart-directory>/charts/*
rm -f <chart-directory>/Chart.lock

# Rebuild
helm dependency update <chart-directory>

# Verify
helm dependency list <chart-directory>
```

### Subchart Values Not Applied

**Investigation:**
```bash
# Check subchart values in parent chart
cat values.yaml | grep -A 20 <subchart-name>

# Render to see what values subchart receives
helm template <release-name> <chart> -f values.yaml | grep -A 50 "# Source: <subchart-name>"
```

**Resolution:**
```yaml
# In parent chart's values.yaml, nest subchart values under subchart name:
postgresql:  # Subchart name
  auth:
    username: myuser
    password: mypass
    database: mydb
  primary:
    resources:
      requests:
        memory: "256Mi"
        cpu: "250m"
```

---

## Hooks and Lifecycle

### Pre/Post Hooks Failing

**Symptoms:**
- Installation/upgrade hangs waiting for hooks
- Hook jobs fail
- Release stuck in pending state

**Investigation:**
```bash
# List hooks
kubectl get jobs -n <namespace> -l "helm.sh/hook"

# Check hook status
kubectl describe job <hook-job-name> -n <namespace>

# Get hook logs
kubectl logs -n <namespace> -l "helm.sh/hook=pre-install"
kubectl logs -n <namespace> -l "helm.sh/hook=post-install"
```

**Resolution:**
```bash
# Delete failed hooks
kubectl delete job -n <namespace> -l "helm.sh/hook"

# Retry without hooks
helm upgrade <release-name> <chart> -n <namespace> --no-hooks

# Or skip hooks during install
helm install <release-name> <chart> -n <namespace> --no-hooks
```

### Hook Cleanup Issues

**Symptoms:**
- Hook resources remain after installation
- Accumulating failed hook jobs

**Investigation:**
```bash
# Check hook deletion policy
helm get manifest <release-name> -n <namespace> | grep -B 5 "helm.sh/hook-delete-policy"

# List remaining hooks
kubectl get all -n <namespace> -l "helm.sh/hook"
```

**Resolution:**
```bash
# Manual cleanup
kubectl delete jobs,pods -n <namespace> -l "helm.sh/hook"

# Update chart template to include proper hook-delete-policy:
# metadata:
#   annotations:
#     "helm.sh/hook": pre-install
#     "helm.sh/hook-delete-policy": hook-succeeded,hook-failed
```

---

## Repository Issues

### Unable to Get Chart from Repository

**Symptoms:**
```
Error: failed to download "<chart-name>"
```

**Investigation:**
```bash
# Check repository configuration
helm repo list

# Update repositories
helm repo update

# Search for chart
helm search repo <chart-name> --versions

# Test repository access
curl -I <repo-url>/index.yaml
```

**Resolution:**
```bash
# Remove and re-add repository
helm repo remove <repo-name>
helm repo add <repo-name> <repo-url>
helm repo update

# For private repos, configure credentials
helm repo add <repo-name> <repo-url> \
  --username=<username> \
  --password=<password>

# Or use OCI registry
helm pull oci://registry.example.com/charts/<chart-name> --version 1.0.0
```

### Chart Version Not Found

**Symptoms:**
```
Error: chart "<chart-name>" version "1.2.3" not found
```

**Investigation:**
```bash
# List available versions
helm search repo <chart-name> --versions

# Check if specific version exists
helm show chart <repo-name>/<chart-name> --version 1.2.3
```

**Resolution:**
```bash
# Use available version
helm install <release-name> <repo-name>/<chart-name> --version <available-version>

# Or use latest
helm install <release-name> <repo-name>/<chart-name>
```

---

## Debugging Tools and Commands

### Essential Helm Commands

```bash
# Get release information
helm list -n <namespace> --all
helm status <release-name> -n <namespace>
helm history <release-name> -n <namespace>

# Get release content
helm get values <release-name> -n <namespace>
helm get manifest <release-name> -n <namespace>
helm get hooks <release-name> -n <namespace>
helm get notes <release-name> -n <namespace>

# Debugging
helm install <release-name> <chart> --debug --dry-run -n <namespace>
helm template <release-name> <chart> --debug -n <namespace>

# Testing
helm test <release-name> -n <namespace>
helm lint <chart-directory>
```

### Useful Plugins

```bash
# Install helm-diff plugin
helm plugin install https://github.com/databus23/helm-diff

# Compare releases
helm diff upgrade <release-name> <chart> -n <namespace>

# Install helm-secrets plugin
helm plugin install https://github.com/jkroepke/helm-secrets

# Use encrypted values
helm secrets install <release-name> <chart> -f secrets.yaml -n <namespace>
```

### Helm Environment Issues

**Check Helm configuration:**
```bash
# Helm version
helm version

# Kubernetes context
kubectl config current-context

# Helm environment
helm env

# Cache location
helm env | grep CACHE
```

---

## Best Practices

### Release Management
- Use descriptive release names
- Always specify namespace explicitly
- Use `--atomic` flag for safer upgrades (rolls back on failure)
- Keep release history manageable: `helm history <release> -n <namespace> --max 10`

### Values Management
- Use multiple values files for different environments
- Version control your values files
- Use `helm template` to preview changes before applying
- Document required values in chart README

### Chart Development
- Always run `helm lint` before packaging
- Test charts in multiple environments
- Use semantic versioning for charts
- Implement proper hooks with deletion policies

### Troubleshooting Workflow
1. Check release status: `helm status <release> -n <namespace>`
2. Check history: `helm history <release> -n <namespace>`
3. Get values: `helm get values <release> -n <namespace>`
4. Check manifest: `helm get manifest <release> -n <namespace>`
5. Check Kubernetes events: `kubectl get events -n <namespace>`
6. Check pod logs: `kubectl logs <pod> -n <namespace>`
7. Check hooks: `kubectl get jobs -n <namespace> -l helm.sh/hook`

---

## Quick Reference

### Common Flags

```bash
# Installation/Upgrade
--atomic                 # Rollback on failure
--wait                   # Wait for resources to be ready
--timeout 10m            # Set timeout (default 5m)
--force                  # Force update by deleting and recreating resources
--cleanup-on-fail        # Delete resources on failed install

# Debugging
--debug                  # Enable verbose output
--dry-run                # Simulate operation
--no-hooks               # Skip hooks

# Values
-f values.yaml          # Use values file
--set key=value         # Set value via command line
--reuse-values          # Reuse values from previous release
```

### Typical Rescue Commands

```bash
# Release stuck? Force delete and reinstall
helm uninstall <release> -n <namespace> --no-hooks
kubectl delete secret -n <namespace> -l owner=helm,name=<release>
helm install <release> <chart> -n <namespace> -f values.yaml

# Upgrade failed? Rollback
helm rollback <release> 0 -n <namespace>  # 0 = previous revision

# Can't rollback? Force upgrade
helm upgrade <release> <chart> -n <namespace> --force --recreate-pods

# Complete cleanup
helm uninstall <release> -n <namespace>
kubectl delete namespace <namespace>  # If dedicated namespace
```
