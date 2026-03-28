#!/usr/bin/env python3
"""
Cluster Health Check Script
Performs comprehensive cluster health diagnostics
"""
import json
import subprocess
from typing import Dict, List, Any
from datetime import datetime

def run_kubectl(args: List[str]) -> Dict[str, Any]:
    """Run kubectl command and return parsed JSON"""
    try:
        result = subprocess.run(
            ['kubectl'] + args,
            capture_output=True,
            text=True,
            check=True
        )
        return json.loads(result.stdout) if result.stdout else {}
    except subprocess.CalledProcessError as e:
        return {"error": e.stderr}
    except json.JSONDecodeError:
        return {"error": "Failed to parse kubectl output"}

def check_nodes() -> Dict[str, Any]:
    """Check node health"""
    nodes = run_kubectl(['get', 'nodes', '-o', 'json'])
    if 'error' in nodes:
        return nodes
    
    results = {
        "healthy": 0,
        "unhealthy": 0,
        "issues": []
    }
    
    for node in nodes.get('items', []):
        name = node['metadata']['name']
        conditions = node.get('status', {}).get('conditions', [])
        
        is_ready = False
        for condition in conditions:
            if condition['type'] == 'Ready':
                is_ready = condition['status'] == 'True'
                if not is_ready:
                    results['unhealthy'] += 1
                    results['issues'].append(f"Node {name} is not Ready")
                else:
                    results['healthy'] += 1
                break
        
        # Check other conditions
        for condition in conditions:
            if condition['type'] != 'Ready' and condition['status'] == 'True':
                results['issues'].append(f"Node {name}: {condition['type']} = {condition['status']}")
    
    return results

def check_system_pods() -> Dict[str, Any]:
    """Check critical system pods"""
    namespaces = ['kube-system', 'kube-public', 'kube-node-lease']
    results = {
        "healthy": 0,
        "unhealthy": 0,
        "issues": []
    }
    
    for ns in namespaces:
        pods = run_kubectl(['get', 'pods', '-n', ns, '-o', 'json'])
        if 'error' in pods:
            continue
            
        for pod in pods.get('items', []):
            name = pod['metadata']['name']
            phase = pod.get('status', {}).get('phase', 'Unknown')
            
            if phase == 'Running':
                # Check if all containers are ready
                container_statuses = pod.get('status', {}).get('containerStatuses', [])
                all_ready = all(c.get('ready', False) for c in container_statuses)
                
                if all_ready:
                    results['healthy'] += 1
                else:
                    results['unhealthy'] += 1
                    results['issues'].append(f"Pod {ns}/{name}: Containers not ready")
            elif phase in ['Succeeded', 'Completed']:
                results['healthy'] += 1
            else:
                results['unhealthy'] += 1
                results['issues'].append(f"Pod {ns}/{name}: Phase is {phase}")
    
    return results

def check_pending_pods() -> Dict[str, Any]:
    """Check for pods stuck in pending"""
    all_pods = run_kubectl(['get', 'pods', '--all-namespaces', '-o', 'json'])
    if 'error' in all_pods:
        return all_pods
    
    pending = []
    for pod in all_pods.get('items', []):
        if pod.get('status', {}).get('phase') == 'Pending':
            name = pod['metadata']['name']
            namespace = pod['metadata']['namespace']
            pending.append(f"{namespace}/{name}")
    
    return {"count": len(pending), "pods": pending}

def check_failed_pods() -> Dict[str, Any]:
    """Check for failed pods"""
    all_pods = run_kubectl(['get', 'pods', '--all-namespaces', '-o', 'json'])
    if 'error' in all_pods:
        return all_pods
    
    failed = []
    for pod in all_pods.get('items', []):
        if pod.get('status', {}).get('phase') == 'Failed':
            name = pod['metadata']['name']
            namespace = pod['metadata']['namespace']
            failed.append(f"{namespace}/{name}")
    
    return {"count": len(failed), "pods": failed}

def check_crashloop_pods() -> Dict[str, Any]:
    """Check for pods in crash loop"""
    all_pods = run_kubectl(['get', 'pods', '--all-namespaces', '-o', 'json'])
    if 'error' in all_pods:
        return all_pods
    
    crashloop = []
    for pod in all_pods.get('items', []):
        container_statuses = pod.get('status', {}).get('containerStatuses', [])
        for container in container_statuses:
            state = container.get('state', {})
            if 'waiting' in state and 'CrashLoopBackOff' in state['waiting'].get('reason', ''):
                name = pod['metadata']['name']
                namespace = pod['metadata']['namespace']
                container_name = container['name']
                crashloop.append(f"{namespace}/{name} (container: {container_name})")
                break
    
    return {"count": len(crashloop), "pods": crashloop}

def main():
    print("🏥 Kubernetes Cluster Health Check")
    print("=" * 60)
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    # Check nodes
    print("🖥️  Node Health:")
    nodes = check_nodes()
    if 'error' not in nodes:
        print(f"   ✅ Healthy nodes: {nodes['healthy']}")
        if nodes['unhealthy'] > 0:
            print(f"   ❌ Unhealthy nodes: {nodes['unhealthy']}")
            for issue in nodes['issues']:
                print(f"      • {issue}")
    else:
        print(f"   ❌ Error: {nodes['error']}")
    print()
    
    # Check system pods
    print("🔧 System Pods:")
    system = check_system_pods()
    if 'error' not in system:
        print(f"   ✅ Healthy: {system['healthy']}")
        if system['unhealthy'] > 0:
            print(f"   ⚠️  Unhealthy: {system['unhealthy']}")
            for issue in system['issues'][:10]:  # Show first 10
                print(f"      • {issue}")
    else:
        print(f"   ❌ Error: {system['error']}")
    print()
    
    # Check pending pods
    print("⏳ Pending Pods:")
    pending = check_pending_pods()
    if 'error' not in pending:
        if pending['count'] == 0:
            print("   ✅ No pods stuck in pending")
        else:
            print(f"   ⚠️  {pending['count']} pods in pending state:")
            for pod in pending['pods'][:10]:
                print(f"      • {pod}")
    else:
        print(f"   ❌ Error: {pending['error']}")
    print()
    
    # Check failed pods
    print("💥 Failed Pods:")
    failed = check_failed_pods()
    if 'error' not in failed:
        if failed['count'] == 0:
            print("   ✅ No failed pods")
        else:
            print(f"   ❌ {failed['count']} pods in failed state:")
            for pod in failed['pods'][:10]:
                print(f"      • {pod}")
    else:
        print(f"   ❌ Error: {failed['error']}")
    print()
    
    # Check crash loops
    print("🔄 Crash Loop Pods:")
    crashloop = check_crashloop_pods()
    if 'error' not in crashloop:
        if crashloop['count'] == 0:
            print("   ✅ No pods in crash loop")
        else:
            print(f"   ❌ {crashloop['count']} pods in crash loop:")
            for pod in crashloop['pods'][:10]:
                print(f"      • {pod}")
    else:
        print(f"   ❌ Error: {crashloop['error']}")
    print()
    
    print("=" * 60)
    print("Health check complete!")

if __name__ == "__main__":
    main()
