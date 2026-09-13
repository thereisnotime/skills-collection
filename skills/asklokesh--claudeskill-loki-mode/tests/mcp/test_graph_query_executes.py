"""loki_graph_query must actually run when a graph EXISTS.

The pre-existing suite only exercised the no-graph branch, which returns
before the subprocess call. That left the entire success path unguarded, and
it shipped broken: `subprocess` was imported only inside another function, so
every call with a real graph returned {"ok": false, "error": "name
'subprocess' is not defined"}.

This asserts the executing path, single-repo and cross-repo merged.
"""
import asyncio, json, os, shutil, subprocess, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))


def _call(**kw):
    from mcp.server import loki_graph_query
    fn = getattr(loki_graph_query, "fn", loki_graph_query)
    return json.loads(asyncio.run(fn(**kw)))


class TestGraphQueryExecutes(unittest.TestCase):
    def test_no_graph_branch_is_structured(self):
        with tempfile.TemporaryDirectory() as d:
            r = _call(question="x", budget=100, path=d)
            self.assertFalse(r["ok"])
            self.assertIn("hint", r)  # structured, not an exception

    @unittest.skipIf(shutil.which("graphify") is None, "graphify not on PATH")
    def test_executes_on_real_graph_single_and_cross_repo(self):
        with tempfile.TemporaryDirectory() as d:
            for name, fn_pfx in (("alpha", "alpha"), ("beta", "beta")):
                sub = os.path.join(d, name)
                os.makedirs(sub)
                with open(os.path.join(sub, "m.py"), "w") as f:
                    f.write("def %s_login(u):\n    return %s_h(u)\n"
                            "def %s_h(u):\n    return u\n"
                            % (fn_pfx, fn_pfx, fn_pfx))
                subprocess.run(["graphify", "extract", "./%s/" % name],
                               cwd=d, capture_output=True, timeout=300)

            single = _call(question="login", budget=400,
                           path=os.path.join(d, "alpha"))
            # The regression: this returned the subprocess NameError.
            self.assertTrue(single["ok"], single)
            self.assertNotIn("error", single)

            os.makedirs(os.path.join(d, "graphify-out"), exist_ok=True)
            subprocess.run(
                ["graphify", "merge-graphs",
                 "./alpha/graphify-out/graph.json",
                 "./beta/graphify-out/graph.json",
                 "--out", "graphify-out/graph.json"],
                cwd=d, capture_output=True, timeout=300)

            merged = _call(question="login", budget=800, path=d)
            self.assertTrue(merged["ok"], merged)
            answer = merged["answer"]
            # One query reaching BOTH origins is the cross-repo property.
            self.assertIn("alpha", answer)
            self.assertIn("beta", answer)


if __name__ == "__main__":
    unittest.main()
