#!/usr/bin/env python3
"""
trigger-server.py - GitHub webhook receiver for loki-mode event-driven execution.

Listens for GitHub webhook events and automatically runs `loki run` in response.
Supports signature validation, dry-run mode, and event logging.

Usage:
    python3 autonomy/trigger-server.py [--port PORT] [--secret SECRET] [--dry-run]
"""

import argparse
import hashlib
import hmac
import http.server
import json
import logging
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path


def get_loki_dir():
    """Return .loki/triggers directory, creating it if needed."""
    loki_dir = Path(".loki") / "triggers"
    loki_dir.mkdir(parents=True, exist_ok=True)
    return loki_dir


def load_config():
    """Load trigger config from .loki/triggers/config.json."""
    config_path = get_loki_dir() / "config.json"
    defaults = {
        "port": 7373,
        "secret": "",
        "dry_run": False,
        "enabled_events": ["issues", "pull_request", "workflow_run"],
    }
    if config_path.exists():
        try:
            with open(config_path) as f:
                stored = json.load(f)
            defaults.update(stored)
        except (json.JSONDecodeError, OSError):
            pass
    return defaults


def save_config(config):
    """Save trigger config to .loki/triggers/config.json."""
    config_path = get_loki_dir() / "config.json"
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)


def log_event(event_type, action, payload_summary, status):
    """Append event to .loki/triggers/events.log."""
    log_path = get_loki_dir() / "events.log"
    timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    entry = {
        "timestamp": timestamp,
        "event": event_type,
        "action": action,
        "summary": payload_summary,
        "status": status,
    }
    with open(log_path, "a") as f:
        f.write(json.dumps(entry) + "\n")


def validate_signature(secret, body, signature_header):
    """Validate GitHub HMAC-SHA256 webhook signature."""
    if not secret:
        return True  # No secret configured - accept all
    if not signature_header:
        return False
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)


def send_notification(message):
    """Send desktop notification via loki syslog."""
    try:
        subprocess.run(
            ["loki", "syslog", message],
            timeout=5,
            capture_output=True,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass


def run_loki_command(args, dry_run=False):
    """Run a loki command, or print it if dry_run is True."""
    cmd = ["loki"] + args
    if dry_run:
        logging.info("[DRY-RUN] Would run: %s", " ".join(cmd))
        return True
    logging.info("Running: %s", " ".join(cmd))
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        # Don't wait - detached execution
        logging.info("Started process pid=%d", proc.pid)
        return True
    except (FileNotFoundError, OSError) as e:
        logging.error("Failed to run %s: %s", " ".join(cmd), e)
        return False


def handle_issues_event(payload, dry_run=False):
    """Handle issues event: opened -> loki run <issue_number> --pr --detach."""
    action = payload.get("action", "")
    if action != "opened":
        return None, "skipped (action=%s)" % action
    issue = payload.get("issue", {})
    issue_number = issue.get("number")
    repo = payload.get("repository", {})
    repo_full_name = repo.get("full_name", "")
    if not issue_number:
        return None, "skipped (no issue number)"
    args = ["run", str(issue_number), "--pr", "--detach"]
    if repo_full_name:
        args = ["run", "%s#%s" % (repo_full_name, issue_number), "--pr", "--detach"]
    summary = "issue #%s opened in %s" % (issue_number, repo_full_name)
    success = run_loki_command(args, dry_run=dry_run)
    status = "fired" if success else "error"
    if success:
        send_notification("Trigger fired: %s" % summary)
    return summary, status


def handle_pull_request_event(payload, dry_run=False):
    """Handle pull_request event: synchronize -> loki run <pr_number> --detach."""
    action = payload.get("action", "")
    if action != "synchronize":
        return None, "skipped (action=%s)" % action
    pr = payload.get("pull_request", {})
    pr_number = pr.get("number")
    repo = payload.get("repository", {})
    repo_full_name = repo.get("full_name", "")
    if not pr_number:
        return None, "skipped (no PR number)"
    args = ["run", str(pr_number), "--detach"]
    if repo_full_name:
        args = ["run", "%s#%s" % (repo_full_name, pr_number), "--detach"]
    summary = "PR #%s synchronized in %s" % (pr_number, repo_full_name)
    success = run_loki_command(args, dry_run=dry_run)
    status = "fired" if success else "error"
    if success:
        send_notification("Trigger fired: %s" % summary)
    return summary, status


def handle_workflow_run_event(payload, dry_run=False):
    """Handle workflow_run event: completed+failure -> loki run with context."""
    action = payload.get("action", "")
    if action != "completed":
        return None, "skipped (action=%s)" % action
    wf = payload.get("workflow_run", {})
    conclusion = wf.get("conclusion", "")
    if conclusion != "failure":
        return None, "skipped (conclusion=%s)" % conclusion
    wf_name = wf.get("name", "unknown")
    repo = payload.get("repository", {})
    repo_full_name = repo.get("full_name", "")
    summary = "workflow '%s' failed in %s" % (wf_name, repo_full_name)
    # Run loki run with failure context note
    args = ["run", "--detach"]
    success = run_loki_command(args, dry_run=dry_run)
    status = "fired" if success else "error"
    if success:
        send_notification("Trigger fired: CI failure - %s" % summary)
    return summary, status


class WebhookHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler for GitHub webhooks."""

    dry_run = False
    secret = ""

    def log_message(self, format, *args):
        logging.info("%s - %s", self.address_string(), format % args)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "service": "loki-trigger-server"})
        elif self.path == "/status":
            config = load_config()
            self._send_json(200, {
                "status": "running",
                "dry_run": self.dry_run,
                "port": config.get("port", 7373),
                "enabled_events": config.get("enabled_events", []),
            })
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/webhook":
            self._send_json(404, {"error": "not found"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        event_type = self.headers.get("X-GitHub-Event", "")
        signature = self.headers.get("X-Hub-Signature-256", "")

        if not validate_signature(self.secret, body, signature):
            logging.warning("Invalid webhook signature")
            self._send_json(401, {"error": "invalid signature"})
            return

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid JSON"})
            return

        action = payload.get("action", "")
        summary = None
        status = "unhandled"

        if event_type == "issues":
            summary, status = handle_issues_event(payload, dry_run=self.dry_run)
        elif event_type == "pull_request":
            summary, status = handle_pull_request_event(payload, dry_run=self.dry_run)
        elif event_type == "workflow_run":
            summary, status = handle_workflow_run_event(payload, dry_run=self.dry_run)
        else:
            status = "unsupported event: %s" % event_type

        log_event(event_type, action, summary or "", status)
        self._send_json(200, {"event": event_type, "action": action, "status": status})

    def _send_json(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def write_pid_file():
    """Write PID to .loki/triggers/server.pid."""
    pid_path = get_loki_dir() / "server.pid"
    with open(pid_path, "w") as f:
        f.write(str(os.getpid()))


def main():
    parser = argparse.ArgumentParser(
        description="loki-mode GitHub webhook trigger server"
    )
    parser.add_argument("--port", type=int, default=None, help="Port to listen on (default: 7373)")
    parser.add_argument("--secret", default=None, help="GitHub webhook secret for HMAC validation")
    parser.add_argument("--dry-run", action="store_true", help="Preview triggers without running loki")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%SZ",
    )

    config = load_config()
    port = args.port if args.port is not None else config.get("port", 7373)
    secret = args.secret if args.secret is not None else config.get("secret", "")
    dry_run = args.dry_run or config.get("dry_run", False)

    # Update config with resolved values
    config["port"] = port
    config["secret"] = secret
    config["dry_run"] = dry_run
    save_config(config)

    WebhookHandler.dry_run = dry_run
    WebhookHandler.secret = secret

    server = http.server.HTTPServer(("", port), WebhookHandler)
    write_pid_file()

    mode_label = " [DRY-RUN]" if dry_run else ""
    logging.info("Loki trigger server starting on port %d%s", port, mode_label)
    logging.info("Webhook endpoint: POST http://localhost:%d/webhook", port)
    logging.info("Health check: GET http://localhost:%d/health", port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("Trigger server stopped.")
        pid_path = get_loki_dir() / "server.pid"
        pid_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
