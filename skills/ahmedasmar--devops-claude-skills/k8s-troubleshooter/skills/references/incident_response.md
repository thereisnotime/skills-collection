# Kubernetes Incident Response Playbook

This playbook provides structured procedures for responding to Kubernetes incidents.

## Incident Response Framework

### 1. Detection Phase
- Identify the incident (alerts, user reports, monitoring)
- Determine severity level
- Initiate incident response

### 2. Triage Phase
- Assess impact and scope
- Gather initial diagnostic data
- Determine if immediate action needed

### 3. Investigation Phase
- Collect comprehensive diagnostics
- Identify root cause
- Document findings

### 4. Resolution Phase
- Apply remediation
- Verify fix
- Monitor for recurrence

### 5. Post-Incident Phase
- Document incident
- Conduct blameless post-mortem
- Implement preventive measures

---

## Severity Levels

### SEV-1: Critical
- Complete service outage
- Data loss or corruption
- Security breach
- Impact: All users affected
- Response: Immediate, all-hands

### SEV-2: High
- Major functionality degraded
- Significant performance impact
- Impact: Large subset of users
- Response: Within 15 minutes

### SEV-3: Medium
- Minor functionality impaired
- Workaround available
- Impact: Some users affected
- Response: Within 1 hour

### SEV-4: Low
- Cosmetic issues
- Negligible impact
- Impact: Minimal
- Response: During business hours

---

## Common Incident Scenarios

### Scenario 1: Complete Cluster Outage

**Symptoms:**
- All services unreachable
- kubectl commands timing out
- API server not responding

**Immediate Actions:**
1. Verify the scope (single cluster or multi-cluster)
2. Check API server status and logs
3. Check control plane nodes
4. Verify network connectivity to control plane
5. Check etcd cluster health

**Investigation Steps:**
```bash
# Check control plane pods
kubectl get pods -n kube-system

# Check etcd
kubectl exec -it etcd-<node> -n kube-system -- etcdctl endpoint health

# Check API server logs
journalctl -u kube-apiserver -n 100

# Check control plane node resources
ssh <control-plane-node> "top"
```

**Common Causes:**
- etcd cluster failure
- API server OOM/crash
- Control plane network partition
- Certificate expiration
- Cloud provider outage

**Resolution Paths:**
1. etcd issue: Restore from backup or rebuild cluster
2. API server issue: Restart API server pods/service
3. Network: Fix routing, security groups, or DNS
4. Certificates: Renew certificates (kubeadm cert renew all)

---

### Scenario 2: Service Degradation

**Symptoms:**
- Increased latency or error rates
- Some requests failing
- Intermittent issues

**Immediate Actions:**
1. Check service metrics and logs
2. Verify pod health and count
3. Check for recent deployments
4. Review resource utilization

**Investigation Steps:**
```bash
# Check service endpoints
kubectl get endpoints <service> -n <namespace>

# Check pod status
kubectl get pods -l <service-selector> -n <namespace>

# Review recent changes
kubectl rollout history deployment/<name> -n <namespace>

# Check resource usage
kubectl top pods -n <namespace>

# Get recent events
kubectl get events -n <namespace> --sort-by='.lastTimestamp'
```

**Common Causes:**
- Insufficient replicas
- Pod restarts/crashes
- Resource contention
- Bad deployment
- External dependency failure

**Resolution Paths:**
1. Scale up replicas if needed
2. Rollback bad deployment
3. Increase resources if constrained
4. Fix configuration issues
5. Implement circuit breaker for external deps

---

### Scenario 3: Node Failure

**Symptoms:**
- Node reported as NotReady
- Pods being evicted from node
- High node resource utilization

**Immediate Actions:**
1. Identify affected node
2. Check impact (which pods running on node)
3. Determine if pods need immediate migration
4. Assess if node is recoverable

**Investigation Steps:**
```bash
# Get node status
kubectl get nodes

# Describe the problem node
kubectl describe node <node-name>

# Check pods on the node
kubectl get pods --all-namespaces -o wide --field-selector spec.nodeName=<node-name>

# SSH to node and check
ssh <node> "systemctl status kubelet"
ssh <node> "journalctl -u kubelet -n 100"
ssh <node> "docker ps"  # or containerd
ssh <node> "df -h"
ssh <node> "free -m"
```

**Common Causes:**
- Kubelet failure
- Disk full
- Memory exhaustion
- Network issues
- Hardware failure

**Resolution Paths:**
1. Recoverable: Fix issue (clean disk, restart services)
2. Not recoverable: Cordon, drain, and replace node
3. For critical pods: Manually reschedule if necessary
4. Update monitoring and alerting based on findings

---

### Scenario 4: Storage Issues

**Symptoms:**
- PVCs stuck in Pending
- Pods can't start due to volume issues
- Data access failures

**Immediate Actions:**
1. Identify affected PVCs/PVs
2. Check storage backend health
3. Verify provisioner status
4. Assess data integrity risk

**Investigation Steps:**
```bash
# Check PVC status
kubectl get pvc --all-namespaces

# Describe pending PVC
kubectl describe pvc <pvc-name> -n <namespace>

# Check PV status
kubectl get pv

# Check storage class
kubectl get storageclass

# Check provisioner
kubectl get pods -n <storage-namespace>

# Check volume attachments
kubectl get volumeattachments
```

**Common Causes:**
- Storage backend failure/full
- Provisioner issues
- Network to storage backend
- Volume attachment limits reached
- Corrupted volume

**Resolution Paths:**
1. Fix storage backend issues
2. Restart provisioner if needed
3. Manually provision PV if dynamic provisioning failed
4. Delete and recreate if volume corrupted
5. Restore from backup if data lost

---

### Scenario 5: Security Incident

**Symptoms:**
- Unauthorized access detected
- Suspicious pod behavior
- Security alerts triggered
- Unusual network traffic

**Immediate Actions:**
1. Assess severity and scope
2. Isolate affected resources
3. Preserve evidence
4. Engage security team

**Investigation Steps:**
```bash
# Check recent RBAC changes
kubectl get rolebindings,clusterrolebindings --all-namespaces -o json

# Audit pod security contexts
kubectl get pods --all-namespaces -o json | jq '.items[].spec.securityContext'

# Check for privileged pods
kubectl get pods --all-namespaces -o json | jq '.items[] | select(.spec.containers[].securityContext.privileged==true)'

# Review service accounts
kubectl get serviceaccounts --all-namespaces

# Get audit logs
cat /var/log/kubernetes/audit/audit.log | grep <suspicious-activity>
```

**Common Causes:**
- Compromised credentials
- Vulnerable container image
- Misconfigured RBAC
- Exposed secrets
- Supply chain attack

**Resolution Paths:**
1. Isolate: Network policies, cordon nodes
2. Investigate: Audit logs, pod logs, network flows
3. Remediate: Rotate credentials, patch vulnerabilities
4. Restore: From known-good state if needed
5. Prevent: Enhanced security policies, monitoring

---

## Diagnostic Commands Cheat Sheet

### Quick Health Check
```bash
# Overall cluster health
kubectl cluster-info
kubectl get nodes
kubectl get pods --all-namespaces | grep -v Running

# Component status (older clusters)
kubectl get componentstatuses

# Recent events
kubectl get events --all-namespaces --sort-by='.lastTimestamp' | tail -20
```

### Pod Diagnostics
```bash
# Pod details
kubectl describe pod <pod> -n <namespace>
kubectl get pod <pod> -n <namespace> -o yaml

# Logs
kubectl logs <pod> -n <namespace>
kubectl logs <pod> -n <namespace> --previous
kubectl logs <pod> -c <container> -n <namespace>

# Interactive debugging
kubectl exec -it <pod> -n <namespace> -- /bin/sh
kubectl debug <pod> -it --image=busybox -n <namespace>
```

### Node Diagnostics
```bash
# Node details
kubectl describe node <node>
kubectl get node <node> -o yaml

# Resource usage
kubectl top nodes
kubectl top pods --all-namespaces

# Node conditions
kubectl get nodes -o json | jq '.items[].status.conditions'
```

### Service & Network Diagnostics
```bash
# Service details
kubectl describe svc <service> -n <namespace>
kubectl get endpoints <service> -n <namespace>

# Network policies
kubectl get networkpolicies --all-namespaces

# DNS testing
kubectl run tmp-shell --rm -i --tty --image nicolaka/netshoot
# Then: nslookup <service>.<namespace>.svc.cluster.local
```

### Storage Diagnostics
```bash
# PVC and PV status
kubectl get pvc,pv --all-namespaces

# Storage class
kubectl get storageclass
kubectl describe storageclass <storage-class>

# Volume attachments
kubectl get volumeattachments
```

---

## Communication During Incidents

### Internal Communication
- Use dedicated incident channel
- Regular status updates (every 30 min)
- Clear roles (incident commander, scribe, experts)
- Document all actions taken

### External Communication
- Status page updates
- Customer notifications
- Clear expected resolution time
- Updates on progress

### Post-Incident Communication
- Incident report
- Root cause analysis
- Remediation steps taken
- Prevention measures

---

## Post-Incident Review Template

### Incident Summary
- Date and time
- Duration
- Severity
- Services affected
- User impact

### Timeline
- Detection time
- Response time
- Resolution time
- Key events during incident

### Root Cause
- What happened
- Why it happened
- Contributing factors

### Resolution
- What fixed the issue
- Who fixed it
- How long it took

### Lessons Learned
- What went well
- What could be improved
- Action items with owners

### Prevention
- Technical changes
- Process improvements
- Monitoring enhancements
- Documentation updates

---

## Best Practices

### Prevention
- Regular cluster audits
- Proactive monitoring and alerting
- Capacity planning
- Regular disaster recovery drills
- Automated backups
- Security scanning and policies

### Preparedness
- Document runbooks
- Practice incident response
- Keep contact lists updated
- Maintain up-to-date diagrams
- Pre-provision debugging tools

### Response
- Follow structured approach
- Document everything
- Communicate clearly
- Don't panic
- Think before acting
- Preserve evidence

### Recovery
- Verify fix thoroughly
- Monitor for recurrence
- Update documentation
- Conduct post-mortem
- Implement preventive measures
