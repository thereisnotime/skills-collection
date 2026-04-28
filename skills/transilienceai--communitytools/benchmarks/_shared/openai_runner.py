"""
Run OpenAI Codex non-interactively against a prepared benchmark workspace.

Codex uses repo instructions (`AGENTS.md`) and repo-scoped skills
(`.agents/skills`) rather than a single injected system prompt. This adapter
builds a temporary Codex-compatible workspace that reuses the existing
Transilience skill files verbatim.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Literal, Optional

from .agent_errors import classify_agent_error, extract_error_lines
from .claude_runner import AgentRunResult
from .env_loader import resolve_openai_key


def _resolve_pentest_layout(source_cwd: Path) -> tuple[Path, Path]:
    """
    Return (claude_md_path, resource_root). `resource_root` is the directory
    that holds `skills/`, `formats/`, `tools/` — either `<source_cwd>/.claude/`
    when the pentest layout is present, or the repo root as a fallback.
    """
    dot_claude = source_cwd / ".claude"
    if (dot_claude / "CLAUDE.md").exists() and (dot_claude / "skills").exists():
        return dot_claude / "CLAUDE.md", dot_claude
    repo_root = source_cwd.parent.parent
    return repo_root / "CLAUDE.md", repo_root


def _write_codex_agents_md(
    workspace: Path, claude_md: Path, skills_content: str
) -> None:
    """
    Build AGENTS.md so Codex loads it as repo instructions on every run.

    Layout:
      1. Short directive block telling Codex these instructions are authoritative.
      2. Verbatim CLAUDE.md from `projects/pentest/.claude/` (the pentest
         guideline — falls back to repo-root CLAUDE.md if the pentest one is
         missing).
      3. Full skills payload (all SKILL.md bodies + coordination reference
         files) so the model sees every available technique without waiting
         for lazy discovery.
      4. Pointer to on-disk per-skill `reference/*.md` for deeper reads.
    """
    header = (
        "# Codex Benchmark Instructions\n\n"
        "This workspace is a Transilience pentest engagement. The content "
        "below is authoritative — follow it for role, workflow, skill "
        "selection, output structure, and reporting.\n\n"
        "- The PENTEST GUIDELINE section is the project CLAUDE.md and sets "
        "the rules of engagement.\n"
        "- The PENTEST SKILLS & ROLE DEFINITIONS section contains every "
        "skill and coordination reference loaded for this run. Treat it as "
        "always in context.\n"
        "- Per-skill deep references live on disk under `.agents/skills/"
        "<skill>/reference/*.md`; read them on demand via your shell tool.\n"
        "- Tools such as `tools/env-reader.py` are available at the workspace "
        "root.\n\n"
    )

    guideline = ""
    if claude_md.exists():
        guideline = (
            "# PENTEST GUIDELINE (projects/pentest/.claude/CLAUDE.md)\n\n"
            + claude_md.read_text()
            + "\n\n"
        )

    (workspace / "AGENTS.md").write_text(header + guideline + skills_content)


def _prepare_skills_workspace(source_cwd: Path, skills_content: str) -> Path:
    workspace = Path(tempfile.mkdtemp(prefix="bench_codex_skills_"))
    claude_md, resource_root = _resolve_pentest_layout(source_cwd)

    subprocess.run(["git", "init", "-q"], cwd=workspace, check=True)
    (workspace / ".agents").mkdir(parents=True, exist_ok=True)

    link_map = {
        ".agents/skills": resource_root / "skills",
        "skills": resource_root / "skills",
        "formats": resource_root / "formats",
        "tools": resource_root / "tools",
    }
    for rel_path, target in link_map.items():
        if target.exists():
            dest = workspace / rel_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.symlink_to(target)

    _write_codex_agents_md(workspace, claude_md, skills_content)
    return workspace


def _prepare_vanilla_workspace() -> Path:
    """
    Build a fully isolated workspace with zero pentest context and zero
    markdown files that could bias the model.

    Deliberately:
      - no AGENTS.md, no CLAUDE.md, no README, no *.md at all
      - no `.agents/skills`, no skills/, no formats/, no tools/ symlinks
      - git init only, so `codex exec` doesn't require --skip-git-repo-check

    Combined with `--ignore-user-config --ignore-rules --ephemeral` on the
    codex exec command, the model sees only the raw prompt.
    """
    workspace = Path(tempfile.mkdtemp(prefix="bench_codex_vanilla_"))
    subprocess.run(["git", "init", "-q"], cwd=workspace, check=True)
    return workspace


def run_openai(
    prompt: str,
    output_dir: Path,
    *,
    mode: Literal["skills", "vanilla"],
    model: Optional[str],
    api_key: Optional[str],
    timeout: int,
    skills_cwd: Optional[Path] = None,
    skills_content: str = "",
    task_id: str = "",
) -> AgentRunResult:
    """
    Invoke `codex exec` and capture output.

    In `skills` mode, the full `skills_content` payload (pentest CLAUDE.md +
    every SKILL.md + coordination reference files) is embedded into AGENTS.md
    so Codex loads it as repo instructions. Per-skill `reference/*.md` stays
    on disk for on-demand reads via `.agents/skills/<skill>/reference/`.
    """
    tag = f"[{task_id}] " if task_id else ""
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "prompt.txt").write_text(prompt)

    if mode == "skills":
        if skills_cwd is None or not skills_cwd.exists():
            raise ValueError(
                "SKILLS mode requires skills_cwd pointing to an existing directory"
            )
        workspace = _prepare_skills_workspace(skills_cwd, skills_content)
        print(
            f"  {tag}Mode: SKILLS (Codex workspace: {workspace}, "
            f"AGENTS.md: {len(skills_content):,} bytes of skills embedded)"
        )
    else:
        workspace = _prepare_vanilla_workspace()
        print(f"  {tag}Mode: VANILLA (isolated Codex workspace: {workspace})")

    last_message_path = output_dir / "codex_last_message.txt"
    cmd = [
        "codex",
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
    ]
    if mode == "vanilla":
        # Strip every possible source of bias from Codex:
        # - --ignore-user-config: skip ~/.codex/config.toml (no default model,
        #   no MCP servers, no profiles, no project trust list leaking through)
        # - --ignore-rules: skip any user/project .rules files
        # - --ephemeral: do not persist session files, no cross-run memory
        cmd.extend([
            "--ignore-user-config",
            "--ignore-rules",
            "--ephemeral",
        ])
    cmd += [
        "-C",
        str(workspace),
        "-o",
        str(last_message_path),
    ]
    if model:
        cmd.extend(["--model", model])
    cmd.append(prompt)

    resolved_key = resolve_openai_key(api_key)
    env = dict(os.environ)
    if resolved_key:
        env["OPENAI_API_KEY"] = resolved_key
        env["CODEX_API_KEY"] = resolved_key

    start = time.time()
    try:
        result = subprocess.run(
            cmd,
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired as e:
        duration = time.time() - start
        stdout = (
            (e.stdout or "")
            if isinstance(e.stdout, str)
            else (e.stdout.decode(errors="replace") if e.stdout else "")
        )
        stderr = (
            (e.stderr or "")
            if isinstance(e.stderr, str)
            else (e.stderr.decode(errors="replace") if e.stderr else "")
        )
        (output_dir / "codex_output.txt").write_text(stdout)
        if stderr:
            (output_dir / "codex_stderr.txt").write_text(stderr)
        shutil.rmtree(workspace, ignore_errors=True)
        return AgentRunResult(
            stdout=stdout,
            stderr=stderr,
            returncode=-1,
            duration_seconds=duration,
            status="timeout",
            error=f"Timeout after {timeout}s",
        )
    except Exception as e:
        duration = time.time() - start
        shutil.rmtree(workspace, ignore_errors=True)
        return AgentRunResult(
            stdout="",
            stderr="",
            returncode=-1,
            duration_seconds=duration,
            status="error",
            error=str(e),
        )

    duration = time.time() - start
    stdout = result.stdout or ""
    stderr = result.stderr or ""
    if last_message_path.exists():
        final_message = last_message_path.read_text()
        if final_message.strip():
            stdout = final_message

    (output_dir / "codex_output.txt").write_text(stdout)
    if stderr:
        (output_dir / "codex_stderr.txt").write_text(stderr)

    shutil.rmtree(workspace, ignore_errors=True)

    status = "success" if result.returncode == 0 else "failed"
    error: Optional[str] = None
    fatal = False
    if result.returncode != 0:
        classification = classify_agent_error(stdout, stderr, result.returncode)
        if classification:
            status = "error"
            fatal = classification.is_fatal
            error = f"[{classification.kind}] {classification.message}"
        else:
            clean = extract_error_lines(stderr) or extract_error_lines(stdout)
            error = f"rc={result.returncode} duration={duration:.1f}s" + (
                f" | {clean}" if clean else ""
            )
        print(f"  {tag}Agent exited rc={result.returncode} after {duration:.1f}s")
        print(f"  {tag}{error}")
        print(f"  {tag}Full logs: {output_dir}/codex_output.txt, codex_stderr.txt")

    return AgentRunResult(
        stdout=stdout,
        stderr=stderr,
        returncode=result.returncode,
        duration_seconds=duration,
        status=status,
        error=error,
        fatal=fatal,
    )
