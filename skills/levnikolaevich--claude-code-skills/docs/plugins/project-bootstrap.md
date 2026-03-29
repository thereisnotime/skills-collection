# Project Bootstrap

> CREATE new or TRANSFORM existing projects to production-ready Clean Architecture

## Install

```bash
# Add the marketplace once
/plugin marketplace add levnikolaevich/claude-code-skills

# Install this plugin
/plugin install project-bootstrap@levnikolaevich-skills-marketplace
```

## What it does

Scaffolds new projects or transforms existing ones into production-ready structure with Clean Architecture, Docker, CI/CD, linters, security scanning, and verification. Works without Linear or any external services.

## Skills

| Skill | Description |
|-------|-------------|
| ln-700-project-bootstrap | Top coordinator: CREATE or TRANSFORM mode |
| ln-720-structure-migrator | Migrate project to Clean Architecture |
| ln-721-frontend-restructure | Restructure frontend to feature-based layout |
| ln-722-backend-generator | Generate backend layers and DI setup |
| ln-723-seed-data-generator | Generate seed data for development |
| ln-724-artifact-cleaner | Remove build artifacts and temp files |
| ln-730-devops-setup | DevOps coordinator |
| ln-731-docker-generator | Generate Dockerfile and docker-compose |
| ln-732-cicd-generator | Generate CI/CD pipeline config |
| ln-733-env-configurator | Set up environment configuration |
| ln-740-quality-setup | Quality tooling coordinator |
| ln-741-linter-configurator | Configure ESLint, Prettier, or equivalent |
| ln-742-precommit-setup | Set up pre-commit hooks |
| ln-743-test-infrastructure | Set up test frameworks and config |
| ln-760-security-setup | Security coordinator |
| ln-761-secret-scanner | Configure secret scanning tools |
| ln-770-crosscutting-setup | Cross-cutting concerns coordinator |
| ln-771-logging-configurator | Set up structured logging |
| ln-772-error-handler-setup | Configure global error handling |
| ln-773-cors-configurator | Set up CORS policies |
| ln-774-healthcheck-setup | Add health check endpoints |
| ln-775-api-docs-generator | Generate API documentation (Swagger/OpenAPI) |
| ln-780-bootstrap-verifier | Verification coordinator |
| ln-781-build-verifier | Verify project builds successfully |
| ln-782-test-runner | Run test suite and verify |
| ln-783-container-launcher | Build and launch Docker containers |

## How it works

```
ln-700 -> ln-720 (structure)
    -> ln-730 (devops)
    -> ln-740 (quality)
    -> ln-760 (security)
    -> ln-770 (crosscutting)
    -> ln-780 (verify)
```

ln-700 runs in CREATE or TRANSFORM mode. Structure migration (ln-720) sets up Clean Architecture layers. DevOps (ln-730) adds Docker and CI/CD. Quality (ln-740) configures linters and test infrastructure. Security (ln-760) sets up secret scanning. Crosscutting (ln-770) adds logging, error handling, CORS, health checks, and API docs. Finally, ln-780 verifies everything builds, tests pass, and containers launch.

## Quick start

```bash
ln-700-project-bootstrap  # CREATE or TRANSFORM project
```

## Related

- [All plugins](../../README.md)
- [Architecture guide](../architecture/SKILL_ARCHITECTURE_GUIDE.md)
