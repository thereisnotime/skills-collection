---
description: "Analyze Terraform provider or module upgrades for breaking changes and risks"
---

Analyze the impact of upgrading Terraform providers or modules.

## Usage

```
/upgrade-check                    # Check all providers for updates
/upgrade-check aws 5.0            # Check specific provider upgrade
/upgrade-check module vpc 3.0     # Check module upgrade
```

## Process

1. **Identify Current Versions**
   ```bash
   terraform version
   terraform providers
   ```

2. **Check for Available Updates**
   - Query provider registries
   - Check module sources for newer versions

3. **Analyze Breaking Changes**
   For each upgrade candidate:

   ### Provider Upgrades
   - Read CHANGELOG/UPGRADE guide
   - Identify deprecated resources/attributes
   - Find required code changes
   - Check for state migration needs

   ### Module Upgrades
   - Compare input/output variable changes
   - Identify removed features
   - Check dependency version requirements

4. **Query Memory**
   Check `memory/global/provider-issues.json` for:
   - Known issues with this version
   - Past upgrade experiences
   - Workarounds needed

5. **Risk Assessment**
   Categorize upgrade risk:
   - **LOW**: Patch version, no breaking changes
   - **MEDIUM**: Minor version, some deprecations
   - **HIGH**: Major version, breaking changes
   - **CRITICAL**: Known issues or complex migration

6. **Present Report**
   ```markdown
   ## Upgrade Analysis: [Provider/Module] [Version]

   ### Risk Level: [LEVEL]

   ### Breaking Changes
   - [Change 1 with required action]
   - [Change 2 with required action]

   ### Deprecations
   - [Deprecation with timeline]

   ### Required Code Changes
   - [File: change needed]

   ### State Migration
   - [Required: Yes/No]
   - [Steps if required]

   ### Recommendation
   [Proceed / Wait / Skip with reasoning]
   ```

7. **Update Memory**
   Store findings for future reference
