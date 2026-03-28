#!/usr/bin/env python3
"""
Comprehensive Pod Diagnostics Script
Analyzes a pod's health and returns structured diagnostic information
"""
import json
import subprocess
import sys
from typing import Dict, List, Any

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

def check_pod_status(namespace: str, pod: str) -> Dict[str, Any]:
    """Get pod status and basic info"""
    return run_kubectl(['get', 'pod', pod, '-n', namespace, '-o', 'json'])

def check_events(namespace: str, pod: str) -> Dict[str, Any]:
    """Get events related to the pod"""
    return run_kubectl(['get', 'events', '-n', namespace, 
                       '--field-selector', f'involvedObject.name={pod}',
                       '-o', 'json', '--sort-by', '.lastTimestamp'])

def check_resource_usage(namespace: str, pod: str) -> Dict[str, Any]:
    """Get resource usage if metrics server is available"""
    result = run_kubectl(['top', 'pod', pod, '-n', namespace])
    return result

def analyze_pod(pod_data: Dict[str, Any]) -> Dict[str, Any]:
    """Analyze pod data and identify issues"""
    issues = []
    recommendations = []
    
    status = pod_data.get('status', {})
    spec = pod_data.get('spec', {})
    
    # Check phase
    phase = status.get('phase', 'Unknown')
    if phase not in ['Running', 'Succeeded']:
        issues.append(f"Pod is in {phase} phase")
    
    # Check container statuses
    container_statuses = status.get('containerStatuses', [])
    for container in container_statuses:
        name = container.get('name')
        ready = container.get('ready', False)
        
        if not ready:
            issues.append(f"Container {name} is not ready")
            
        state = container.get('state', {})
        if 'waiting' in state:
            reason = state['waiting'].get('reason', 'Unknown')
            message = state['waiting'].get('message', '')
            issues.append(f"Container {name} waiting: {reason} - {message}")
            
            if reason == 'ImagePullBackOff':
                recommendations.append("Check image name and registry credentials")
            elif reason == 'CrashLoopBackOff':
                recommendations.append(f"Check logs for container {name} to identify crash cause")
        
        if 'terminated' in state:
            reason = state['terminated'].get('reason', 'Unknown')
            exit_code = state['terminated'].get('exitCode', 0)
            issues.append(f"Container {name} terminated: {reason} (exit code {exit_code})")
            
        restart_count = container.get('restartCount', 0)
        if restart_count > 5:
            issues.append(f"Container {name} has restarted {restart_count} times")
            recommendations.append(f"Investigate crash loops in container {name}")
    
    # Check resource requests/limits
    for container in spec.get('containers', []):
        resources = container.get('resources', {})
        if not resources.get('requests'):
            recommendations.append(f"Consider setting resource requests for container {container.get('name')}")
        if not resources.get('limits'):
            recommendations.append(f"Consider setting resource limits for container {container.get('name')}")
    
    # Check restart policy
    restart_policy = spec.get('restartPolicy', 'Always')
    if restart_policy == 'Never' and issues:
        recommendations.append("Restart policy is 'Never' - pod won't restart automatically")
    
    return {
        "phase": phase,
        "issues": issues,
        "recommendations": recommendations
    }

def main():
    if len(sys.argv) != 3:
        print("Usage: diagnose_pod.py <namespace> <pod-name>")
        sys.exit(1)
    
    namespace = sys.argv[1]
    pod = sys.argv[2]
    
    print(f"🔍 Diagnosing pod: {pod} in namespace: {namespace}\n")
    
    # Get pod details
    pod_data = check_pod_status(namespace, pod)
    if 'error' in pod_data:
        print(f"❌ Error fetching pod: {pod_data['error']}")
        sys.exit(1)
    
    # Analyze pod
    analysis = analyze_pod(pod_data)
    
    print(f"📊 Pod Phase: {analysis['phase']}\n")
    
    if analysis['issues']:
        print("⚠️  Issues Found:")
        for issue in analysis['issues']:
            print(f"   • {issue}")
        print()
    else:
        print("✅ No issues detected\n")
    
    if analysis['recommendations']:
        print("💡 Recommendations:")
        for rec in analysis['recommendations']:
            print(f"   • {rec}")
        print()
    
    # Get events
    events_data = check_events(namespace, pod)
    if 'items' in events_data and events_data['items']:
        print("📋 Recent Events:")
        for event in events_data['items'][-5:]:  # Last 5 events
            msg = event.get('message', '')
            reason = event.get('reason', '')
            print(f"   • {reason}: {msg}")
        print()
    
    # Try to get resource usage
    print("📈 Resource Usage:")
    resource_data = check_resource_usage(namespace, pod)
    if 'error' not in resource_data:
        print("   (Run 'kubectl top pod' manually for current usage)")
    else:
        print("   Metrics server not available")

if __name__ == "__main__":
    main()
