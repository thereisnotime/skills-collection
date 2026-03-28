# Common Kubernetes Issues and Solutions

This reference provides detailed information about common Kubernetes issues, their root causes, and remediation steps.

## Table of Contents

1. [Pod Issues](#pod-issues)
2. [Node Issues](#node-issues)
3. [Networking Issues](#networking-issues)
4. [Storage Issues](#storage-issues)
5. [Resource Issues](#resource-issues)
6. [Security Issues](#security-issues)

---

## Pod Issues

### ImagePullBackOff / ErrImagePull

**Symptoms:**
- Pod stuck in `ImagePullBackOff` or `ErrImagePull` state
- Events show image pull errors

**Common Causes:**
1. Image doesn't exist or tag is wrong
2. Registry authentication failure
3. Network issues reaching registry
4. Rate limiting from registry
5. Private registry without imagePullSecrets

**Diagnostic Commands:**
```bash
kubectl describe pod <pod-name> -n <namespace>
kubectl get events -n <namespace> --field-selector involvedObject.name=<pod-name>
```

**Remediation Steps:**
1. Verify image name and tag: `docker pull <image>` from local machine
2. Check imagePullSecrets exist: `kubectl get secrets -n <namespace>`
3. Verify secret has correct registry credentials
4. Check if registry is accessible from cluster
5. For rate limiting: implement imagePullSecrets with authenticated account
6. Update deployment with correct image path

**Prevention:**
- Use specific image tags instead of `latest`
- Implement image pull secrets for private registries
- Set up local registry or cache to reduce external pulls
- Use image validation in CI/CD pipeline

---

### CrashLoopBackOff

**Symptoms:**
- Pod repeatedly crashes and restarts
- Increasing restart count
- Container exits shortly after starting

**Common Causes:**
1. Application error on startup
2. Missing environment variables or config
3. Resource limits too restrictive
4. Liveness probe too aggressive
5. Missing dependencies (DB, cache, etc.)
6. Command/args misconfiguration

**Diagnostic Commands:**
```bash
kubectl logs <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> --previous
kubectl describe pod <pod-name> -n <namespace>
kubectl get pod <pod-name> -n <namespace> -o yaml
```

**Remediation Steps:**
1. Check current logs: `kubectl logs <pod-name>`
2. Check previous container logs: `kubectl logs <pod-name> --previous`
3. Look for startup errors, stack traces, or missing config messages
4. Verify environment variables are set correctly
5. Check if external dependencies are accessible
6. Review and adjust resource limits if OOMKilled
7. Adjust liveness probe initialDelaySeconds if failing too early
8. Verify command and args in pod spec

**Prevention:**
- Implement proper application health checks and readiness
- Use init containers for dependency checks
- Set appropriate resource requests/limits based on profiling
- Configure liveness probes with sufficient delay
- Add retry logic and graceful degradation to applications

---

### Pending Pods

**Symptoms:**
- Pod stuck in `Pending` state
- Not scheduled to any node

**Common Causes:**
1. Insufficient cluster resources (CPU/memory)
2. Node selectors/affinity rules can't be satisfied
3. No nodes match taints/tolerations
4. PersistentVolume not available
5. Resource quotas exceeded
6. Scheduler not running or misconfigured

**Diagnostic Commands:**
```bash
kubectl describe pod <pod-name> -n <namespace>
kubectl get nodes -o wide
kubectl describe nodes
kubectl get pv,pvc -n <namespace>
kubectl get resourcequota -n <namespace>
```

**Remediation Steps:**
1. Check pod events for scheduling failure reason
2. Verify node resources: `kubectl describe nodes | grep -A 5 "Allocated resources"`
3. Check if pod has node selectors: verify nodes have required labels
4. Review taints on nodes and tolerations on pod
5. For PVC issues: verify PV exists and is in `Available` state
6. Check namespace resource quota: `kubectl describe resourcequota -n <namespace>`
7. If no resources: scale cluster or reduce resource requests
8. If affinity issue: adjust affinity rules or add matching nodes

**Prevention:**
- Set appropriate resource requests (not just limits)
- Monitor cluster capacity and scale proactively
- Use pod disruption budgets to prevent total unavailability
- Implement cluster autoscaling
- Use multiple node pools for different workload types

---

### OOMKilled Pods

**Symptoms:**
- Pod terminates with exit code 137
- Container status shows `OOMKilled` reason
- Frequent restarts due to memory exhaustion

**Common Causes:**
1. Memory limit set too low
2. Memory leak in application
3. Unexpected load increase
4. No memory limits (using node's memory)

**Diagnostic Commands:**
```bash
kubectl describe pod <pod-name> -n <namespace>
kubectl logs <pod-name> --previous -n <namespace>
kubectl top pod <pod-name> -n <namespace>
```

**Remediation Steps:**
1. Confirm OOMKilled in pod events or status
2. Check memory usage before crash if metrics available
3. Review application logs for memory-intensive operations
4. Increase memory limit if application legitimately needs more
5. Profile application to identify memory leaks
6. Implement memory limits with requests = limits for guaranteed QoS
7. Consider horizontal scaling instead of vertical

**Prevention:**
- Profile applications to determine actual memory needs
- Set memory requests based on normal usage, limits with headroom
- Implement application-level memory monitoring
- Use horizontal pod autoscaling based on memory metrics
- Regular load testing to understand resource requirements

---

## Node Issues

### Node NotReady

**Symptoms:**
- Node status shows `NotReady`
- Pods on node may be evicted
- Node may be cordoned automatically

**Common Causes:**
1. Kubelet stopped or crashed
2. Network connectivity issues
3. Disk pressure
4. Memory pressure
5. PID pressure
6. Container runtime issues

**Diagnostic Commands:**
```bash
kubectl describe node <node-name>
kubectl get nodes -o wide
ssh <node> "systemctl status kubelet"
ssh <node> "journalctl -u kubelet -n 100"
ssh <node> "df -h"
ssh <node> "free -m"
```

**Remediation Steps:**
1. Check node conditions in describe output
2. Verify kubelet is running: `systemctl status kubelet`
3. Check kubelet logs: `journalctl -u kubelet`
4. For disk pressure: clean up unused images/containers
5. For memory pressure: identify and stop memory-hogging processes
6. Restart kubelet if crashed: `systemctl restart kubelet`
7. Check container runtime: `systemctl status docker` or `containerd`
8. Verify network connectivity to API server

**Prevention:**
- Monitor node resources with alerts
- Implement log rotation and image cleanup
- Set up node problem detector
- Use resource quotas to prevent resource exhaustion
- Regular maintenance windows for updates

---

### Disk Pressure

**Symptoms:**
- Node condition `DiskPressure` is True
- Pod evictions may occur
- Node may become NotReady

**Common Causes:**
1. Docker/containerd image cache filling disk
2. Container logs consuming space
3. Ephemeral storage usage by pods
4. System logs filling up

**Diagnostic Commands:**
```bash
kubectl describe node <node-name> | grep -A 10 Conditions
ssh <node> "df -h"
ssh <node> "du -sh /var/lib/docker/*"
ssh <node> "du -sh /var/lib/containerd/*"
ssh <node> "docker system df"
```

**Remediation Steps:**
1. Clean up unused images: `docker image prune -a`
2. Clean up stopped containers: `docker container prune`
3. Clean up volumes: `docker volume prune`
4. Rotate and compress logs
5. Check for pods with excessive ephemeral storage usage
6. Expand disk if consistently running out of space
7. Configure kubelet garbage collection parameters

**Prevention:**
- Set imagefs.available threshold in kubelet config
- Implement automated image pruning
- Use log rotation for container logs
- Monitor disk usage with alerts
- Set ephemeral-storage limits on pods
- Size nodes appropriately for workload

---

## Networking Issues

### Pod-to-Pod Communication Failure

**Symptoms:**
- Services can't reach other services
- Connection timeouts between pods
- DNS resolution may or may not work

**Common Causes:**
1. Network policy blocking traffic
2. CNI plugin issues
3. Firewall rules blocking traffic
4. Service misconfiguration
5. Pod CIDR exhaustion

**Diagnostic Commands:**
```bash
kubectl get networkpolicies --all-namespaces
kubectl exec -it <pod> -- ping <target-pod-ip>
kubectl exec -it <pod> -- nslookup <service-name>
kubectl get svc -n <namespace>
kubectl describe svc <service-name> -n <namespace>
kubectl get endpoints <service-name> -n <namespace>
```

**Remediation Steps:**
1. Test basic connectivity: exec into pod and ping target
2. Check network policies: look for policies affecting source/dest namespaces
3. Verify service has endpoints: `kubectl get endpoints`
4. Check if pod labels match service selector
5. Verify CNI plugin pods are healthy (usually in kube-system)
6. Check node-level firewall rules
7. Verify pod CIDR hasn't been exhausted

**Prevention:**
- Document network policies and their intent
- Use namespace labels for network policy management
- Monitor CNI plugin health
- Regularly audit network policies
- Implement network policy testing in CI/CD

---

### Service Not Accessible

**Symptoms:**
- Cannot connect to service
- LoadBalancer stuck in Pending
- NodePort not accessible

**Common Causes:**
1. Service has no endpoints (no matching pods)
2. Pods not passing readiness checks
3. LoadBalancer controller not working
4. Cloud provider integration issues
5. Port conflicts

**Diagnostic Commands:**
```bash
kubectl get svc <service-name> -n <namespace>
kubectl describe svc <service-name> -n <namespace>
kubectl get endpoints <service-name> -n <namespace>
kubectl get pods -l <service-selector> -n <namespace>
kubectl logs -l <service-selector> -n <namespace>
```

**Remediation Steps:**
1. Verify service type and ports are correct
2. Check if service has endpoints: `kubectl get endpoints`
3. If no endpoints: verify pod selector matches pod labels
4. Check pod readiness: `kubectl describe pod`
5. For LoadBalancer: check cloud provider controller logs
6. For NodePort: verify node firewall allows the port
7. Test from within cluster first, then external access

**Prevention:**
- Use meaningful service selectors and pod labels
- Implement proper readiness probes
- Test services in staging before production
- Monitor service endpoint counts
- Document external access requirements

---

## Storage Issues

### PVC Pending

**Symptoms:**
- PersistentVolumeClaim stuck in `Pending` state
- Pod can't start due to volume not available

**Common Causes:**
1. No PV matches PVC requirements
2. StorageClass doesn't exist or is misconfigured
3. Dynamic provisioner not working
4. Insufficient permissions for provisioner
5. Volume capacity exhausted in storage backend

**Diagnostic Commands:**
```bash
kubectl describe pvc <pvc-name> -n <namespace>
kubectl get pv
kubectl get storageclass
kubectl describe storageclass <storage-class-name>
kubectl get pods -n <provisioner-namespace>
```

**Remediation Steps:**
1. Check PVC events for specific error message
2. Verify StorageClass exists: `kubectl get sc`
3. Check if dynamic provisioner pod is running
4. For static provisioning: ensure PV exists with matching size/access mode
5. Verify provisioner has correct cloud credentials/permissions
6. Check storage backend capacity
7. Review StorageClass parameters for typos

**Prevention:**
- Use dynamic provisioning with reliable StorageClass
- Monitor storage backend capacity
- Set up alerts for PVC binding failures
- Test storage provisioning in non-production first
- Document storage requirements and limitations

---

### Volume Mount Failures

**Symptoms:**
- Pod fails to start with volume mount errors
- Events show mounting failures
- Container create errors related to volumes

**Common Causes:**
1. Volume already mounted to different node (RWO with multi-attach)
2. Volume doesn't exist
3. Insufficient permissions
4. Node can't reach storage backend
5. Filesystem issues on volume

**Diagnostic Commands:**
```bash
kubectl describe pod <pod-name> -n <namespace>
kubectl describe pvc <pvc-name> -n <namespace>
kubectl describe pv <pv-name>
kubectl get volumeattachments
```

**Remediation Steps:**
1. Check pod events for specific mount error
2. For RWO volumes: ensure pod is scheduled to node with volume attached
3. Verify PVC is bound to a PV
4. Check node can reach storage backend (cloud/NFS/iSCSI)
5. For CSI volumes: check CSI driver pods are healthy
6. Delete and recreate pod if volume is stuck in multi-attach state
7. Check filesystem on volume if accessible

**Prevention:**
- Use ReadWriteMany for multi-pod access scenarios
- Implement pod disruption budgets to prevent scheduling conflicts
- Monitor volume attachment status
- Use StatefulSets for stateful workloads with volumes
- Regular backup and restore testing

---

## Resource Issues

### Resource Quota Exceeded

**Symptoms:**
- New pods fail to schedule
- Error: "exceeded quota"
- ResourceQuota limits preventing resource allocation

**Common Causes:**
1. Namespace resource quota exceeded
2. Not enough resource budget available
3. Resource requests not specified on pods
4. Quota misconfiguration

**Diagnostic Commands:**
```bash
kubectl describe resourcequota -n <namespace>
kubectl describe limitrange -n <namespace>
kubectl get pods -n <namespace> -o json | jq '.items[].spec.containers[].resources'
kubectl describe namespace <namespace>
```

**Remediation Steps:**
1. Check current quota usage: `kubectl describe resourcequota`
2. Identify pods consuming resources
3. Either increase quota limits or reduce resource requests
4. Delete unused resources to free up quota
5. Optimize pod resource requests based on actual usage
6. Consider splitting workloads across namespaces

**Prevention:**
- Set quotas based on actual usage patterns
- Monitor quota usage with alerts
- Right-size pod resource requests
- Implement automatic cleanup of completed jobs/pods
- Regular quota review and adjustment

---

### CPU Throttling

**Symptoms:**
- Application performance degradation
- High CPU throttling metrics
- Services responding slowly despite available CPU

**Common Causes:**
1. CPU limits set too low
2. Burst workloads hitting limits
3. Noisy neighbor effects
4. CPU limits set without understanding workload

**Diagnostic Commands:**
```bash
kubectl top pod <pod-name> -n <namespace>
kubectl describe pod <pod-name> -n <namespace> | grep -A 5 Limits
kubectl exec <pod-name> -- cat /sys/fs/cgroup/cpu/cpu.cfs_throttled_time
```

**Remediation Steps:**
1. Check current CPU usage vs limits
2. Review throttling metrics if available
3. Increase CPU limits if application legitimately needs more
4. Remove CPU limits if workload is bursty (keep requests)
5. Use HPA if load varies significantly
6. Profile application to identify CPU-intensive operations

**Prevention:**
- Set CPU requests based on average usage
- Set CPU limits with 50-100% headroom for bursts
- Use HPA for variable workloads
- Monitor CPU throttling metrics
- Regular performance testing and profiling

---

## Security Issues

### Image Vulnerability

**Symptoms:**
- Security scanner reports vulnerabilities
- Compliance violations
- Known CVEs in running images

**Diagnostic Commands:**
```bash
kubectl get pods -o jsonpath='{.items[*].spec.containers[*].image}' | tr ' ' '\n' | sort -u
trivy image <image-name>
```

**Remediation Steps:**
1. Identify vulnerable images with scanner
2. Update base images to patched versions
3. Rebuild application images with updated dependencies
4. Update deployments with new image tags
5. Implement admission controller to block vulnerable images

**Prevention:**
- Scan images in CI/CD pipeline
- Regular base image updates
- Use minimal base images
- Implement admission controllers (OPA, Kyverno)
- Automated image updates and testing

---

### RBAC Permission Denied

**Symptoms:**
- Users or service accounts can't perform operations
- "forbidden" errors in logs
- API calls fail with 403 errors

**Common Causes:**
1. Missing Role or ClusterRole binding
2. Overly restrictive RBAC policies
3. Wrong service account in pod
4. Namespace-scoped role for cluster-wide resource

**Diagnostic Commands:**
```bash
kubectl auth can-i <verb> <resource> --as=<user/sa>
kubectl get rolebindings -n <namespace>
kubectl get clusterrolebindings
kubectl describe role <role-name> -n <namespace>
kubectl describe serviceaccount <sa-name> -n <namespace>
```

**Remediation Steps:**
1. Identify exact permission needed from error message
2. Check what user/SA can do: `kubectl auth can-i --list`
3. Create appropriate Role/ClusterRole with needed permissions
4. Create RoleBinding/ClusterRoleBinding
5. Verify service account is correctly set in pod spec
6. Test with `kubectl auth can-i` before deploying

**Prevention:**
- Follow principle of least privilege
- Use namespace-scoped roles where possible
- Document RBAC policies and their purpose
- Regular RBAC audits
- Use pre-defined roles when possible

---

This reference covers the most common Kubernetes issues. For each issue, always:
1. Gather information (describe, logs, events)
2. Form hypothesis based on symptoms
3. Test hypothesis with targeted diagnostics
4. Apply remediation
5. Verify fix
6. Document for future reference
