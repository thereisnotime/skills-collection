# Nano Skill Plugin

A Claude Code plugin that generates images using Google's Gemini API (Nano Banana models).

## Features

- **Text-to-image generation** - Describe what you want, get an image
- **Multiple models** - Fast (`flash`) or high-quality (`pro`)
- **Aspect ratios** - 1:1, 16:9, 9:16, 4:3, 3:4
- **Resolution options** - Up to 4K with pro model
- **Context-aware output** - Places images where they belong in your project

## Setup

1. Get a Gemini API key at https://aistudio.google.com/api-keys

2. Set the environment variable:
   ```bash
   export GEMINI_API_KEY="your-key-here"
   ```

## Installation

### From Local Path

```
/plugin marketplace add /path/to/nano-skills/.claude-plugin/
/plugin install nano-skill
```

### From GitHub

```
/plugin marketplace add livelabs-ventures/nano-skills
/plugin install nano-skill
```

## Plugin Structure

```
nano-skill/
├── .claude-plugin/
│   └── plugin.json           # Plugin manifest
├── skills/
│   └── gemini-image-generator/
│       ├── SKILL.md          # Skill definition
│       └── scripts/
│           └── generate_image.py
└── README.md
```

## Usage

Once installed, the skill activates when you ask Claude to:
- "Generate an image of..."
- "Create an icon for..."
- "Make a banner..."
- "Design a logo..."

Claude will use the bundled script to generate images and save them to appropriate locations in your project.

## Direct Script Usage

```bash
# Basic usage
python scripts/generate_image.py "A cute robot" --output ./robot.png

# With aspect ratio
python scripts/generate_image.py "Website banner" --aspect 16:9 --output ./banner.png

# High quality
python scripts/generate_image.py "Detailed art" --model pro --size 4K --output ./art.png
```

## Options

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--model, -m` | `flash`, `pro` | `flash` | Model selection |
| `--aspect, -a` | `1:1`, `16:9`, `9:16`, `4:3`, `3:4` | `1:1` | Aspect ratio |
| `--size, -s` | `1K`, `2K`, `4K` | - | Resolution (pro only) |

## License

MIT
