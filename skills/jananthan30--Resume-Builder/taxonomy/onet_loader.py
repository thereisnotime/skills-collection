"""
O*NET Taxonomy Loader — Provides skill validation against O*NET-derived skill database.

Usage:
    from taxonomy.onet_loader import is_recognized_skill, get_skill_category, get_related_skills

Functions:
    is_recognized_skill(term) -> bool
    get_skill_category(term) -> str or None
    get_related_skills(term) -> list[str]
    get_skills_for_domain(domain) -> set[str]
    get_all_skills() -> set[str]
"""

import json
from pathlib import Path

# Paths
_DATA_DIR = Path(__file__).parent.parent / "data"
_ONET_FILE = _DATA_DIR / "onet_skills.json"

# Module-level caches
_onet_data = None
_skill_lookup = None  # {normalized_term: {"category": ..., "importance": ...}}
_category_index = None  # {category: set(terms)}

# Domain -> O*NET categories mapping
_DOMAIN_CATEGORY_MAP = {
    "clinical_research": {
        "knowledge_areas", "certifications", "industry_terms",
        "work_activities", "technical_skills", "basic_skills",
        "social_skills", "resource_management", "technology_tools",
    },
    "pharma_biotech": {
        "knowledge_areas", "certifications", "industry_terms",
        "work_activities", "technical_skills", "basic_skills",
        "social_skills", "resource_management", "technology_tools",
    },
    "technology": {
        "technology_tools", "technical_skills", "industry_terms",
        "certifications", "systems_skills", "basic_skills",
        "complex_problem_solving", "resource_management",
    },
    "finance": {
        "technical_skills", "industry_terms", "certifications",
        "knowledge_areas", "technology_tools", "resource_management",
        "basic_skills", "systems_skills",
    },
    "consulting": {
        "basic_skills", "social_skills", "complex_problem_solving",
        "systems_skills", "resource_management", "industry_terms",
        "technology_tools", "knowledge_areas",
    },
    "healthcare": {
        "knowledge_areas", "work_activities", "certifications",
        "industry_terms", "technical_skills", "social_skills",
        "basic_skills", "resource_management", "technology_tools",
    },
    "general": None,  # None = all categories
}


def _load_onet():
    """Load O*NET skills JSON and build lookup indices."""
    global _onet_data, _skill_lookup, _category_index

    if _skill_lookup is not None:
        return

    _skill_lookup = {}
    _category_index = {}

    try:
        with open(_ONET_FILE, "r", encoding="utf-8") as f:
            _onet_data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        _onet_data = {}
        return

    for category_key, entries in _onet_data.items():
        if category_key == "_metadata":
            continue
        if not isinstance(entries, dict):
            continue

        cat_terms = set()
        for term, info in entries.items():
            normalized = term.lower().strip()
            if isinstance(info, dict):
                _skill_lookup[normalized] = {
                    "category": info.get("category", category_key),
                    "importance": info.get("importance", 1),
                }
            else:
                _skill_lookup[normalized] = {
                    "category": category_key,
                    "importance": 1,
                }
            cat_terms.add(normalized)

        _category_index[category_key] = cat_terms


def is_recognized_skill(term):
    """Check if a term is a recognized skill in the O*NET taxonomy.

    Args:
        term: Skill term to check (case-insensitive).

    Returns:
        True if the term is in the O*NET skill database.
    """
    _load_onet()
    return term.lower().strip() in _skill_lookup


def get_skill_category(term):
    """Get the O*NET category for a skill term.

    Returns:
        Category string (e.g. 'technology_tools') or None if not found.
    """
    _load_onet()
    entry = _skill_lookup.get(term.lower().strip())
    return entry["category"] if entry else None


def get_skill_importance(term):
    """Get the importance rating (1-3) for a skill term.

    Returns:
        Integer importance (1-3) or 0 if not found.
    """
    _load_onet()
    entry = _skill_lookup.get(term.lower().strip())
    return entry["importance"] if entry else 0


def get_related_skills(term):
    """Get skills in the same O*NET category as the given term.

    Returns:
        List of related skill names, or empty list if not found.
    """
    _load_onet()
    entry = _skill_lookup.get(term.lower().strip())
    if not entry:
        return []
    category = entry["category"]
    peers = _category_index.get(category, set())
    return [s for s in peers if s != term.lower().strip()]


def get_skills_for_domain(domain):
    """Get all O*NET skills relevant to a specific domain.

    Args:
        domain: One of 'clinical_research', 'pharma_biotech', 'technology',
                'finance', 'consulting', 'healthcare', 'general'.

    Returns:
        Set of skill term strings.
    """
    _load_onet()
    categories = _DOMAIN_CATEGORY_MAP.get(domain)
    if categories is None:
        # 'general' or unknown domain -> return all skills
        return set(_skill_lookup.keys())

    result = set()
    for cat in categories:
        result.update(_category_index.get(cat, set()))
    return result


def get_all_skills():
    """Return the full set of recognized skill terms.

    Returns:
        Set of all normalized skill strings in the taxonomy.
    """
    _load_onet()
    return set(_skill_lookup.keys())


def merge_with_domain_keywords(domain, domain_keywords):
    """Merge O*NET skills with domain-specific keyword dict.

    Returns the union of O*NET skills for the domain and the keys from
    the domain keyword dict, producing a comprehensive validation set.

    Args:
        domain: Domain string.
        domain_keywords: Dict of {term: weight} from keywords_{domain}.json.

    Returns:
        Set of all valid skill terms (lowercased).
    """
    onet_skills = get_skills_for_domain(domain)
    dk_terms = {str(k).lower() for k in domain_keywords.keys()}
    return onet_skills | dk_terms
