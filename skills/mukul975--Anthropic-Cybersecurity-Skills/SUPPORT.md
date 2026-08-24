# Support

This project is maintained by one person alongside other work. That shapes what support looks like here, so it is worth being direct about it rather than leaving you to guess.

## Where to go

| I want to… | Use |
|---|---|
| Ask how something works | [Discussions](https://github.com/mukul975/Anthropic-Cybersecurity-Skills/discussions) |
| Report a skill that is wrong, broken, or out of date | [Issues](https://github.com/mukul975/Anthropic-Cybersecurity-Skills/issues) |
| Propose a new skill | Issue first, then a PR — see [CONTRIBUTING.md](CONTRIBUTING.md) |
| Fix something yourself | Open a PR. This is the fastest path to change. |
| Report a security problem | See [SECURITY.md](SECURITY.md) |

Issues are for concrete defects: a command that does not work, a flag that does not exist, a framework ID that is wrong, a script that fails. Questions belong in Discussions, where other people can answer too and the answer stays findable.

## What to expect

There is no SLA. Response time varies with what else is happening; some pull requests have waited months, and that is a real cost I am working to reduce rather than a policy.

What moves fastest, in order:

1. A PR that fixes one thing and passes the validators.
2. An issue that names the skill, quotes the failing command, and shows the actual output.
3. Everything else.

What tends to stall: large multi-skill PRs, feature requests outside the skill-library format, and requests for bespoke integration help.

## Before you open an issue

```bash
pip install pyyaml
python tools/validate-skill.py skills/<skill-name>
```

If a skill fails validation, that output is the most useful thing you can paste. If you are reporting a procedure that does not work, say which version of the tool you ran and what it printed — "this does not work" is not actionable, and a wrong procedure in a security library is worth fixing properly.

## What this project is not

It is a reference library, not a product. It ships no service, holds no data, and makes no availability guarantee. Skills describe procedures for systems you own or are authorised to assess — see [SCOPE.md](SCOPE.md).

If you need something with a support contract behind it, this is not that, and I would rather say so plainly than have you discover it during an incident.

## Helping

The most useful contributions are unglamorous: correcting a procedure you actually ran, adding a framework mapping you verified, or telling me two skills are competing for the same request. All three make the library measurably better for everyone using it.
