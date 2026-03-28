# /mcp:setup-arxiv-mcp - Academic Paper Search

Set up the Paper Search MCP server via Docker MCP for searching and downloading academic papers from multiple sources including arXiv, PubMed, Semantic Scholar, and more.

- Purpose - Enable academic paper search and retrieval for research workflows
- Output - Working Paper Search MCP integration with CLAUDE.md configuration

```bash
/mcp:setup-arxiv-mcp [research topics or configuration]
```

## What is Paper Search MCP?

Paper Search MCP is a Docker-based MCP server that provides comprehensive access to academic literature. It aggregates search across multiple academic sources and enables downloading and reading papers directly.

Benefits:
- Search papers across arXiv, PubMed, bioRxiv, medRxiv, Semantic Scholar, and more
- Download PDFs and extract text content for analysis
- Filter by year, author, and other metadata
- Access cryptography papers via IACR
- Cross-reference with DOI via CrossRef

## Arguments

Optional research topics or specific paper sources to configure. The command will guide you through Docker MCP setup if not already available.

Examples:
- (no arguments) - Standard setup with all paper sources
- `machine learning, transformers` - Mention specific research areas
- `cryptography` - Focus on specific domain

## Prerequisites

- **Docker Desktop** - Required for Docker MCP integration
- **Docker MCP Toolkit** - For managing MCP servers via Docker

## How It Works

1. **Docker MCP Check**: Verifies Docker MCP is available
2. **Server Search**: Finds and adds `paper-search` MCP server from Docker catalog
3. **Activation**: Enables the server's tools in your session
4. **Connection Test**: Verifies search functionality works
5. **CLAUDE.md Update**: Adds paper search usage instructions

## Available Tools

**Search Tools**:
- `search_arxiv` - Search arXiv preprints (physics, math, CS, etc.)
- `search_pubmed` - Search PubMed biomedical literature
- `search_biorxiv` / `search_medrxiv` - Search biology/medicine preprints
- `search_semantic` - Search Semantic Scholar with year filters
- `search_google_scholar` - Broad academic search
- `search_iacr` - Search cryptography papers (IACR ePrint)
- `search_crossref` - Search by DOI/citation metadata

**Download and Read Tools**:
- `download_arxiv` / `read_arxiv_paper` - Download/read arXiv PDFs
- `download_biorxiv` / `read_biorxiv_paper` - Download/read bioRxiv PDFs
- `download_semantic` / `read_semantic_paper` - Download/read via Semantic Scholar

## Usage Examples

```bash
# Standard setup
> /mcp:setup-arxiv-mcp

# After setup, search for papers
> read transformer attention mechanism paper

# Search Semantic Scholar with year filter
> search large language models papers from 2023

# Download and read a paper
> read paper 2106.12345
```

After setup, your CLAUDE.md will include:
