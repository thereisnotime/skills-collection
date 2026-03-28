"""Tests for the blog quality analyzer script."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import analyze_blog


# ---------------------------------------------------------------------------
# Frontmatter parsing
# ---------------------------------------------------------------------------


class TestExtractFrontmatter:
    def test_extracts_yaml_frontmatter(self, sample_blog_post):
        fm = analyze_blog.extract_frontmatter(sample_blog_post)
        assert fm["title"] == "How to Optimize Your Blog for AI Citations"
        assert fm["author"] == "Jane Doe"

    def test_returns_empty_dict_without_frontmatter(self, sample_post_no_frontmatter):
        fm = analyze_blog.extract_frontmatter(sample_post_no_frontmatter)
        assert fm == {}

    def test_strips_quotes_from_values(self):
        content = '---\ntitle: "Quoted Title"\nauthor: \'Single Quoted\'\n---\n'
        fm = analyze_blog.extract_frontmatter(content)
        assert fm["title"] == "Quoted Title"
        assert fm["author"] == "Single Quoted"


class TestStripFrontmatter:
    def test_removes_frontmatter(self, sample_blog_post):
        stripped = analyze_blog.strip_frontmatter(sample_blog_post)
        assert "---" not in stripped.split("\n")[0]
        assert "# How to Optimize" in stripped

    def test_no_frontmatter_returns_unchanged(self, sample_post_no_frontmatter):
        stripped = analyze_blog.strip_frontmatter(sample_post_no_frontmatter)
        assert stripped == sample_post_no_frontmatter


# ---------------------------------------------------------------------------
# Heading analysis
# ---------------------------------------------------------------------------


class TestAnalyzeHeadings:
    def test_counts_heading_levels(self, sample_blog_post):
        result = analyze_blog.analyze_headings(sample_blog_post)
        assert result["h1_count"] == 1
        assert result["h2_count"] >= 3
        assert result["h3_count"] >= 1

    def test_detects_question_headings(self, sample_blog_post):
        result = analyze_blog.analyze_headings(sample_blog_post)
        assert result["h2_question_count"] >= 2
        assert result["h2_question_ratio"] > 0

    def test_clean_hierarchy(self):
        content = "# Title\n\n## Section\n\n### Sub\n\n## Another\n"
        result = analyze_blog.analyze_headings(content)
        assert result["hierarchy_clean"] is True

    def test_dirty_hierarchy(self):
        content = "# Title\n\n### Skipped H2\n\n## Section\n"
        result = analyze_blog.analyze_headings(content)
        assert result["hierarchy_clean"] is False

    def test_empty_content(self):
        result = analyze_blog.analyze_headings("")
        assert result["total"] == 0


# ---------------------------------------------------------------------------
# Paragraph analysis
# ---------------------------------------------------------------------------


class TestAnalyzeParagraphs:
    def test_counts_paragraphs(self, sample_blog_post):
        result = analyze_blog.analyze_paragraphs(sample_blog_post)
        assert result["total_paragraphs"] > 0

    def test_calculates_avg_word_count(self, sample_blog_post):
        result = analyze_blog.analyze_paragraphs(sample_blog_post)
        assert result["avg_word_count"] > 0

    def test_ignores_short_paragraphs(self):
        content = "One.\n\nTwo.\n\nThree words here.\n\n" + (
            "This is a paragraph with enough words to be counted by the analyzer. " * 3
        )
        result = analyze_blog.analyze_paragraphs(content)
        assert result["total_paragraphs"] == 1

    def test_detects_over_150(self):
        long_para = " ".join(["word"] * 160)
        content = f"\n\n{long_para}\n\n"
        result = analyze_blog.analyze_paragraphs(content)
        assert result["over_150_words"] >= 1

    def test_empty_content(self):
        result = analyze_blog.analyze_paragraphs("")
        assert result["total_paragraphs"] == 0
        assert result["avg_word_count"] == 0


# ---------------------------------------------------------------------------
# Image analysis
# ---------------------------------------------------------------------------


class TestAnalyzeImages:
    def test_detects_markdown_images(self):
        content = "![Alt text](image.jpg)\n![Another](photo.png)\n"
        result = analyze_blog.analyze_images(content)
        assert result["count"] == 2

    def test_detects_missing_alt_text(self):
        content = "![](image.jpg)\n![Good alt](photo.png)\n"
        result = analyze_blog.analyze_images(content)
        assert result["without_alt_text"] >= 1

    def test_no_images(self):
        result = analyze_blog.analyze_images("No images here.")
        assert result["count"] == 0


# ---------------------------------------------------------------------------
# AI content detection
# ---------------------------------------------------------------------------


class TestAISignals:
    def test_detects_ai_phrases(self):
        content = "In today's digital landscape, it's important to note that we must dive into this topic."
        sentences_info = analyze_blog.analyze_sentences(content)
        result = analyze_blog.analyze_ai_signals(content, sentences_info)
        assert result["ai_phrase_count"] > 0

    def test_clean_content_low_signals(self):
        content = "Blog optimization requires structured content. Statistics from Ahrefs show 43% improvement."
        sentences_info = analyze_blog.analyze_sentences(content)
        result = analyze_blog.analyze_ai_signals(content, sentences_info)
        assert result["ai_phrase_count"] == 0


class TestAITriggerWords:
    def test_detects_trigger_words(self):
        text = "We must delve into this multifaceted topic to illuminate the nuanced landscape."
        result = analyze_blog.analyze_ai_trigger_words(text)
        assert result["trigger_count"] > 0
        assert len(result["found"]) > 0

    def test_clean_text(self):
        text = "This article explains how to write better blog posts using data."
        result = analyze_blog.analyze_ai_trigger_words(text)
        assert result["trigger_count"] == 0


# ---------------------------------------------------------------------------
# Citation analysis
# ---------------------------------------------------------------------------


class TestAnalyzeCitations:
    def test_detects_inline_citations(self):
        content = "According to a study (Source, 2025), AI citations increased by 340%."
        result = analyze_blog.analyze_citations(content)
        assert result["total_statistics"] >= 1

    def test_no_statistics(self):
        content = "No numbers or statistics in this text at all."
        result = analyze_blog.analyze_citations(content)
        assert result["total_statistics"] == 0


# ---------------------------------------------------------------------------
# FAQ analysis
# ---------------------------------------------------------------------------


class TestAnalyzeFAQ:
    def test_detects_faq_section(self, sample_blog_post):
        result = analyze_blog.analyze_faq(sample_blog_post)
        assert result["has_faq_section"] is True
        assert result["faq_item_count"] >= 2

    def test_no_faq(self):
        content = "# Title\n\n## Section\n\nJust regular content."
        result = analyze_blog.analyze_faq(content)
        assert result["has_faq_section"] is False


# ---------------------------------------------------------------------------
# Freshness analysis
# ---------------------------------------------------------------------------


class TestAnalyzeFreshness:
    def test_detects_dates(self):
        fm = {"date": "2026-01-15", "lastUpdated": "2026-02-10"}
        result = analyze_blog.analyze_freshness(fm)
        assert result["has_date"] is True
        assert result["has_last_updated"] is True

    def test_no_dates(self):
        result = analyze_blog.analyze_freshness({})
        assert result["has_date"] is False
        assert result["has_last_updated"] is False


# ---------------------------------------------------------------------------
# Readability analysis
# ---------------------------------------------------------------------------


class TestAnalyzeReadability:
    def test_flesch_score(self, sample_blog_post):
        stripped = analyze_blog.strip_frontmatter(sample_blog_post)
        result = analyze_blog.analyze_readability(stripped)
        assert "flesch_reading_ease" in result

    def test_reading_time(self, sample_blog_post):
        stripped = analyze_blog.strip_frontmatter(sample_blog_post)
        result = analyze_blog.analyze_readability(stripped)
        assert result["reading_time_minutes"] > 0


# ---------------------------------------------------------------------------
# Sentence analysis
# ---------------------------------------------------------------------------


class TestAnalyzeSentences:
    def test_detects_over_25_word_sentences(self):
        long = "This is a very " + "very " * 20 + "long sentence that goes on and on."
        short = "Short one."
        text = f"{long} {short}"
        result = analyze_blog.analyze_sentences(text)
        assert result["over_25_count"] >= 1

    def test_burstiness(self):
        text = "Short. Also short. This one is a bit longer than the others. Tiny."
        result = analyze_blog.analyze_sentences(text)
        assert "burstiness" in result


# ---------------------------------------------------------------------------
# Link analysis
# ---------------------------------------------------------------------------


class TestAnalyzeLinks:
    def test_counts_internal_and_external(self):
        content = "[internal](/about) and [external](https://example.com/page)"
        result = analyze_blog.analyze_links(content)
        assert result["internal_count"] >= 1
        assert result["external_count"] >= 1

    def test_no_links(self):
        result = analyze_blog.analyze_links("No links here.")
        assert result["internal_count"] == 0
        assert result["external_count"] == 0


# ---------------------------------------------------------------------------
# Schema analysis
# ---------------------------------------------------------------------------


class TestAnalyzeSchema:
    def test_detects_json_ld(self, sample_post_with_schema):
        result = analyze_blog.analyze_schema(sample_post_with_schema)
        assert result["schema_count"] >= 1
        assert result["has_blogposting"] is True

    def test_no_schema(self):
        result = analyze_blog.analyze_schema("# Simple post\n\nNo schema here.")
        assert result["schema_count"] == 0


# ---------------------------------------------------------------------------
# Self-promotion analysis
# ---------------------------------------------------------------------------


class TestAnalyzeSelfPromotion:
    def test_no_promotions(self):
        result = analyze_blog.analyze_self_promotion("Generic content without brands.")
        assert result["exceeds_limit"] is False
        assert result["self_promotion_patterns"] == 0

    def test_returns_expected_keys(self):
        result = analyze_blog.analyze_self_promotion("Some content.", brand_name="Acme")
        assert "self_promotion_patterns" in result
        assert "exceeds_limit" in result


# ---------------------------------------------------------------------------
# Passive voice analysis
# ---------------------------------------------------------------------------


class TestAnalyzePassiveVoice:
    def test_detects_passive(self):
        text = "The report was written by the team. The data was analyzed carefully."
        result = analyze_blog.analyze_passive_voice(text)
        assert result["passive_count"] >= 1

    def test_active_voice(self):
        text = "The team wrote the report. Analysts reviewed the data."
        result = analyze_blog.analyze_passive_voice(text)
        assert result["passive_count"] == 0


# ---------------------------------------------------------------------------
# Transition words
# ---------------------------------------------------------------------------


class TestAnalyzeTransitionWords:
    def test_detects_transitions(self):
        text = "First, set up your blog. However, you should also consider SEO. Therefore, optimize early."
        result = analyze_blog.analyze_transition_words(text)
        assert result["transition_count"] >= 2

    def test_no_transitions(self):
        text = "Set up blog. Consider SEO. Optimize."
        result = analyze_blog.analyze_transition_words(text)
        assert result["transition_count"] == 0


# ---------------------------------------------------------------------------
# File analysis (integration)
# ---------------------------------------------------------------------------


class TestAnalyzeFile:
    def test_analyzes_real_file(self, tmp_path, sample_blog_post):
        post_file = tmp_path / "test-post.md"
        post_file.write_text(sample_blog_post)
        result = analyze_blog.analyze_file(str(post_file))
        assert "score" in result
        assert "headings" in result
        assert result["score"]["total"] >= 0

    def test_nonexistent_file(self):
        result = analyze_blog.analyze_file("/nonexistent/file.md")
        assert "error" in result
