# Kubernetes Performance Troubleshooting

Systematic approach to diagnosing and resolving Kubernetes performance issues.

## Table of Contents

1. [High Latency Issues](#high-latency-issues)
2. [CPU Performance](#cpu-performance)
3. [Memory Performance](#memory-performance)
4. [Network Performance](#network-performance)
5. [Storage I/O Performance](#storage-io-performance)
6. [Application-Level Metrics](#application-level-metrics)
7. [Cluster-Wide Performance](#cluster-wide-performance)

---

## High Latency Issues

### Symptoms
- Slow API response times
- Increased request latency
- Timeouts
- Degraded user experience

### Investigation Workflow

**1. Identify the layer with latency:**

```bash
# Check service mesh metrics (if using Istio/Linkerd)
kubectl top pods -n <namespace>

# Check ingress controller metrics
kubectl logs -n ingress-nginx <ingress-controller-pod> | grep "request_time"

# Check application logs for slow requests
kubectl logs <pod-name> -n <namespace> | grep -i "slow\|timeout\|latency"
```

**2. Profile application performance:**

```bash
# Get pod metrics
kubectl top pod <pod-name> -n <namespace>

# Check if pod is CPU throttled
kubectl get pod <pod-name> -n <namespace> -o json | \
  jq '.spec.containers[].resources'

# Exec into pod and check application-specific metrics
kubectl exec -it <pod-name> -n <namespace> -- /bin/sh
# Then: curl localhost:8080/metrics  (if Prometheus metrics available)
```

**3. Check dependencies:**

```bash
# Test connectivity to downstream services
kubectl exec -it <pod-name> -n <namespace> -- \
  curl -w "@curl-format.txt" -o /dev/null -s http://backend-service

# curl-format.txt content:
# time_namelookup: %{time_namelookup}\n
# time_connect: %{time_connect}\n
# time_appconnect: %{time_appconnect}\n
# time_pretransfer: %{time_pretransfer}\n
# time_redirect: %{time_redirect}\n
# time_starttransfer: %{time_starttransfer}\n
# time_total: %{time_total}\n
```

### Common Causes and Solutions

**CPU Throttling:**
```yaml
# Increase CPU limits or remove limits for bursty workloads
resources:
  requests:
    cpu: "500m"      # What pod needs typically
  limits:
    cpu: "2000m"     # Burst capacity (or remove for unlimited)
```

**Insufficient Replicas:**
```bash
# Scale up deployment
kubectl scale deployment <deployment-name> -n <namespace> --replicas=5

# Or enable HPA
kubectl autoscale deployment <deployment-name> \
  --cpu-percent=70 \
  --min=2 \
  --max=10
```

**Slow Dependencies:**
```yaml
# Implement circuit breakers and timeouts in application
# Or use service mesh policies (Istio example):
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: backend-circuit-breaker
spec:
  host: backend-service
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http1MaxPendingRequests: 50
        http2MaxRequests: 100
    outlierDetection:
      consecutiveErrors: 5
      interval: 30s
      baseEjectionTime: 30s
```

---

## CPU Performance

### Symptoms
- High CPU usage
- Throttling
- Slow processing
- Queue buildup

### Investigation Commands

```bash
# Check CPU usage
kubectl top nodes
kubectl top pods -n <namespace>

# Check CPU throttling
kubectl get pod <pod-name> -n <namespace> -o json | \
  jq '.spec.containers[].resources'

# Get detailed CPU metrics (requires metrics-server)
kubectl get --raw "/apis/metrics.k8s.io/v1beta1/namespaces/<namespace>/pods/<pod-name>" | jq

# Check container-level CPU from node (SSH to node)
ssh <node> "docker stats --no-stream"
```

### Advanced CPU Profiling

**Enable CPU profiling in application:**

```bash
# For Go applications with pprof
kubectl port-forward <pod-name> 6060:6060 -n <namespace>

# Capture CPU profile
curl http://localhost:6060/debug/pprof/profile?seconds=30 > cpu.prof

# Analyze with pprof
go tool pprof -http=:8080 cpu.prof
```

**For Java applications:**

```bash
# Use async-profiler
kubectl exec -it <pod-name> -n <namespace> -- \
  /profiler.sh -d 30 -f /tmp/flamegraph.html 1

# Copy flamegraph
kubectl cp <namespace>/<pod-name>:/tmp/flamegraph.html ./flamegraph.html
```

### Solutions

**Vertical Scaling:**
```yaml
resources:
  requests:
    cpu: "1000m"  # Increased from 500m
  limits:
    cpu: "2000m"  # Increased from 1000m
```

**Horizontal Scaling:**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: app
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

**Remove CPU Limits for Bursty Workloads:**
```yaml
# Allow bursting to available CPU
resources:
  requests:
    cpu: "500m"
  # No limits - can use all available CPU
```

---

## Memory Performance

### Symptoms
- OOMKilled pods
- Memory leaks
- Slow garbage collection
- Swap usage (if enabled)

### Investigation Commands

```bash
# Check memory usage
kubectl top nodes
kubectl top pods -n <namespace>

# Check memory limits and requests
kubectl describe pod <pod-name> -n <namespace> | grep -A 5 "Limits\|Requests"

# Check OOM kills
kubectl get pods -n <namespace> -o json | \
  jq '.items[] | select(.status.containerStatuses[]?.lastState.terminated.reason == "OOMKilled") | .metadata.name'

# Detailed memory breakdown (requires metrics-server)
kubectl get --raw "/apis/metrics.k8s.io/v1beta1/namespaces/<namespace>/pods/<pod-name>" | \
  jq '.containers[] | {name, usage: .usage.memory}'
```

### Memory Profiling

**Heap dump for Java:**
```bash
# Capture heap dump
kubectl exec <pod-name> -n <namespace> -- \
  jmap -dump:format=b,file=/tmp/heapdump.hprof 1

# Copy heap dump
kubectl cp <namespace>/<pod-name>:/tmp/heapdump.hprof ./heapdump.hprof

# Analyze with Eclipse MAT or VisualVM
```

**Memory profiling for Go:**
```bash
# Capture heap profile
kubectl port-forward <pod-name> 6060:6060 -n <namespace>
curl http://localhost:6060/debug/pprof/heap > heap.prof

# Analyze
go tool pprof -http=:8080 heap.prof
```

### Solutions

**Increase Memory Limits:**
```yaml
resources:
  requests:
    memory: "512Mi"
  limits:
    memory: "2Gi"  # Increased from 1Gi
```

**Optimize Application:**
- Fix memory leaks
- Implement connection pooling
- Optimize caching strategies
- Tune garbage collection

**Use Memory-Optimized Node Pools:**
```yaml
# Node affinity for memory-intensive workloads
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
      - matchExpressions:
        - key: workload-type
          operator: In
          values:
          - memory-optimized
```

---

## Network Performance

### Symptoms
- High network latency
- Packet loss
- Connection timeouts
- Bandwidth saturation

### Investigation Commands

```bash
# Check pod network statistics
kubectl exec <pod-name> -n <namespace> -- netstat -s

# Test network performance between pods
# Deploy netperf
kubectl run netperf-client --image=networkstatic/netperf --rm -it -- /bin/bash

# From client, run:
netperf -H <target-pod-ip> -t TCP_STREAM
netperf -H <target-pod-ip> -t TCP_RR  # Request-response latency

# Check DNS resolution time
kubectl exec <pod-name> -n <namespace> -- \
  time nslookup service-name.namespace.svc.cluster.local

# Check service mesh overhead (if using Istio)
kubectl exec <pod-name> -n <namespace> -c istio-proxy -- \
  curl -s localhost:15000/stats | grep "http.inbound\|http.outbound"
```

### Check Network Policies

```bash
# List network policies
kubectl get networkpolicies -n <namespace>

# Check if policy is blocking traffic
kubectl describe networkpolicy <policy-name> -n <namespace>

# Temporarily remove policies to test (in non-production)
kubectl delete networkpolicy <policy-name> -n <namespace>
```

### Solutions

**DNS Optimization:**
```yaml
# Use CoreDNS caching
# Increase CoreDNS replicas
kubectl scale deployment coredns -n kube-system --replicas=5

# Or use NodeLocal DNSCache
# https://kubernetes.io/docs/tasks/administer-cluster/nodelocaldns/
```

**Optimize Service Mesh:**
```yaml
# Reduce Istio sidecar resources if over-provisioned
sidecar.istio.io/proxyCPU: "100m"
sidecar.istio.io/proxyMemory: "128Mi"

# Or disable for internal, trusted services
sidecar.istio.io/inject: "false"
```

**Use HostNetwork for Network-Intensive Pods:**
```yaml
# Use with caution - bypasses pod networking
spec:
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet
```

**Enable Bandwidth Limits (QoS):**
```yaml
metadata:
  annotations:
    kubernetes.io/ingress-bandwidth: "10M"
    kubernetes.io/egress-bandwidth: "10M"
```

---

## Storage I/O Performance

### Symptoms
- Slow read/write operations
- High I/O wait
- Application timeouts during disk operations
- Database performance issues

### Investigation Commands

```bash
# Check I/O metrics on node
ssh <node> "iostat -x 1 10"

# Check disk usage
kubectl exec <pod-name> -n <namespace> -- df -h

# Check I/O wait from pod
kubectl exec <pod-name> -n <namespace> -- top

# Test storage performance
kubectl exec <pod-name> -n <namespace> -- \
  dd if=/dev/zero of=/data/test bs=1M count=1024 conv=fdatasync

# Check PV performance class
kubectl get pv <pv-name> -o yaml | grep storageClassName
kubectl describe storageclass <storage-class-name>
```

### Storage Benchmarking

**Deploy fio for benchmarking:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: fio-benchmark
spec:
  containers:
  - name: fio
    image: ljishen/fio
    command: ["/bin/sh", "-c"]
    args:
    - |
      fio --name=seqread --rw=read --bs=1M --size=1G --runtime=60 --filename=/data/test
      fio --name=seqwrite --rw=write --bs=1M --size=1G --runtime=60 --filename=/data/test
      fio --name=randread --rw=randread --bs=4k --size=1G --runtime=60 --filename=/data/test
      fio --name=randwrite --rw=randwrite --bs=4k --size=1G --runtime=60 --filename=/data/test
    volumeMounts:
    - name: data
      mountPath: /data
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: test-pvc
```

### Solutions

**Use Higher Performance Storage Class:**
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: high-performance-pvc
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: gp3  # or io2, premium-rwo (GKE), etc.
  resources:
    requests:
      storage: 100Gi
```

**Provision IOPS (AWS EBS io2):**
```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: io2-high-iops
provisioner: ebs.csi.aws.com
parameters:
  type: io2
  iops: "10000"
  fsType: ext4
volumeBindingMode: WaitForFirstConsumer
```

**Use Local NVMe for Ultra-Low Latency:**
```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-nvme
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-pv
spec:
  capacity:
    storage: 100Gi
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: local-nvme
  local:
    path: /mnt/disks/nvme0n1
  nodeAffinity:
    required:
      nodeSelectorTerms:
      - matchExpressions:
        - key: kubernetes.io/hostname
          operator: In
          values:
          - node-with-nvme
```

---

## Application-Level Metrics

### Expose Prometheus Metrics

**Add metrics endpoint to application:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: app-metrics
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "8080"
    prometheus.io/path: "/metrics"
spec:
  selector:
    app: myapp
  ports:
  - name: metrics
    port: 8080
    targetPort: 8080
```

### Key Metrics to Monitor

**Application metrics:**
- Request rate
- Request latency (p50, p95, p99)
- Error rate
- Active connections
- Queue depth
- Cache hit rate

**Example Prometheus queries:**
```promql
# P95 latency
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# Error rate
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# Request rate
sum(rate(http_requests_total[5m]))
```

### Distributed Tracing

**Implement OpenTelemetry:**
```yaml
# Deploy Jaeger
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jaeger
spec:
  template:
    spec:
      containers:
      - name: jaeger
        image: jaegertracing/all-in-one:latest
        ports:
        - containerPort: 16686  # UI
        - containerPort: 14268  # Collector
```

**Instrument application:**
- Add OpenTelemetry SDK to application
- Configure trace export to Jaeger
- Analyze end-to-end request traces to identify bottlenecks

---

## Cluster-Wide Performance

### Cluster Resource Utilization

```bash
# Overall cluster capacity
kubectl top nodes

# Total resources
kubectl describe nodes | grep -A 5 "Allocated resources"

# Resource requests vs limits
kubectl get pods --all-namespaces -o json | \
  jq -r '.items[] | "\(.metadata.namespace)/\(.metadata.name) \(.spec.containers[].resources)"'
```

### Control Plane Performance

```bash
# Check API server latency
kubectl get --raw /metrics | grep apiserver_request_duration_seconds

# Check etcd performance
kubectl exec -it -n kube-system etcd-<node> -- \
  etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  check perf

# Controller manager metrics
kubectl get --raw /metrics | grep workqueue_depth
```

### Scheduler Performance

```bash
# Check scheduler latency
kubectl get --raw /metrics | grep scheduler_scheduling_duration_seconds

# Check pending pods
kubectl get pods --all-namespaces --field-selector status.phase=Pending

# Scheduler logs
kubectl logs -n kube-system kube-scheduler-<node>
```

### Solutions for Cluster-Wide Issues

**Scale Control Plane:**
- Add more control plane nodes
- Increase API server replicas
- Tune etcd (increase memory, use SSD)

**Optimize Scheduling:**
- Use pod priority and preemption
- Implement pod topology spread constraints
- Use node affinity/anti-affinity appropriately

**Resource Management:**
- Set appropriate resource requests and limits
- Use LimitRanges and ResourceQuotas
- Implement VerticalPodAutoscaler for right-sizing

---

## Performance Optimization Checklist

### Application Level
- [ ] Implement connection pooling
- [ ] Enable response caching
- [ ] Optimize database queries
- [ ] Use async/non-blocking I/O
- [ ] Implement circuit breakers
- [ ] Profile and optimize hot paths

### Kubernetes Level
- [ ] Set appropriate resource requests/limits
- [ ] Use HPA for auto-scaling
- [ ] Implement readiness/liveness probes correctly
- [ ] Use anti-affinity for high-availability
- [ ] Optimize container image size
- [ ] Use multi-stage builds

### Infrastructure Level
- [ ] Use appropriate instance/node types
- [ ] Enable cluster autoscaling
- [ ] Use high-performance storage classes
- [ ] Optimize network topology
- [ ] Implement monitoring and alerting
- [ ] Regular performance testing

---

## Monitoring Tools

**Essential tools:**
- **Prometheus + Grafana**: Metrics and dashboards
- **Jaeger/Zipkin**: Distributed tracing
- **kube-state-metrics**: Kubernetes object metrics
- **node-exporter**: Node-level metrics
- **cAdvisor**: Container metrics
- **kubectl-flamegraph**: CPU profiling

**Commercial options:**
- Datadog
- New Relic
- Dynatrace
- Elastic APM
