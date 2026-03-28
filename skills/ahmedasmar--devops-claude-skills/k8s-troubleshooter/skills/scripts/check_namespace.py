#!/usr/bin/env python3
"""
Kubernetes Namespace Health Check
Performs comprehensive health diagnostics for a specific namespace
"""
import argparse
import json
import subprocess
import sys
from typing import Dict, List, Any
from datetime import datetime


def run_kubectl(args: List[str], namespace: str = None) -> Dict[str, Any]:
    """Run kubectl command and return parsed JSON"""
    cmd = ['kubectl'] + args
    if namespace and '-n' not in args and '--namespace' not in args:
        cmd.extend(['-n', namespace])

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True
        )
        if result.stdout:
            return json.loads(result.stdout)
        return {}
    except subprocess.CalledProcessError as e:
        return {"error": e.stderr}
    except json.JSONDecodeError:
        return {"error": "Failed to parse kubectl output", "output": result.stdout}


def check_pods(namespace: str) -> Dict[str, Any]:
    """Check pod health in namespace"""
    pods = run_kubectl(['get', 'pods', '-o', 'json'], namespace)

    if 'error' in pods:
        return pods

    results = {
        "total": 0,
        "running": 0,
        "pending": 0,
        "failed": 0,
        "succeeded": 0,
        "crashlooping": 0,
        "image_pull_errors": 0,
        "issues": [],
        "healthy_pods": [],
        "unhealthy_pods": []
    }

    for pod in pods.get('items', []):
        name = pod['metadata']['name']
        phase = pod.get('status', {}).get('phase', 'Unknown')
        results["total"] += 1

        # Check container statuses
        container_statuses = pod.get('status', {}).get('containerStatuses', [])
        restart_count = sum(c.get('restartCount', 0) for c in container_statuses)

        # Categorize pod status
        if phase == 'Running':
            all_ready = all(c.get('ready', False) for c in container_statuses)
            if all_ready and restart_count < 5:
                results["running"] += 1
                results["healthy_pods"].append(name)
            else:
                results["running"] += 1
                if restart_count >= 5:
                    results["crashlooping"] += 1
                    results["issues"].append(f"Pod {name}: High restart count ({restart_count})")
                    results["unhealthy_pods"].append(name)
                if not all_ready:
                    results["issues"].append(f"Pod {name}: Not all containers ready")
                    results["unhealthy_pods"].append(name)

        elif phase == 'Pending':
            results["pending"] += 1
            results["issues"].append(f"Pod {name}: Stuck in Pending state")
            results["unhealthy_pods"].append(name)

        elif phase == 'Failed':
            results["failed"] += 1
            results["issues"].append(f"Pod {name}: Failed")
            results["unhealthy_pods"].append(name)

        elif phase == 'Succeeded':
            results["succeeded"] += 1

        # Check for ImagePullBackOff
        for container_status in container_statuses:
            waiting = container_status.get('state', {}).get('waiting', {})
            reason = waiting.get('reason', '')
            if 'ImagePull' in reason or 'ErrImagePull' in reason:
                results["image_pull_errors"] += 1
                if name not in results["unhealthy_pods"]:
                    results["unhealthy_pods"].append(name)
                results["issues"].append(f"Pod {name}: {reason}")

    return results


def check_services(namespace: str) -> Dict[str, Any]:
    """Check services and their endpoints"""
    services = run_kubectl(['get', 'services', '-o', 'json'], namespace)

    if 'error' in services:
        return services

    results = {
        "total": 0,
        "with_endpoints": 0,
        "without_endpoints": 0,
        "load_balancers": 0,
        "load_balancers_pending": 0,
        "issues": []
    }

    for svc in services.get('items', []):
        name = svc['metadata']['name']
        svc_type = svc['spec'].get('type', 'ClusterIP')
        results["total"] += 1

        # Check endpoints
        endpoints = run_kubectl(['get', 'endpoints', name, '-o', 'json'], namespace)
        if 'error' not in endpoints:
            subsets = endpoints.get('subsets', [])
            if subsets and any(s.get('addresses', []) for s in subsets):
                results["with_endpoints"] += 1
            else:
                results["without_endpoints"] += 1
                results["issues"].append(f"Service {name}: No endpoints (no pods matching selector)")

        # Check LoadBalancer status
        if svc_type == 'LoadBalancer':
            results["load_balancers"] += 1
            lb_ingress = svc['status'].get('loadBalancer', {}).get('ingress', [])
            if not lb_ingress:
                results["load_balancers_pending"] += 1
                results["issues"].append(f"Service {name}: LoadBalancer stuck in Pending")

    return results


def check_deployments(namespace: str) -> Dict[str, Any]:
    """Check deployment health"""
    deployments = run_kubectl(['get', 'deployments', '-o', 'json'], namespace)

    if 'error' in deployments:
        return deployments

    results = {
        "total": 0,
        "available": 0,
        "unavailable": 0,
        "progressing": 0,
        "issues": []
    }

    for deploy in deployments.get('items', []):
        name = deploy['metadata']['name']
        results["total"] += 1

        status = deploy.get('status', {})
        replicas = status.get('replicas', 0)
        ready_replicas = status.get('readyReplicas', 0)
        available_replicas = status.get('availableReplicas', 0)

        if available_replicas == replicas and available_replicas > 0:
            results["available"] += 1
        elif available_replicas == 0:
            results["unavailable"] += 1
            results["issues"].append(f"Deployment {name}: No replicas available ({ready_replicas}/{replicas})")
        else:
            results["progressing"] += 1
            results["issues"].append(f"Deployment {name}: Partially available ({available_replicas}/{replicas})")

    return results


def check_pvcs(namespace: str) -> Dict[str, Any]:
    """Check PersistentVolumeClaims"""
    pvcs = run_kubectl(['get', 'pvc', '-o', 'json'], namespace)

    if 'error' in pvcs:
        return pvcs

    results = {
        "total": 0,
        "bound": 0,
        "pending": 0,
        "lost": 0,
        "issues": []
    }

    for pvc in pvcs.get('items', []):
        name = pvc['metadata']['name']
        phase = pvc.get('status', {}).get('phase', 'Unknown')
        results["total"] += 1

        if phase == 'Bound':
            results["bound"] += 1
        elif phase == 'Pending':
            results["pending"] += 1
            results["issues"].append(f"PVC {name}: Stuck in Pending state")
        elif phase == 'Lost':
            results["lost"] += 1
            results["issues"].append(f"PVC {name}: Volume lost")

    return results


def check_resource_quotas(namespace: str) -> Dict[str, Any]:
    """Check resource quotas and usage"""
    quotas = run_kubectl(['get', 'resourcequota', '-o', 'json'], namespace)

    if 'error' in quotas:
        return {"total": 0, "issues": []}

    results = {
        "total": 0,
        "near_limit": [],
        "exceeded": [],
        "issues": []
    }

    for quota in quotas.get('items', []):
        name = quota['metadata']['name']
        results["total"] += 1

        status = quota.get('status', {})
        hard = status.get('hard', {})
        used = status.get('used', {})

        for resource, limit in hard.items():
            usage = used.get(resource, '0')

            # Parse values (handle different formats: CPU, memory, counts)
            try:
                if resource.endswith('memory'):
                    # Convert to bytes for comparison
                    limit_val = parse_memory(limit)
                    usage_val = parse_memory(usage)
                elif resource.endswith('cpu'):
                    # Convert to millicores
                    limit_val = parse_cpu(limit)
                    usage_val = parse_cpu(usage)
                else:
                    # Plain numbers
                    limit_val = int(limit)
                    usage_val = int(usage)

                if limit_val > 0:
                    usage_percent = (usage_val / limit_val) * 100

                    if usage_percent >= 100:
                        results["exceeded"].append(resource)
                        results["issues"].append(f"Quota {name}: {resource} exceeded ({usage}/{limit})")
                    elif usage_percent >= 80:
                        results["near_limit"].append(resource)
                        results["issues"].append(f"Quota {name}: {resource} near limit ({usage}/{limit}, {usage_percent:.0f}%)")

            except (ValueError, AttributeError):
                continue

    return results


def parse_memory(value: str) -> int:
    """Parse memory string to bytes"""
    units = {'Ki': 1024, 'Mi': 1024**2, 'Gi': 1024**3, 'Ti': 1024**4}
    for unit, multiplier in units.items():
        if value.endswith(unit):
            return int(value[:-2]) * multiplier
    return int(value)


def parse_cpu(value: str) -> int:
    """Parse CPU string to millicores"""
    if value.endswith('m'):
        return int(value[:-1])
    return int(float(value) * 1000)


def get_recent_events(namespace: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Get recent events in namespace"""
    events = run_kubectl(['get', 'events', '--sort-by=.lastTimestamp', '-o', 'json'], namespace)

    if 'error' in events:
        return []

    recent_events = []
    for event in events.get('items', [])[-limit:]:
        recent_events.append({
            "type": event.get('type', 'Unknown'),
            "reason": event.get('reason', ''),
            "message": event.get('message', ''),
            "object": f"{event.get('involvedObject', {}).get('kind', '')}/{event.get('involvedObject', {}).get('name', '')}",
            "count": event.get('count', 1),
            "last_timestamp": event.get('lastTimestamp', '')
        })

    return recent_events


def generate_recommendations(results: Dict[str, Any]) -> List[str]:
    """Generate actionable recommendations based on findings"""
    recommendations = []

    # Pod recommendations
    if results['pods']['pending'] > 0:
        recommendations.append("⚠️  Check pending pods with: kubectl describe pod <pod-name> -n <namespace>")
        recommendations.append("⚠️  Verify node resources: kubectl describe nodes")

    if results['pods']['crashlooping'] > 0:
        recommendations.append("⚠️  Investigate crashlooping pods: kubectl logs <pod-name> -n <namespace> --previous")

    if results['pods']['image_pull_errors'] > 0:
        recommendations.append("⚠️  Fix image pull errors: verify image name, check imagePullSecrets")

    # Service recommendations
    if results['services']['without_endpoints'] > 0:
        recommendations.append("⚠️  Services without endpoints: check pod selectors match pod labels")

    if results['services']['load_balancers_pending'] > 0:
        recommendations.append("⚠️  LoadBalancer stuck: check cloud provider controller logs")

    # Deployment recommendations
    if results['deployments']['unavailable'] > 0:
        recommendations.append("⚠️  Unavailable deployments: check pod errors and resource availability")

    # PVC recommendations
    if results['pvcs']['pending'] > 0:
        recommendations.append("⚠️  Pending PVCs: verify StorageClass exists and provisioner is working")

    # Quota recommendations
    if results['quotas']['exceeded']:
        recommendations.append(f"🚨 Resource quotas exceeded: {', '.join(results['quotas']['exceeded'])}")
        recommendations.append("🚨 Action required: increase quota or reduce resource requests")

    if results['quotas']['near_limit']:
        recommendations.append(f"⚠️  Near quota limits: {', '.join(results['quotas']['near_limit'])}")

    if not recommendations:
        recommendations.append("✅ No critical issues detected")

    return recommendations


def main():
    parser = argparse.ArgumentParser(
        description="Comprehensive health check for a Kubernetes namespace",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Check namespace with human-readable output
  %(prog)s my-namespace

  # Output as JSON
  %(prog)s my-namespace --json

  # Include more events
  %(prog)s my-namespace --events 20
        """
    )

    parser.add_argument(
        "namespace",
        help="Namespace to check"
    )

    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON"
    )

    parser.add_argument(
        "--events",
        type=int,
        default=10,
        help="Number of recent events to include (default: 10)"
    )

    args = parser.parse_args()

    # Perform all checks
    results = {
        "namespace": args.namespace,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "pods": check_pods(args.namespace),
        "services": check_services(args.namespace),
        "deployments": check_deployments(args.namespace),
        "pvcs": check_pvcs(args.namespace),
        "quotas": check_resource_quotas(args.namespace),
        "recent_events": get_recent_events(args.namespace, args.events)
    }

    # Generate recommendations
    results["recommendations"] = generate_recommendations(results)

    # Determine overall health
    total_issues = (
        len(results["pods"].get("issues", [])) +
        len(results["services"].get("issues", [])) +
        len(results["deployments"].get("issues", [])) +
        len(results["pvcs"].get("issues", [])) +
        len(results["quotas"].get("issues", []))
    )

    results["health_status"] = "healthy" if total_issues == 0 else "degraded" if total_issues < 5 else "critical"

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        # Human-readable output
        print(f"🔍 Namespace Health Check: {args.namespace}")
        print(f"⏰ Timestamp: {results['timestamp']}")
        print(f"📊 Overall Status: {results['health_status'].upper()}\n")

        # Pods
        print("📦 Pods:")
        print(f"   Total: {results['pods']['total']}")
        print(f"   Running: {results['pods']['running']}")
        print(f"   Pending: {results['pods']['pending']}")
        print(f"   Failed: {results['pods']['failed']}")
        if results['pods']['crashlooping'] > 0:
            print(f"   ⚠️  CrashLooping: {results['pods']['crashlooping']}")
        if results['pods']['image_pull_errors'] > 0:
            print(f"   ⚠️  ImagePull Errors: {results['pods']['image_pull_errors']}")
        print()

        # Services
        print("🌐 Services:")
        print(f"   Total: {results['services']['total']}")
        print(f"   With Endpoints: {results['services']['with_endpoints']}")
        if results['services']['without_endpoints'] > 0:
            print(f"   ⚠️  Without Endpoints: {results['services']['without_endpoints']}")
        if results['services']['load_balancers_pending'] > 0:
            print(f"   ⚠️  LB Pending: {results['services']['load_balancers_pending']}")
        print()

        # Deployments
        if results['deployments']['total'] > 0:
            print("🚀 Deployments:")
            print(f"   Total: {results['deployments']['total']}")
            print(f"   Available: {results['deployments']['available']}")
            if results['deployments']['unavailable'] > 0:
                print(f"   ⚠️  Unavailable: {results['deployments']['unavailable']}")
            print()

        # PVCs
        if results['pvcs']['total'] > 0:
            print("💾 PersistentVolumeClaims:")
            print(f"   Total: {results['pvcs']['total']}")
            print(f"   Bound: {results['pvcs']['bound']}")
            if results['pvcs']['pending'] > 0:
                print(f"   ⚠️  Pending: {results['pvcs']['pending']}")
            print()

        # Quotas
        if results['quotas']['total'] > 0:
            print("📏 Resource Quotas:")
            print(f"   Total: {results['quotas']['total']}")
            if results['quotas']['exceeded']:
                print(f"   🚨 Exceeded: {', '.join(results['quotas']['exceeded'])}")
            if results['quotas']['near_limit']:
                print(f"   ⚠️  Near Limit: {', '.join(results['quotas']['near_limit'])}")
            print()

        # Issues
        if total_issues > 0:
            print(f"⚠️  Issues ({total_issues}):")
            all_issues = (
                results["pods"].get("issues", []) +
                results["services"].get("issues", []) +
                results["deployments"].get("issues", []) +
                results["pvcs"].get("issues", []) +
                results["quotas"].get("issues", [])
            )
            for issue in all_issues[:10]:  # Show first 10
                print(f"   - {issue}")
            if len(all_issues) > 10:
                print(f"   ... and {len(all_issues) - 10} more (use --json for full list)")
            print()

        # Recommendations
        print("💡 Recommendations:")
        for rec in results["recommendations"]:
            print(f"   {rec}")

    sys.exit(0 if results["health_status"] in ["healthy", "degraded"] else 1)


if __name__ == "__main__":
    main()
