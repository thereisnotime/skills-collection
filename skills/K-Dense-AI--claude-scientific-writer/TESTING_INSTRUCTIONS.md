# Testing the Claude Code Plugin

## ✅ Prerequisites

Create a test marketplace and a test project (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#plugin-development) for the marketplace configuration):

```
<path-to-test-marketplace>/          # e.g. a sibling directory of this repo
<path-to-test-project>/              # any empty directory to test in
```

## 🧪 Step-by-Step Testing

### Step 1: Add the Test Marketplace

In Claude Code (this chat), run:

```
/plugin marketplace add <path-to-test-marketplace>
```

Expected output: Confirmation that the marketplace was added.

### Step 2: List Available Plugins

```
/plugin marketplace list
```

Expected output: Should show `claude-scientific-writer` in the test-marketplace.

### Step 3: Install the Plugin

```
/plugin install claude-scientific-writer@test-marketplace
```

Expected output: Plugin installation confirmation, possibly a prompt to restart.

### Step 4: Restart Claude Code (if prompted)

If Claude Code asks you to restart, do so now.

### Step 5: Open the Test Project

Open the test project directory in Claude Code:
```
<path-to-test-project>/
```

Or use Cursor's "Open Folder" and navigate to this directory.

### Step 6: Run the Init Command

In the test project, run:

```
/claude-scientific-writer:scientific-writer-init
```

Expected behavior:
- Should check for existing CLAUDE.md (there isn't one)
- Should create a new CLAUDE.md file
- Should display a comprehensive onboarding message
- The CLAUDE.md file should appear in the test project directory

### Step 7: Verify Skills Are Available

Ask Claude:

```
What skills are available?
```

Expected output: Should list the scientific writing skills, including:
- research-lookup
- peer-review
- citation-management
- clinical-reports
- research-grants
- scientific-slides
- And 19 more...

### Step 8: Test Basic Functionality

Try a simple task:

```
Create a short scientific abstract (150 words) on quantum computing applications.
```

Expected behavior:
- Claude should use the scientific-writing skill
- Should create a properly formatted abstract
- May use research-lookup if configured

### Step 9: Verify CLAUDE.md Content

Open the created CLAUDE.md file and verify:
- [ ] File exists at `<path-to-test-project>/CLAUDE.md`
- [ ] Contains "Claude Agent System Instructions" header
- [ ] Has the plugin comment at the top
- [ ] Contains comprehensive scientific writing instructions
- [ ] Includes workflow protocols, citation policies, etc.

## 🔍 Troubleshooting

### Plugin Not Found
If the plugin isn't found:
1. Check the marketplace path you added is correct
2. Verify marketplace.json exists and is valid JSON
3. Try removing and re-adding: `/plugin marketplace remove test-marketplace`

### Skills Not Showing
If skills aren't available:
1. Check that `skills/` directory exists in the plugin
2. Verify each SKILL.md has valid YAML frontmatter
3. Try reinstalling the plugin

### Init Command Not Working
If `/claude-scientific-writer:scientific-writer-init` doesn't work:
1. Check that `commands/scientific-writer-init.md` exists
2. Verify the YAML frontmatter in the command file
3. Check that `templates/CLAUDE.scientific-writer.md` exists

### Template Not Found
If init command can't find the template:
1. Verify `<path-to-repo>/templates/CLAUDE.scientific-writer.md` exists
2. Check file permissions
3. Try using absolute path in the plugin

## 📊 Verification Checklist

After completing all steps:

- [ ] Test marketplace added successfully
- [ ] Plugin visible in marketplace list
- [ ] Plugin installed without errors
- [ ] `/claude-scientific-writer:scientific-writer-init` command executed successfully
- [ ] CLAUDE.md created in test project
- [ ] Skills query returns scientific writing skills
- [ ] Can create a simple scientific document
- [ ] Plugin works as expected

## 🎯 Success Criteria

The plugin is working correctly if:

1. **Installation succeeds** - No errors during marketplace add or plugin install
2. **Command works** - `/claude-scientific-writer:scientific-writer-init` creates CLAUDE.md
3. **Skills available** - "What skills are available?" shows 25 skills
4. **Functional** - Can create scientific content using the skills
5. **Template correct** - CLAUDE.md contains full scientific writing instructions

## 📝 Notes

- The `.claude/` directory in the plugin repo is a generated mirror of `skills/` (see [CONTRIBUTING.md](CONTRIBUTING.md)); never edit it directly
- The plugin uses `skills/`, `commands/`, and `templates/` directories
- Users can customize their CLAUDE.md after initialization
- Skills are available project-wide once plugin is installed

## 🚀 Next Steps After Successful Test

If everything works:
1. Update version in `.claude-plugin/marketplace.json` if needed
2. Commit and push changes to GitHub
3. Consider publishing to a public marketplace
4. Update documentation with real-world usage examples

---

**Ready to test?** Start with Step 1 above! 🧪

