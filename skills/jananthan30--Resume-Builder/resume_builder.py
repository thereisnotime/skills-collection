#!/usr/bin/env python3
"""
Resume Builder CLI Tool
-----------------------
Automatically tailors your resume and generates cover letters based on job descriptions.
Creates company-specific folders with DOCX outputs.

Usage:
    python resume_builder.py

Or with Claude Code custom commands:
    /resume
    /cover-letter
"""

import os
import sys
import re
import json
from pathlib import Path
from datetime import datetime

try:
    import anthropic
except ImportError:
    print("Error: anthropic package not installed. Run: pip install anthropic")
    sys.exit(1)

try:
    import pdfplumber
except ImportError:
    print("Error: pdfplumber package not installed. Run: pip install pdfplumber")
    sys.exit(1)

try:
    from docx import Document
    from docx.shared import Pt, Inches
    from docx.enum.text import WD_ALIGN_PARAGRAPH
except ImportError:
    print("Error: python-docx package not installed. Run: pip install python-docx")
    sys.exit(1)


# Configuration
CONFIG_FILE = Path(__file__).parent / "config.json"
DEFAULT_CONFIG = {
    "master_resume_path": "YOUR_MASTER_RESUME.docx",
    "output_base_dir": "applications",
    "user_name": "Your Name",
    "user_credentials": "",
    "user_email": "your.email@example.com",
    "user_phone": "555-123-4567",
    "user_linkedin": "linkedin.com/in/your-profile",
    "user_city": "Your City",
    "user_state": "ST",
    "user_zip": "00000"
}

# Values that indicate the user hasn't customized their config
_PLACEHOLDER_VALUES = {
    "master_resume_path": "YOUR_MASTER_RESUME.docx",
    "user_name": "Your Name",
    "user_email": "your.email@example.com",
    "user_phone": "555-123-4567",
    "user_linkedin": "linkedin.com/in/your-profile",
    "user_city": "Your City",
    "user_state": "ST",
    "user_zip": "00000",
}


def validate_config(config):
    """Check if any config fields still have default placeholder values and warn the user."""
    warnings = []
    for field, placeholder in _PLACEHOLDER_VALUES.items():
        if config.get(field) == placeholder:
            warnings.append(f"  - {field}: still set to default '{placeholder}'")
    if warnings:
        print("WARNING: The following config.json fields have not been customized:")
        for w in warnings:
            print(w)
        print("Edit config.json to set your personal details.\n")


def load_config():
    """Load configuration from config.json or create default."""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)
        # Backfill any new keys from DEFAULT_CONFIG
        updated = False
        for key, value in DEFAULT_CONFIG.items():
            if key not in config:
                config[key] = value
                updated = True
        if updated:
            save_config(config)
        validate_config(config)
        return config
    else:
        save_config(DEFAULT_CONFIG)
        validate_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG


def save_config(config):
    """Save configuration to config.json."""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)


def extract_text_from_file(file_path: str) -> str:
    """Extract text content from a resume file (PDF, DOCX, MD, TXT)."""
    ext = Path(file_path).suffix.lower()
    text = ""
    try:
        if ext == ".pdf":
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
        elif ext == ".docx":
            doc = Document(file_path)
            text = "\n".join(para.text for para in doc.paragraphs)
        elif ext in (".md", ".txt"):
            with open(file_path, "r", encoding="utf-8") as f:
                text = f.read()
        else:
            print(f"Error: Unsupported file format '{ext}'. Supported: .pdf, .docx, .md, .txt")
            sys.exit(1)
    except Exception as e:
        print(f"Error reading {ext} file: {e}")
        sys.exit(1)
    return text


def extract_company_name(job_description: str) -> str:
    """Extract company name from job description using common patterns."""
    # Common patterns for company names
    patterns = [
        r"(?:at|@|for|with)\s+([A-Z][A-Za-z0-9\s&]+?)(?:\s+is|\s+we|\s*[,\.])",
        r"^([A-Z][A-Za-z0-9\s&]+?)\s+(?:is looking|is seeking|is hiring)",
        r"Company:\s*([A-Za-z0-9\s&]+)",
        r"About\s+([A-Z][A-Za-z0-9\s&]+?)(?:\s*:|\s*\n)",
    ]

    for pattern in patterns:
        match = re.search(pattern, job_description, re.MULTILINE)
        if match:
            company = match.group(1).strip()
            # Clean up common suffixes
            company = re.sub(r'\s+(Inc|LLC|Ltd|Corp|Corporation)\.?$', '', company, flags=re.IGNORECASE)
            if len(company) > 2 and len(company) < 50:
                return company

    return None


def get_job_title(job_description: str) -> str:
    """Extract job title from job description."""
    patterns = [
        r"(?:Position|Title|Role|Job Title):\s*([^\n]+)",
        r"^([A-Z][A-Za-z\s\-/]+?)\s*(?:\n|$)",
        r"hiring\s+(?:a|an)\s+([A-Za-z\s\-/]+?)(?:\s+to|\s+who|\s*\.)",
    ]

    for pattern in patterns:
        match = re.search(pattern, job_description, re.MULTILINE | re.IGNORECASE)
        if match:
            title = match.group(1).strip()
            if len(title) > 3 and len(title) < 100:
                return title

    return "Position"


def sanitize_folder_name(name: str) -> str:
    """Convert string to safe folder name."""
    # Remove or replace invalid characters
    safe_name = re.sub(r'[<>:"/\\|?*]', '', name)
    safe_name = re.sub(r'\s+', '_', safe_name)
    return safe_name[:50]  # Limit length


def create_output_folder(company_name: str, config: dict) -> Path:
    """Create and return the output folder path for a company."""
    base_dir = Path(__file__).parent / config.get("output_base_dir", "applications")

    if not company_name:
        company_name = f"Application_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    folder_name = sanitize_folder_name(company_name)
    output_dir = base_dir / folder_name

    # Handle existing folders by adding timestamp
    if output_dir.exists():
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_dir = base_dir / f"{folder_name}_{timestamp}"

    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def optimize_resume_with_claude(resume_text: str, job_description: str, client: anthropic.Anthropic) -> str:
    """Use Claude to optimize resume based on job description."""

    prompt = f"""Role: Expert Senior Recruiter and Hiring Manager with 20+ years of experience in ATS optimization.

Task: Rewrite the user's resume to maximize ATS compatibility and match the Target Job Description (JD).

Input Data:
1. User Resume:
{resume_text}

2. Target Job Description:
{job_description}

Instructions:
1. **Semantic Mapping**: Replace generic terms with JD-specific keywords.
   - Map existing skills/experience to the exact terminology used in the JD
   - Ensure keywords appear naturally in context, not just listed

2. **Gap Analysis**: Identify the top 5 hard requirements in the JD. Ensure the Resume Summary explicitly addresses these skills with evidence.

3. **Prioritization**: Reorder experience bullets to lead with the most relevant achievements for this specific role.

4. **Quantification**: Add metrics where possible (%, $, #) to strengthen impact statements.

5. **Format Requirements**:
   - Keep total length to 1-2 pages maximum
   - Use clear section headers: SUMMARY, EXPERIENCE, EDUCATION, SKILLS, CERTIFICATIONS
   - Use bullet points for achievements
   - Include relevant keywords in the Skills section

6. **Output Format**: Provide the complete rewritten resume in clean, professional format.

CRITICAL CONSTRAINT: Do not invent experience or credentials. Only reframe and highlight existing experience using the JD's terminology."""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}]
    )

    return message.content[0].text


def generate_cover_letter_with_claude(resume_text: str, job_description: str, company_name: str, job_title: str, config: dict, client: anthropic.Anthropic) -> str:
    """Use Claude to generate a tailored cover letter."""

    user_name = config.get("user_name", "")

    prompt = f"""Role: Expert Career Coach and Professional Writer specializing in compelling cover letters.

Task: Write a persuasive one-page cover letter for the following job application.

Input Data:
1. Applicant Resume:
{resume_text}

2. Target Job Description:
{job_description}

3. Company Name: {company_name or "the company"}
4. Job Title: {job_title}
5. Applicant Name: {user_name}

Instructions:
1. **Opening Hook**: Start with a compelling statement that shows genuine interest and immediately highlights the strongest qualification match.

2. **Value Proposition**: In the body, connect 3-4 specific experiences from the resume to key requirements in the JD. Use the STAR method briefly (Situation, Task, Action, Result).

3. **Company Research Connection**: Reference something specific about the company/role that shows research and genuine interest.

4. **Cultural Fit**: Demonstrate alignment with company values or mission if mentioned in JD.

5. **Strong Close**: End with confidence, a clear call to action, and enthusiasm for the opportunity.

Format Requirements:
- Maximum ONE page (350-400 words)
- Professional but personable tone
- 4-5 paragraphs maximum
- Do NOT include placeholder brackets like [Your Address] - write as if ready to send
- Start directly with the greeting (Dear Hiring Manager, or Dear [Company] Team,)

Output the complete cover letter text only, ready to be formatted."""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}]
    )

    return message.content[0].text


def save_as_docx(content: str, output_path: Path, doc_type: str = "resume"):
    """Save content as a formatted DOCX file."""
    doc = Document()

    # Set up document margins
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(0.75)
        section.bottom_margin = Inches(0.75)
        section.left_margin = Inches(0.75)
        section.right_margin = Inches(0.75)

    # Parse and add content
    lines = content.split('\n')

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Handle headers (markdown style or ALL CAPS)
        if line.startswith('# '):
            p = doc.add_paragraph()
            run = p.add_run(line[2:])
            run.bold = True
            run.font.size = Pt(16)
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif line.startswith('## ') or line.isupper():
            p = doc.add_paragraph()
            text = line[3:] if line.startswith('## ') else line
            run = p.add_run(text)
            run.bold = True
            run.font.size = Pt(12)
        elif line.startswith('### '):
            p = doc.add_paragraph()
            run = p.add_run(line[4:])
            run.bold = True
            run.font.size = Pt(11)
        elif line.startswith('- ') or line.startswith('* ') or line.startswith('• '):
            # Bullet points
            text = line[2:] if line.startswith(('- ', '* ')) else line[2:]
            p = doc.add_paragraph(text, style='List Bullet')
            p.paragraph_format.space_after = Pt(3)
        elif line.startswith('**') and line.endswith('**'):
            # Bold text
            p = doc.add_paragraph()
            run = p.add_run(line[2:-2])
            run.bold = True
        else:
            # Regular paragraph
            p = doc.add_paragraph(line)
            p.paragraph_format.space_after = Pt(6)

    doc.save(output_path)
    print(f"Saved: {output_path}")


def get_multiline_input(prompt_text: str) -> str:
    """Get multi-line input from user."""
    print(prompt_text)
    print("(Enter your text, then type 'END' on a new line when done)")
    print("-" * 50)

    lines = []
    while True:
        try:
            line = input()
            if line.strip().upper() == 'END':
                break
            lines.append(line)
        except EOFError:
            break

    return '\n'.join(lines)


def main():
    """Main CLI entry point."""
    print("\n" + "=" * 60)
    print("       RESUME BUILDER - AI-Powered Job Application Tool")
    print("=" * 60 + "\n")

    # Load configuration
    config = load_config()

    # Check for API key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set.")
        print("Set it with: export ANTHROPIC_API_KEY='your-key-here'")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    # Get master resume path
    resume_path = Path(__file__).parent / config["master_resume_path"]
    if not resume_path.exists():
        print(f"Error: Master resume not found at {resume_path}")
        print("Update config.json with the correct path.")
        sys.exit(1)

    print(f"Master Resume: {resume_path.name}")

    # Extract resume text
    print("Extracting resume content...")
    resume_text = extract_text_from_file(str(resume_path))

    if not resume_text.strip():
        print(f"Error: Could not extract text from resume ({resume_path.suffix}).")
        sys.exit(1)

    print(f"Extracted {len(resume_text)} characters from resume.\n")

    # Get job description
    job_description = get_multiline_input("Paste the Job Description:")

    if not job_description.strip():
        print("Error: No job description provided.")
        sys.exit(1)

    # Extract company name and job title
    print("\nAnalyzing job description...")
    company_name = extract_company_name(job_description)
    job_title = get_job_title(job_description)

    # Confirm or get company name
    if company_name:
        confirm = input(f"Detected company: {company_name}. Correct? (y/n): ").strip().lower()
        if confirm != 'y':
            company_name = input("Enter company name: ").strip()
    else:
        company_name = input("Enter company name: ").strip()

    # Confirm or get job title
    if job_title != "Position":
        confirm = input(f"Detected job title: {job_title}. Correct? (y/n): ").strip().lower()
        if confirm != 'y':
            job_title = input("Enter job title: ").strip()
    else:
        job_title = input("Enter job title: ").strip()

    # Create output folder
    output_dir = create_output_folder(company_name, config)
    print(f"\nOutput folder: {output_dir}")

    # Generate tailored resume
    print("\nGenerating tailored resume...")
    optimized_resume = optimize_resume_with_claude(resume_text, job_description, client)

    # Generate cover letter
    print("Generating cover letter...")
    cover_letter = generate_cover_letter_with_claude(
        resume_text, job_description, company_name, job_title, config, client
    )

    # Save job description for reference
    jd_path = output_dir / "job_description.txt"
    with open(jd_path, 'w', encoding='utf-8') as f:
        f.write(f"Company: {company_name}\n")
        f.write(f"Position: {job_title}\n")
        f.write(f"Date: {datetime.now().strftime('%Y-%m-%d')}\n")
        f.write("=" * 50 + "\n\n")
        f.write(job_description)
    print(f"Saved: {jd_path}")

    # Save as DOCX
    resume_filename = f"{config['user_name'].replace(' ', '_')}_Resume_{sanitize_folder_name(company_name)}.docx"
    cover_letter_filename = f"{config['user_name'].replace(' ', '_')}_Cover_Letter_{sanitize_folder_name(company_name)}.docx"

    save_as_docx(optimized_resume, output_dir / resume_filename, "resume")
    save_as_docx(cover_letter, output_dir / cover_letter_filename, "cover_letter")

    # Also save as markdown for easy viewing
    with open(output_dir / "resume.md", 'w', encoding='utf-8') as f:
        f.write(optimized_resume)

    with open(output_dir / "cover_letter.md", 'w', encoding='utf-8') as f:
        f.write(cover_letter)

    print("\n" + "=" * 60)
    print("                    COMPLETE!")
    print("=" * 60)
    print(f"\nAll files saved to: {output_dir}")
    print("\nGenerated files:")
    print(f"  - {resume_filename}")
    print(f"  - {cover_letter_filename}")
    print(f"  - job_description.txt")
    print(f"  - resume.md")
    print(f"  - cover_letter.md")
    print("\nGood luck with your application!")


if __name__ == "__main__":
    main()
