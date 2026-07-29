"""Tests for the citation-management BibTeX tooling.

Two of this skill's scripts reach the network (Crossref, PubMed, Scholar) and
two are pure text processing. The pure half is where citation errors are
actually introduced -- a page range silently rewritten, a DOI left with its URL
prefix so lookups fail, two distinct papers merged because they share a key --
so that is what the suite drives, end to end through real `.bib` files.

The schematic scripts this skill also ships come from the shared contract;
five skills carry byte-identical copies.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import skill_contract

SKILL_ROOT = Path(__file__).resolve().parents[2] / "skills" / "citation-management"
SCRIPTS = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import format_bibtex  # noqa: E402
import validate_citations  # noqa: E402

SchematicTests = skill_contract.schematic.schematic_test_case(SKILL_ROOT)

BIBLIOGRAPHY = """\
@article{jumper2021,
  author = {Jumper, John and Evans, Richard},
  title = {Highly accurate protein structure prediction},
  journal = {Nature},
  year = {2021},
  volume = {596},
  pages = {583-589},
  doi = {https://doi.org/10.1038/s41586-021-03819-2}
}

@inproceedings{vaswani2017,
  author = {Vaswani, Ashish; Shazeer, Noam},
  title = {Attention Is All You Need},
  booktitle = {NeurIPS},
  year = {2017},
  pages = {pp. 5998--6008}
}
"""


class BibTeXTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)
        self.formatter = format_bibtex.BibTeXFormatter()

    def bib(self, text: str = BIBLIOGRAPHY) -> str:
        path = self.root / "refs.bib"
        path.write_text(text, encoding="utf-8")
        return str(path)


class ParsingTests(BibTeXTestCase):
    def test_entries_are_parsed_with_type_key_and_fields(self) -> None:
        entries = self.formatter.parse_bibtex_file(self.bib())
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["key"], "jumper2021")
        self.assertEqual(entries[0]["type"], "article")
        self.assertEqual(entries[0]["fields"]["journal"], "Nature")
        self.assertEqual(entries[1]["type"], "inproceedings")

    def test_an_empty_file_parses_to_no_entries(self) -> None:
        self.assertEqual(self.formatter.parse_bibtex_file(self.bib("")), [])

    def test_comments_outside_entries_are_ignored(self) -> None:
        entries = self.formatter.parse_bibtex_file(
            self.bib(
                "% a leading comment\n"
                "@article{a,\n  title = {T},\n  year = {2020}\n}\n"
                "% a trailing comment\n"
            )
        )
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["key"], "a")

    def test_an_entry_closed_on_the_same_line_is_not_recognised(self) -> None:
        # The entry pattern anchors on `\n}`, so the closing brace must start a
        # line. Single-line entries are legal BibTeX but are skipped silently --
        # pinned here so the limitation is visible rather than surprising.
        self.assertEqual(
            self.formatter.parse_bibtex_file(
                self.bib("@article{a, title = {T}, year = {2020}}\n")
            ),
            [],
        )

    def test_quoted_field_values_are_read_as_well_as_braced_ones(self) -> None:
        entries = self.formatter.parse_bibtex_file(
            self.bib('@article{a,\n  title = "Quoted Title",\n  year = {2020}\n}\n')
        )
        self.assertEqual(entries[0]["fields"]["title"], "Quoted Title")

    def test_an_unreadable_file_returns_no_entries_rather_than_raising(self) -> None:
        self.assertEqual(
            self.formatter.parse_bibtex_file(str(self.root / "absent.bib")), []
        )


class FixTests(BibTeXTestCase):
    def _fixed_fields(self, **fields) -> dict:
        entry = {"key": "k", "type": "article", "fields": fields}
        return self.formatter.fix_common_issues(entry)["fields"]

    def test_a_single_hyphen_page_range_becomes_an_en_dash_range(self) -> None:
        # BibTeX renders `583-589` as a hyphen, not an en dash.
        self.assertEqual(self._fixed_fields(pages="583-589")["pages"], "583--589")

    def test_an_already_correct_range_is_left_alone(self) -> None:
        self.assertEqual(self._fixed_fields(pages="583--589")["pages"], "583--589")

    def test_a_pp_prefix_is_stripped(self) -> None:
        for raw in ("pp. 5998--6008", "PP.5998--6008"):
            with self.subTest(raw=raw):
                self.assertEqual(self._fixed_fields(pages=raw)["pages"], "5998--6008")

    def test_a_doi_loses_its_url_prefix(self) -> None:
        # A DOI stored as a URL fails every downstream Crossref lookup.
        for raw in (
            "https://doi.org/10.1038/x",
            "http://doi.org/10.1038/x",
            "doi:10.1038/x",
        ):
            with self.subTest(raw=raw):
                self.assertEqual(self._fixed_fields(doi=raw)["doi"], "10.1038/x")

    def test_a_bare_doi_is_untouched(self) -> None:
        self.assertEqual(self._fixed_fields(doi="10.1038/x")["doi"], "10.1038/x")

    def test_author_separators_are_normalised_to_and(self) -> None:
        self.assertEqual(
            self._fixed_fields(author="Vaswani, A.; Shazeer, N.")["author"],
            "Vaswani, A. and Shazeer, N.",
        )
        self.assertEqual(
            self._fixed_fields(author="Smith, J. & Jones, K.")["author"],
            "Smith, J. and Jones, K.",
        )

    def test_a_doubled_and_is_collapsed(self) -> None:
        self.assertEqual(
            self._fixed_fields(author="A and and B")["author"], "A and B"
        )

    def test_fixing_does_not_mutate_the_original_entry(self) -> None:
        entry = {"key": "k", "type": "article", "fields": {"pages": "1-2"}}
        self.formatter.fix_common_issues(entry)
        self.assertEqual(entry["fields"]["pages"], "1-2")

    def test_absent_fields_are_not_invented(self) -> None:
        self.assertEqual(self._fixed_fields(title="T"), {"title": "T"})


class DeduplicationTests(BibTeXTestCase):
    def _entries(self, *specs) -> list:
        return [
            {"key": key, "type": "article", "fields": fields} for key, fields in specs
        ]

    def test_entries_sharing_a_doi_collapse_to_one(self) -> None:
        entries = self._entries(
            ("a2021", {"doi": "10.1/x"}), ("b2021", {"doi": "10.1/x"})
        )
        self.assertEqual(len(self.formatter.deduplicate_entries(entries)), 1)

    def test_entries_sharing_a_citation_key_collapse_to_one(self) -> None:
        entries = self._entries(("same", {"doi": "10.1/a"}), ("same", {"doi": "10.1/b"}))
        self.assertEqual(len(self.formatter.deduplicate_entries(entries)), 1)

    def test_distinct_entries_all_survive(self) -> None:
        entries = self._entries(
            ("a", {"doi": "10.1/a"}), ("b", {"doi": "10.1/b"}), ("c", {})
        )
        self.assertEqual(len(self.formatter.deduplicate_entries(entries)), 3)

    def test_the_first_occurrence_is_kept(self) -> None:
        entries = self._entries(
            ("first", {"doi": "10.1/x", "title": "T1"}),
            ("second", {"doi": "10.1/x", "title": "T2"}),
        )
        kept = self.formatter.deduplicate_entries(entries)
        self.assertEqual(kept[0]["key"], "first")

    def test_entries_without_a_doi_are_deduplicated_by_key_alone(self) -> None:
        entries = self._entries(("a", {}), ("a", {}), ("b", {}))
        self.assertEqual(len(self.formatter.deduplicate_entries(entries)), 2)


class SortTests(BibTeXTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.entries = [
            {"key": "zeta", "type": "article", "fields": {"year": "2019", "author": "Young, A.", "title": "Beta"}},
            {"key": "alpha", "type": "article", "fields": {"year": "2021", "author": "Adams, B.", "title": "Alpha"}},
        ]

    def test_the_default_sort_is_by_citation_key(self) -> None:
        self.assertEqual(
            [e["key"] for e in self.formatter.sort_entries(self.entries)],
            ["alpha", "zeta"],
        )

    def test_sorting_by_year_author_and_title(self) -> None:
        expected = {
            "year": ["zeta", "alpha"],
            "author": ["alpha", "zeta"],
            "title": ["alpha", "zeta"],
        }
        for field, order in expected.items():
            with self.subTest(sort_by=field):
                self.assertEqual(
                    [e["key"] for e in self.formatter.sort_entries(self.entries, field)],
                    order,
                )

    def test_descending_reverses_the_order(self) -> None:
        self.assertEqual(
            [e["key"] for e in self.formatter.sort_entries(self.entries, "key", True)],
            ["zeta", "alpha"],
        )

    def test_entries_missing_the_sort_field_go_last(self) -> None:
        entries = self.entries + [{"key": "omega", "type": "article", "fields": {}}]
        ordered = self.formatter.sort_entries(entries, "year")
        self.assertEqual(ordered[-1]["key"], "omega")

    def test_an_unknown_sort_field_falls_back_to_the_key(self) -> None:
        self.assertEqual(
            [e["key"] for e in self.formatter.sort_entries(self.entries, "nonsense")],
            ["alpha", "zeta"],
        )


class RenderTests(BibTeXTestCase):
    def test_a_formatted_entry_reparses_to_the_same_fields(self) -> None:
        original = self.formatter.parse_bibtex_file(self.bib())[0]
        rendered = self.formatter.format_entry(original)

        path = self.root / "round-trip.bib"
        path.write_text(rendered, encoding="utf-8")
        reparsed = self.formatter.parse_bibtex_file(str(path))[0]

        self.assertEqual(reparsed["key"], original["key"])
        self.assertEqual(reparsed["type"], original["type"])
        self.assertEqual(reparsed["fields"], original["fields"])

    def test_fields_are_emitted_in_the_documented_order(self) -> None:
        entry = {
            "key": "k",
            "type": "article",
            "fields": {"year": "2021", "title": "T", "author": "A"},
        }
        rendered = self.formatter.format_entry(entry)
        self.assertLess(rendered.index("author"), rendered.index("title"))
        self.assertLess(rendered.index("title"), rendered.index("year"))

    def test_braces_are_balanced(self) -> None:
        rendered = self.formatter.format_entry(
            self.formatter.parse_bibtex_file(self.bib())[0]
        )
        self.assertEqual(rendered.count("{"), rendered.count("}"))


class EndToEndTests(BibTeXTestCase):
    def test_formatting_a_file_applies_every_fix(self) -> None:
        output = self.root / "clean.bib"
        self.formatter.format_file(self.bib(), output=str(output))
        text = output.read_text(encoding="utf-8")

        self.assertIn("583--589", text)
        self.assertIn("10.1038/s41586-021-03819-2", text)
        self.assertNotIn("https://doi.org/", text)
        self.assertNotIn("pp. ", text)
        self.assertIn("Vaswani, Ashish and Shazeer, Noam", text)

    def test_the_result_still_parses(self) -> None:
        output = self.root / "clean.bib"
        self.formatter.format_file(self.bib(), output=str(output))
        self.assertEqual(len(self.formatter.parse_bibtex_file(str(output))), 2)


class ValidationTests(BibTeXTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.validator = validate_citations.CitationValidator()

    def test_a_complete_article_raises_no_errors(self) -> None:
        entry = {
            "key": "jumper2021",
            "type": "article",
            "fields": {
                "author": "Jumper, John",
                "title": "A title",
                "journal": "Nature",
                "year": "2021",
            },
        }
        errors, _ = self.validator.validate_entry(entry)
        self.assertEqual(errors, [])

    def test_a_missing_required_field_is_reported(self) -> None:
        entry = {
            "key": "incomplete",
            "type": "article",
            "fields": {"title": "A title", "year": "2021"},
        }
        errors, _ = self.validator.validate_entry(entry)
        self.assertTrue(errors)
        self.assertIn("author", " ".join(str(error) for error in errors).lower())

    def test_duplicate_detection_finds_repeated_entries(self) -> None:
        entries = self.formatter.parse_bibtex_file(self.bib(BIBLIOGRAPHY + BIBLIOGRAPHY))
        self.assertTrue(self.validator.detect_duplicates(entries))

    def test_distinct_entries_are_not_reported_as_duplicates(self) -> None:
        entries = self.formatter.parse_bibtex_file(self.bib())
        self.assertEqual(self.validator.detect_duplicates(entries), [])

    def test_manuscript_citation_keys_are_extracted(self) -> None:
        manuscript = self.root / "paper.tex"
        manuscript.write_text(
            "As shown \\cite{jumper2021} and \\citep{vaswani2017,smith2020}.\n",
            encoding="utf-8",
        )
        keys = self.validator.parse_manuscript_citations(str(manuscript))
        self.assertIn("jumper2021", keys)
        self.assertIn("vaswani2017", keys)
        self.assertIn("smith2020", keys)

    def test_a_manuscript_with_no_citations_yields_none(self) -> None:
        manuscript = self.root / "paper.tex"
        manuscript.write_text("No citations here.\n", encoding="utf-8")
        self.assertEqual(self.validator.parse_manuscript_citations(str(manuscript)), [])


if __name__ == "__main__":
    unittest.main()
