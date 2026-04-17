# Creative Research Methodology

Coordinator-only. Produces a RESEARCH_BRIEF (max 10 lines) for executor consumption.

## Triggers

Research when ANY condition met:
- **P4b reset** (mandatory — always research during reset)
- **3-strike stuck** detection fired (rule 12)
- **New technology** discovered not covered by mounted skill files
- **No hypothesis** at P2 Think phase — nothing obvious to try next

Skip when: clear next experiment exists, previous batch gave useful signal.

## Three Sources

### 1. Model Knowledge

Brainstorm from training data. Ask yourself:
- Known CVEs for the exact version/tech in scope?
- Uncommon attack chains? (e.g., SSRF -> cloud metadata -> RCE)
- Edge-case behaviors of this specific framework? (e.g., Spring4Shell, Rails param parsing, PHP type juggling)
- Techniques from CTF writeups, bug bounty disclosures for this tech?
- Protocol-level quirks? (HTTP/2 desync, WebSocket smuggling, DNS rebinding)
- Less obvious vectors? (race conditions, cache poisoning, mass assignment, TOCTOU)

Output: 3-5 bullet hypotheses with reasoning.

### 2. Skill Cross-Reference

Scan `reference/ATTACK_INDEX.md` for untried categories:
- Which attack types haven't been tested against this target?
- Do any skill reference files mention this tech stack specifically?
- Can two different attack types chain? (SSRF + deserialization, LFI + log poisoning, IDOR + mass assignment)
- Any skill recently updated with a technique matching this scenario?

### 3. Online Research 

Pick 2-3 of the most relevant search queries:
- `"{technology} {version}" vulnerability exploit 2025 2026`
- `"{technology}" bypass WAF filter evasion`
- `"{technology}" bug bounty writeup`
- `"{technology}" HackerOne disclosed report`
- `"{technology}" CVE proof of concept`
- `"{specific behavior observed}" exploit technique`
- `"{error message or header}" vulnerability`
- `"{technology}" pentest methodology site:book.hacktricks.xyz`

WebFetch rules:
- Only fetch pages that look like technique writeups, PoC descriptions, or detailed advisories
- Extract: technique name, payload pattern, conditions for exploitation, version affected
- Skip: marketing pages, generic overviews, tool download pages, paywalled content
- Max 2 fetches per research cycle
- If first 2 searches return noise, stop — don't burn the third

## Synthesis -> RESEARCH_BRIEF

Combine all three sources into max 10 lines:

```
RESEARCH_BRIEF:
- [model] Hypothesis: <what + why it might work>
- [web] Technique: <name> -- <key payload/pattern> (src: <URL>)
- [skills] Untried: <attack category> -- relevant because <reason>
- [chain] Idea: <A -> B -> C> combining findings from above
- [web] CVE-YYYY-NNNNN: <version affected, exploit type> (src: <URL>)
```

Rules:
- Max 10 lines total
- Each line must be actionable (not "maybe look into X")
- Include source tag so executor knows confidence level
- Prioritize novel combinations over well-known techniques already tried
- If online research found nothing useful, say so in 1 line and move on
- Run `python3 tools/nvd-lookup.py <CVE-ID>` for any CVEs discovered

## Budget

- Max 3 WebSearch calls per research cycle
- Max 2 WebFetch calls per research cycle
- Total research phase: < 2 minutes wall time
- If search returns noise after 2 queries, stop early and proceed with model knowledge

## Anti-Patterns

- DO NOT research every batch — only at trigger points
- DO NOT pass raw WebFetch HTML to executors — always distill into RESEARCH_BRIEF
- DO NOT spend > 2 lines on any single hypothesis
- DO NOT research topics already well-covered by mounted skill files
- DO NOT let research delay execution — if no useful results in 2 minutes, proceed with model knowledge only
- DO NOT repeat research on the same technology in consecutive cycles — log what you searched
