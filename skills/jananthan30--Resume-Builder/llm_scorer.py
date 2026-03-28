"""
LLM-Augmented Resume Scorer v1.0
================================
Uses Claude as a rubric-driven secondary scorer for resume-JD alignment.
Complements the rules-based ATS and HR scorers with semantic understanding.

Usage:
    from llm_scorer import score_with_llm
    result = score_with_llm(resume_text, jd_text)
    # Returns: {"ats_score": float, "hr_score": float, "dimensions": {...}, "explanation": str}
"""

import json
import os
from typing import Dict, Any, Optional, Tuple, List

# Try to import Anthropic SDK
try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False

# PII redaction (strip personal info before sending to external LLM)
from pii_redactor import redact_text


def score_with_llm(
    resume_text: str,
    jd_text: str,
    model: str = "claude-sonnet-4-6",
    temperature: float = 0.0,
    domain_hint: Optional[str] = None
) -> Dict[str, Any]:
    """
    Score a resume against a JD using Claude as a rubric-driven scorer.

    Returns calibrated numeric scores with evidence-based justification.

    Args:
        resume_text: Full resume text
        jd_text: Full job description text
        model: Claude model to use
        temperature: 0.0 for maximum consistency
        domain_hint: Optional domain (clinical_research, pharma_biotech, etc.)

    Returns:
        Dictionary with:
        - ats_score: 0-100 ATS alignment score
        - hr_score: 0-100 HR fit score
        - dimensions: Per-dimension scores and evidence
        - explanation: Human-readable summary
        - model_used: Which model produced the scores
    """
    if not ANTHROPIC_AVAILABLE:
        return {
            'error': 'anthropic package not installed',
            'ats_score': None,
            'hr_score': None,
            'dimensions': {},
            'explanation': 'LLM scoring unavailable - install anthropic package'
        }

    client = anthropic.Anthropic()  # Uses ANTHROPIC_API_KEY env var

    # Redact PII before sending to external LLM API
    resume_text = redact_text(resume_text)
    jd_text = redact_text(jd_text)

    domain_context = ""
    if domain_hint:
        domain_context = f"\nDomain context: This is a {domain_hint.replace('_', ' ')} role. Weight domain-specific terminology and experience accordingly."

    scoring_prompt = f"""You are an expert recruiter and hiring manager AND an ATS (Applicant Tracking System) simulator. You will score a resume against a job description on two independent scales.

SCORING INSTRUCTIONS:
1. First, identify evidence from the resume for each scoring dimension listed below.
2. Then assign a score from 0-5 for each dimension based ONLY on the evidence you found.
3. Compute weighted scores as specified below.
4. Return ONLY valid JSON in the exact schema shown at the end.

{domain_context}

ATS SCORING DIMENSIONS (simulate keyword/phrase matching):
- keyword_match (weight 0.20): How many JD-specific nouns, skills, and technical terms appear in the resume? Score 5 if 80%+ of key terms present.
- phrase_match (weight 0.25): Do exact 2-4 word JD phrases appear verbatim in the resume? Exact phrases correlate 10.6x with callbacks.
- industry_terms (weight 0.15): Are domain-critical terms present (e.g., terms specific to the role's domain)?
- semantic_similarity (weight 0.10): Does the resume use similar vocabulary and phrasing as the JD? Score 5 if language closely mirrors JD.
- bm25_relevance (weight 0.10): Overall term frequency alignment between resume and JD.
- graph_centrality (weight 0.05): Are related/inferred skills from the same skill cluster present?
- skill_recency (weight 0.05): Are the most important skills demonstrated in recent roles (not just older positions)?
- job_title_match (weight 0.10): Does the exact JD job title appear in the resume header or summary?

HR SCORING DIMENSIONS (simulate recruiter evaluation):
- job_fit (weight 0.25): Does this candidate's background align with what this role ACTUALLY needs? Consider domain, function, and therapeutic area.
- experience_fit (weight 0.20): Do the candidate's years and type of experience match requirements? Consider Goldilocks zone (not too junior, not too senior).
- skills_in_action (weight 0.20): Are required skills demonstrated through action (verb + skill + result) rather than just listed? Action demonstration = 2x value.
- impact_signals (weight 0.15): Do 50%+ of bullets contain quantified metrics (%, $, numbers)? Score magnitude: $M/$B = highest.
- career_trajectory (weight 0.10): Is there a clear upward progression in title/responsibility over time?
- competitive_edge (weight 0.10): Prestige signals — top-tier companies, universities, publications, board certifications.

HR RISK PENALTIES (deduct from raw HR score):
- Job hopping: If average tenure < 18 months, note penalty of -8 to -15 points
- Unexplained gaps: If gaps > 6 months without explanation, note -5 to -15 points

CALIBRATION GUIDELINES:
- An ATS score of 75-85% represents a strong, authentic match (don't inflate)
- An HR score of 70+ means "INTERVIEW recommended"
- A perfect 100% is virtually impossible — it would mean the resume was written for this exact role
- Be honest about gaps and misalignments, don't inflate scores to be nice
- Weight evidence over impressions

OUTPUT JSON SCHEMA (return ONLY this JSON, no other text):
{{
  "ats_score": <float 0-100>,
  "hr_score": <float 0-100>,
  "dimensions": {{
    "ats": {{
      "keyword_match": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "phrase_match": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "industry_terms": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "semantic_similarity": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "bm25_relevance": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "graph_centrality": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "skill_recency": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "job_title_match": {{"score": <0-5>, "evidence": "<brief evidence>"}}
    }},
    "hr": {{
      "job_fit": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "experience_fit": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "skills_in_action": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "impact_signals": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "career_trajectory": {{"score": <0-5>, "evidence": "<brief evidence>"}},
      "competitive_edge": {{"score": <0-5>, "evidence": "<brief evidence>"}}
    }}
  }},
  "hr_penalties": {{
    "job_hopping": <0 or negative number>,
    "gaps": <0 or negative number>,
    "notes": "<brief explanation if penalties applied>"
  }},
  "explanation": "<2-3 sentence summary of overall fit, key strengths, and top concern>",
  "domain_detected": "<detected domain>"
}}

JOB DESCRIPTION:
{jd_text}

RESUME:
{resume_text}"""

    try:
        response = client.messages.create(
            model=model,
            max_tokens=2000,
            temperature=temperature,
            messages=[
                {"role": "user", "content": scoring_prompt}
            ]
        )

        # Extract JSON from response
        response_text = response.content[0].text.strip()

        # Handle potential markdown code block wrapping
        if response_text.startswith("```"):
            # Remove ```json and trailing ```
            lines = response_text.split('\n')
            json_lines = [l for l in lines if not l.strip().startswith('```')]
            response_text = '\n'.join(json_lines)

        result = json.loads(response_text)
        result['model_used'] = model
        result['scorer'] = 'llm_augmented'

        return result

    except json.JSONDecodeError as e:
        return {
            'error': f'Failed to parse LLM response as JSON: {str(e)}',
            'raw_response': response_text[:500] if 'response_text' in dir() else 'No response',
            'ats_score': None,
            'hr_score': None,
            'dimensions': {},
            'explanation': 'LLM scoring failed - JSON parse error'
        }
    except anthropic.APIError as e:
        return {
            'error': f'Anthropic API error: {str(e)}',
            'ats_score': None,
            'hr_score': None,
            'dimensions': {},
            'explanation': f'LLM scoring failed - API error: {str(e)}'
        }
    except Exception as e:
        return {
            'error': f'Unexpected error: {str(e)}',
            'ats_score': None,
            'hr_score': None,
            'dimensions': {},
            'explanation': f'LLM scoring failed: {str(e)}'
        }


def rewrite_resume(
    resume_text: str,
    jd_text: str,
    model: str = "claude-sonnet-4-6",
    temperature: float = 0.3,
    domain_hint: Optional[str] = None,
    format_style: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Rewrite/tailor a resume to match a job description using Claude.

    Follows authenticity rules: never changes job titles, company names, dates,
    education, publications, or certifications. Only modifies summary,
    core competencies, and bullet point phrasing.

    Returns:
        - rewritten_resume: Full rewritten resume text
        - changes_made: List of changes applied
        - explanation: Summary of what was changed and why
    """
    if not ANTHROPIC_AVAILABLE:
        return {
            "error": "anthropic package not installed",
            "rewritten_resume": None,
            "changes_made": [],
            "explanation": "LLM rewriting unavailable",
        }

    client = anthropic.Anthropic()

    domain_context = ""
    if domain_hint:
        domain_context = f"\nDomain: This is a {domain_hint.replace('_', ' ')} role."

    _FORMAT_INSTRUCTIONS = {
        "harvard": """
FORMAT STYLE — Harvard Classic:
- Center the name (first line) and contact info (second line)
- Section headers: bold, left-aligned, with a line underneath (e.g. "EDUCATION")
- List Education BEFORE Professional Experience
- Job entries: use "Company, Location" on one line (bold), then "Title | Date range" on the next
- Write in formal, scholarly tone — full sentences in summary, detailed bullet points
- Use longer, more detailed bullets that show depth of knowledge
- Dates right-aligned where possible (format: "Month Year – Month Year")
- No decorative symbols; use plain hyphens (-) for bullets if needed
""",
        "modern": """
FORMAT STYLE — Modern Clean:
- Left-align name (first line), contact on second line — keep concise
- Section headers: ALL CAPS with a short line before and after (e.g. "─── EXPERIENCE ───")
- Job entries: "TITLE | Company | Location" (pipe-separated, title first in CAPS)
- Use crisp, action-packed bullets — 1 line each where possible
- Contemporary, energetic tone — avoid stuffy corporate language
- Highlight measurable results in every bullet (%, $, numbers)
- Keep summary to 2 punchy sentences maximum
""",
        "executive": """
FORMAT STYLE — Executive Classic:
- Center the name (first line) and contact info (second line)
- Section headers: centered, ALL CAPS, bold
- Job entries: "JOB TITLE | COMPANY NAME | Location" (bold, left-aligned), dates on next line
- Write in a senior leadership tone — strategic, high-level, board-room language
- Bullets should emphasize P&L impact, organizational scale, strategic vision
- Lead every bullet with a powerful action verb (Spearheaded, Orchestrated, Transformed)
- Summary should be 3-4 sentences positioning candidate as a senior leader
- Avoid technical jargon; focus on business outcomes and stakeholder value
""",
        "ats": """
FORMAT STYLE — ATS Optimized:
- Name on first line, contact info on second line
- Section headers: ALL CAPS (e.g. "PROFESSIONAL EXPERIENCE")
- Job entries: "JOB TITLE | COMPANY NAME | Location" (pipe-separated)
- Bullet points using • character
- Horizontal separators using underscores (___) between sections
- Keyword-dense but natural — prioritize ATS keyword matching
""",
    }

    format_ctx = _FORMAT_INSTRUCTIONS.get(format_style or "ats", _FORMAT_INSTRUCTIONS["ats"])

    rewrite_prompt = f"""You are an expert resume writer who tailors resumes for specific job descriptions.

TASK: Rewrite the resume below to better match the job description. Return the FULL rewritten resume text.

FORMATTING RULES — CRITICAL:
- NEVER use markdown formatting. No **bold**, no *italic*, no # headers, no backticks.
- Use plain text only. Section headers in ALL CAPS. Bullets using the • character.

STRICT AUTHENTICITY RULES — YOU MUST FOLLOW THESE:
1. NEVER change job titles — keep them EXACTLY as they are
2. NEVER change company names — keep them EXACTLY as they are
3. NEVER change dates or employment periods
4. NEVER change education (degree names, school names, dates)
5. NEVER change publications or citations
6. NEVER change certifications or licenses
7. NEVER invent new experience, roles, or achievements
8. Each keyword should appear 1-2 times MAX across the entire resume
9. Do NOT force awkward phrases just to match JD terminology

WHAT YOU CAN MODIFY:
1. Professional Summary — naturally incorporate 3-5 key JD terms; open with a strong action verb or result
2. Core Competencies — reorder and swap skills to match JD keywords (this is the PRIMARY place for keyword matching)
3. Bullet points in Professional Experience — reframe existing achievements using JD language where it fits naturally

HUMAN WRITING QUALITY — make this read like a senior professional, not an AI:

BURSTINESS — vary bullet lengths deliberately (uniform length = AI tell):
  SHORT (6-10 words):   "Cut protocol review time by 40%."
  MEDIUM (11-18 words): "Developed safety protocols now adopted across 12 hospital departments."
  LONG (19-28 words):   "Coordinated multi-site IRB submissions for three concurrent Phase II
                         studies, ensuring 100% on-time approval and zero protocol deviations
                         over 18 months."
  Rule: never 3+ bullets in a row at the same approximate length (±3 words).
  Target per job block: 1-2 short, 3-4 medium, 1-2 long.

GRAMMATICAL VARIETY — do NOT start every bullet with an action verb:
  Action verb lead (standard): "Led 8-site trial enrolling 1,200 patients."
  Noun-led (distinctive):      "Key architect of 3-year safety program that reduced SAEs by 22%."
  Participial (texture):       "Working across 5 departments, unified data governance standards
                                adopted company-wide."
  Result-led (punchy):         "Zero protocol deviations over 18 months — achieved via rigorous
                                site monitoring framework."
  Rule: at least 2 bullets per job block must NOT start with a plain action verb.

FORBIDDEN VERBS — HR readers flag these as AI-generated instantly. NEVER USE:
  Spearheaded, Leveraged, Utilized, Facilitated, Ensured, Demonstrated, Collaborated,
  Streamlined, Championed, Fostered, Harnessed, Navigated, Liaised, Interfaced
USE INSTEAD:
  Level 4 (Impact):    Generated, Saved, Grew, Cut, Drove, Won, Built, Secured
  Level 3 (Directive): Led, Directed, Launched, Transformed, Redesigned, Negotiated, Established
  Level 2 (Managerial): Managed, Ran, Trained, Developed, Hired, Coordinated
  Mix levels — never all one level within a single job block.

QUANTIFICATION — 60%+ of bullets MUST contain a hard number:
  Specific: "reduced turnaround from 14 to 6 days" not "improved turnaround significantly"
  Numbers before nouns: "8 clinical sites" not "multiple sites"
  Qualifying language when exact data unavailable: "~50 patients", "team of ~12"
  Magnitude preference: % and $ over generic counts where both options exist.

TEXTURE DETAILS — include one real-world specific detail per job block:
  Examples: "...using Medidata Rave", "...per ICH E6(R2) guidelines",
            "...despite COVID-19 site closures", "...coordinating 6 time zones"
  This distinguishes lived experience from generic AI output.

SUMMARY RULES — sound like a senior practitioner, not a career-coach template:
  Sentence 1: specific number claim ("Physician-scientist with 9 years across 3 therapeutic areas")
  NEVER WRITE: "proven track record", "passionate about", "dynamic professional", "results-driven"
  Sentence 2: the ONE differentiator for this specific role
  Sentence 3: forward-looking alignment with company/role mission
  Max 4 sentences total.

HR SCORE OPTIMIZATION:
- Show career progression in summary ("with X years of escalating responsibility in…")
- Highlight prestigious institutions, certifications, or publications naturally
- PRESERVE the exact section header format of the original resume — do NOT change section names or separators

{domain_context}
{format_ctx}
OUTPUT FORMAT — Return ONLY valid JSON:
{{
  "rewritten_resume": "<the full rewritten resume text>",
  "changes_made": [
    "Changed summary to include X, Y, Z keywords",
    "Reordered core competencies to prioritize JD skills",
    "Reframed bullet in Role X to highlight Y"
  ],
  "explanation": "<2-3 sentence summary of the tailoring strategy>"
}}

JOB DESCRIPTION:
{jd_text}

ORIGINAL RESUME:
{resume_text}"""

    try:
        response = client.messages.create(
            model=model,
            max_tokens=8000,
            temperature=temperature,
            messages=[{"role": "user", "content": rewrite_prompt}],
        )

        response_text = response.content[0].text.strip()

        # Handle markdown code block wrapping
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            json_lines = [l for l in lines if not l.strip().startswith("```")]
            response_text = "\n".join(json_lines)

        result = json.loads(response_text)
        result["model_used"] = model
        # Strip any markdown asterisks the LLM may have added despite instructions
        if isinstance(result.get("rewritten_resume"), str):
            import re as _re
            result["rewritten_resume"] = _re.sub(r"\*+", "", result["rewritten_resume"])
        return result

    except json.JSONDecodeError as e:
        return {
            "error": f"Failed to parse LLM response: {str(e)}",
            "rewritten_resume": None,
            "changes_made": [],
            "explanation": "Rewrite failed — JSON parse error",
        }
    except anthropic.APIError as e:
        return {
            "error": f"Anthropic API error: {str(e)}",
            "rewritten_resume": None,
            "changes_made": [],
            "explanation": f"Rewrite failed — API error",
        }
    except Exception as e:
        return {
            "error": f"Unexpected error: {str(e)}",
            "rewritten_resume": None,
            "changes_made": [],
            "explanation": f"Rewrite failed: {str(e)}",
        }


def coach_red_flags(
    resume_text: str,
    jd_text: str,
    score_context: Optional[Dict[str, Any]] = None,
    chat_history: Optional[List[Dict[str, str]]] = None,
    model: str = "claude-sonnet-4-6",
    temperature: float = 0.3,
    domain_hint: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Diagnose score-driven resume red flags, ask follow-up questions, and fix them.

    The first response should usually prioritize the top red flags and ask only the
    missing questions needed to improve the resume honestly. After user answers are
    available, the model may return a rewritten resume that addresses those flags.
    """
    if not ANTHROPIC_AVAILABLE:
        return {
            "error": "anthropic package not installed",
            "assistant_message": "LLM coaching unavailable - install anthropic package",
            "red_flags": [],
            "follow_up_questions": [],
            "needs_user_input": False,
            "suggested_fixes": [],
            "rewritten_resume": None,
            "changes_made": [],
        }

    client = anthropic.Anthropic()
    resume_text = redact_text(resume_text)
    jd_text = redact_text(jd_text)

    domain_context = ""
    if domain_hint:
        domain_context = f"\nDomain context: This is a {domain_hint.replace('_', ' ')} role."

    context_json = json.dumps(score_context or {}, indent=2)
    history_json = json.dumps(chat_history or [], indent=2)

    prompt = f"""You are an expert resume coach focused on fixing the highest-risk red flags that block interviews.

OBJECTIVE:
1. Read the ATS/HR/LLM score context below.
2. Identify the most important red flags.
3. If critical information is missing, ask up to 3 precise follow-up questions.
4. If the user has already answered enough, rewrite the resume to fix those red flags honestly.

STRICT RULES:
- Never invent employers, titles, dates, degrees, publications, certifications, metrics, or achievements.
- Only use information from the resume, the score context, and the chat history.
- Keep every suggestion grounded in the score evidence.
- Prioritize the 1-3 highest-impact fixes, not a laundry list.
- Ask follow-up questions only when the answer materially changes the rewrite.
- If enough info is already available, do not ask filler questions.

RED FLAG CATEGORIES TO LOOK FOR:
- ATS: missing keywords, weak phrase match, title mismatch, missing domain terms
- HR: weak job fit, thin skills-in-action evidence, lack of metrics, career risk, weak competitive edge
- LLM: explicit concerns, penalties, or evidence gaps

FOLLOW-UP QUESTION STYLE:
- Specific and answerable
- Tied to a red flag
- Designed to unlock a resume improvement
- Maximum 3 questions total

OUTPUT FORMAT:
Return ONLY valid JSON in this schema:
{{
  "assistant_message": "<what you would tell the user right now>",
  "red_flags": [
    {{
      "title": "<short label>",
      "severity": "high|medium|low",
      "evidence": "<what in the score/resume triggered it>",
      "why_it_hurts": "<why this hurts interviews>",
      "fix_strategy": "<what to change>"
    }}
  ],
  "follow_up_questions": ["<question 1>", "<question 2>"],
  "needs_user_input": <true or false>,
  "suggested_fixes": ["<specific fix>", "<specific fix>"],
  "rewritten_resume": "<full rewritten resume or null>",
  "changes_made": ["<change 1>", "<change 2>"]
}}

If enough user context is NOT available, set "needs_user_input" to true and "rewritten_resume" to null.
If enough user context IS available, set "needs_user_input" to false and return the full rewritten resume.

{domain_context}

SCORE CONTEXT:
{context_json}

CHAT HISTORY:
{history_json}

JOB DESCRIPTION:
{jd_text}

RESUME:
{resume_text}"""

    try:
        response = client.messages.create(
            model=model,
            max_tokens=6000,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}],
        )

        response_text = response.content[0].text.strip()
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            json_lines = [line for line in lines if not line.strip().startswith("```")]
            response_text = "\n".join(json_lines)

        result = json.loads(response_text)
        result["model_used"] = model
        return result

    except json.JSONDecodeError as e:
        return {
            "error": f"Failed to parse LLM response: {str(e)}",
            "assistant_message": "Red-flag coaching failed due to a response formatting error.",
            "red_flags": [],
            "follow_up_questions": [],
            "needs_user_input": False,
            "suggested_fixes": [],
            "rewritten_resume": None,
            "changes_made": [],
        }
    except anthropic.APIError as e:
        return {
            "error": f"Anthropic API error: {str(e)}",
            "assistant_message": "Red-flag coaching failed due to an LLM API error.",
            "red_flags": [],
            "follow_up_questions": [],
            "needs_user_input": False,
            "suggested_fixes": [],
            "rewritten_resume": None,
            "changes_made": [],
        }
    except Exception as e:
        return {
            "error": f"Unexpected error: {str(e)}",
            "assistant_message": "Red-flag coaching failed unexpectedly.",
            "red_flags": [],
            "follow_up_questions": [],
            "needs_user_input": False,
            "suggested_fixes": [],
            "rewritten_resume": None,
            "changes_made": [],
        }


def generate_cover_letter(
    resume_text: str,
    jd_text: str,
    company_name: str = "",
    job_title: str = "",
    model: str = "claude-sonnet-4-6",
    temperature: float = 0.4,
) -> Dict[str, Any]:
    """
    Generate a tailored cover letter using Claude.

    Returns:
        - paragraphs: List of 4-5 paragraph strings (ready for DOCX generator)
        - full_text: Complete cover letter as a single string
        - company: Detected or provided company name
        - job_title: Detected or provided job title
        - word_count: Total word count
    """
    if not ANTHROPIC_AVAILABLE:
        return {
            "error": "anthropic package not installed",
            "paragraphs": [],
            "full_text": "",
        }

    client = anthropic.Anthropic()

    prompt = f"""You are an expert career coach and professional cover letter writer.

TASK: Write a compelling, ready-to-send cover letter for the job description below,
based on the candidate's resume. The letter should feel personal and authentic — NOT
like a template.

STRUCTURE (4 paragraphs):
1. OPENING HOOK: Express genuine enthusiasm for the role. Immediately highlight
   the strongest qualification match. Show you understand what the role needs.
2. VALUE PROPOSITION: Connect 3-4 specific experiences from the resume to key
   requirements. Use brief STAR format (Situation → Action → Result). Include
   quantified achievements where possible.
3. COMPANY CONNECTION: Show knowledge of the company. Explain why this specific
   company appeals to you beyond generic reasons.
4. STRONG CLOSE: Express confidence, include a clear call to action, thank the reader.

RULES:
- Max 350-400 words total (ONE page)
- Professional but personable tone
- NO placeholder text like [Your Address] or [Company Values]
- NO invented achievements — only reference what's in the resume
- Use specific JD keywords naturally (don't stuff them)
- Ready to send immediately — no blanks to fill in

OUTPUT FORMAT — Return ONLY valid JSON:
{{
  "paragraphs": [
    "First paragraph text...",
    "Second paragraph text...",
    "Third paragraph text...",
    "Fourth paragraph text..."
  ],
  "company": "{company_name or 'detected company name'}",
  "job_title": "{job_title or 'detected job title'}"
}}

JOB DESCRIPTION:
{jd_text}

CANDIDATE RESUME:
{resume_text}"""

    try:
        response = client.messages.create(
            model=model,
            max_tokens=4000,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}],
        )

        response_text = response.content[0].text.strip()

        # Handle markdown code block wrapping
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            json_lines = [l for l in lines if not l.strip().startswith("```")]
            response_text = "\n".join(json_lines)

        result = json.loads(response_text)

        paragraphs = result.get("paragraphs", [])
        full_text = "\n\n".join(paragraphs)

        return {
            "paragraphs": paragraphs,
            "full_text": full_text,
            "company": result.get("company", company_name),
            "job_title": result.get("job_title", job_title),
            "word_count": len(full_text.split()),
            "model_used": model,
        }

    except json.JSONDecodeError as e:
        return {
            "error": f"Failed to parse LLM response: {str(e)}",
            "paragraphs": [],
            "full_text": "",
        }
    except anthropic.APIError as e:
        return {
            "error": f"Anthropic API error: {str(e)}",
            "paragraphs": [],
            "full_text": "",
        }
    except Exception as e:
        return {
            "error": f"Unexpected error: {str(e)}",
            "paragraphs": [],
            "full_text": "",
        }


def combine_scores(
    rules_ats: float,
    rules_hr: float,
    llm_result: Dict[str, Any],
    llm_weight: float = 0.3
) -> Tuple[float, float, Dict[str, Any]]:
    """
    Combine rules-based and LLM scores with configurable weighting.

    Default: 70% rules-based + 30% LLM (rules-based is the primary scorer).

    Args:
        rules_ats: ATS score from ats_scorer.py (0-100)
        rules_hr: HR score from hr_scorer.py (0-100)
        llm_result: Result dict from score_with_llm()
        llm_weight: Weight given to LLM scores (0.0-1.0, default 0.3)

    Returns:
        combined_ats: Blended ATS score
        combined_hr: Blended HR score
        details: Breakdown of scoring sources
    """
    rules_weight = 1.0 - llm_weight

    llm_ats = llm_result.get('ats_score')
    llm_hr = llm_result.get('hr_score')

    if llm_ats is None or llm_hr is None:
        # LLM scoring failed — use rules-based scores only
        return rules_ats, rules_hr, {
            'method': 'rules_only',
            'reason': llm_result.get('error', 'LLM scores unavailable'),
            'rules_ats': rules_ats,
            'rules_hr': rules_hr
        }

    combined_ats = rules_ats * rules_weight + llm_ats * llm_weight
    combined_hr = rules_hr * rules_weight + llm_hr * llm_weight

    details = {
        'method': 'blended',
        'rules_weight': rules_weight,
        'llm_weight': llm_weight,
        'rules_ats': rules_ats,
        'rules_hr': rules_hr,
        'llm_ats': llm_ats,
        'llm_hr': llm_hr,
        'combined_ats': round(combined_ats, 1),
        'combined_hr': round(combined_hr, 1),
        'llm_explanation': llm_result.get('explanation', ''),
        'llm_domain': llm_result.get('domain_detected', ''),
        'model_used': llm_result.get('model_used', 'unknown')
    }

    return round(combined_ats, 1), round(combined_hr, 1), details


# CLI interface
if __name__ == '__main__':
    import argparse
    import sys

    parser = argparse.ArgumentParser(description='LLM-Augmented Resume Scorer')
    parser.add_argument('resume_path', help='Path to resume file')
    parser.add_argument('jd_path', help='Path to job description file')
    parser.add_argument('--model', default='claude-sonnet-4-6', help='Claude model to use')
    parser.add_argument('--json', action='store_true', help='Output raw JSON')
    parser.add_argument('--domain', help='Domain hint (clinical_research, pharma_biotech, etc.)')

    args = parser.parse_args()

    # Read files
    with open(args.resume_path, 'r', encoding='utf-8') as f:
        resume_text = f.read()
    with open(args.jd_path, 'r', encoding='utf-8') as f:
        jd_text = f.read()

    result = score_with_llm(resume_text, jd_text, model=args.model, domain_hint=args.domain)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if result.get('error'):
            print(f"Error: {result['error']}")
            sys.exit(1)

        print(f"\n{'='*60}")
        print(f"  LLM-AUGMENTED SCORING REPORT")
        print(f"{'='*60}")
        print(f"  ATS Score: {result['ats_score']:.1f}%")
        print(f"  HR Score:  {result['hr_score']:.1f}%")
        print(f"  Domain:    {result.get('domain_detected', 'unknown')}")
        print(f"{'='*60}")
        print(f"\n  {result.get('explanation', '')}")

        # Show dimension breakdown
        if 'dimensions' in result:
            print(f"\n  ATS Dimensions:")
            for dim, data in result['dimensions'].get('ats', {}).items():
                print(f"    {dim}: {data['score']}/5 — {data['evidence']}")

            print(f"\n  HR Dimensions:")
            for dim, data in result['dimensions'].get('hr', {}).items():
                print(f"    {dim}: {data['score']}/5 — {data['evidence']}")

        if result.get('hr_penalties', {}).get('notes'):
            print(f"\n  Penalties: {result['hr_penalties']['notes']}")

        print(f"\n  Model: {result.get('model_used', 'unknown')}")
        print(f"{'='*60}")
