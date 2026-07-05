"""Tests for scientific_writer.utils."""


from scientific_writer.utils import (
    count_citations_in_bib,
    detect_paper_reference,
    extract_citation_style,
)


class TestExtractCitationStyle:
    def test_reads_bibliographystyle_from_tex(self, tmp_path):
        tex = tmp_path / "main.tex"
        tex.write_text("\\documentclass{article}\n\\bibliographystyle{ieeetr}\n")
        assert extract_citation_style(None, tex_file=str(tex)) == "ieeetr"

    def test_reads_biblatex_style_option(self, tmp_path):
        tex = tmp_path / "main.tex"
        tex.write_text("\\usepackage[backend=biber,style=apa]{biblatex}\n")
        assert extract_citation_style(None, tex_file=str(tex)) == "apa"

    def test_defaults_to_bibtex_without_tex(self):
        assert extract_citation_style(None) == "BibTeX"

    def test_defaults_to_bibtex_when_tex_has_no_style(self, tmp_path):
        tex = tmp_path / "main.tex"
        tex.write_text("\\documentclass{article}\n")
        assert extract_citation_style(None, tex_file=str(tex)) == "BibTeX"


class TestDetectPaperReference:
    """Characterization tests for the existing detection heuristic."""

    def _papers(self, tmp_path):
        names = ["20250101_120000_quantum_computing", "20250102_120000_gene_editing"]
        papers = []
        for name in names:
            path = tmp_path / name
            path.mkdir()
            papers.append({"path": path, "name": name, "mtime": path.stat().st_mtime})
        return list(reversed(papers))  # most recent first, as find_existing_papers returns

    def test_topic_match_with_search_keyword(self, tmp_path):
        papers = self._papers(tmp_path)
        result = detect_paper_reference("find the quantum computing paper", papers)
        assert result is not None
        assert "quantum_computing" in result.name

    def test_new_paper_request_returns_none(self, tmp_path):
        papers = self._papers(tmp_path)
        assert detect_paper_reference("write a new paper on biology", papers) is None


def test_count_citations_in_bib(tmp_path):
    bib = tmp_path / "references.bib"
    bib.write_text("@article{a, title={A}}\n@book{b, title={B}}\n")
    assert count_citations_in_bib(str(bib)) == 2
    assert count_citations_in_bib(None) == 0
