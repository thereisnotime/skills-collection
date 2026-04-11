# TODO - claude-blog Roadmap

## Phase 2 (Next)
- [ ] AI Citation Probability Scoring (0-100 per post for ChatGPT/Perplexity/AI Overview citation likelihood)
- [ ] Writing Style Learning (`/blog style learn` - analyze 5-10 posts to extract author voice profile)
- [ ] Content Decay Detection (`/blog decay` - GSC integration to flag 20%+ QoQ decline)
- [ ] Pre-commit hooks for quality gates (block commits with score < 70)

## Phase 3 (Future)
- [ ] MCP integrations (Ahrefs, Semrush)
- [ ] Multi-language content support (i18n, hreflang generation)
- [ ] Automated A/B title testing via analytics integration
- [ ] Content performance dashboard (aggregate scores, traffic, citations)

## Completed
- [x] CI/CD workflows (`.github/workflows/ci.yml` added in v1.3.0)
- [x] Google Search Console and PageSpeed Insights (blog-google sub-skill, v1.6.5)
- [x] Plugin marketplace submission (marketplace.json, v1.6.2)
- [x] Image generation via AI (blog-image sub-skill with Gemini, v1.4.0)
- [x] Podcast/audio repurposing (blog-audio sub-skill with Gemini TTS, v1.6.0)
