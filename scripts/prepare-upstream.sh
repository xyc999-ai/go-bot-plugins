#!/usr/bin/env bash
# Assemble original upstream Skills into first-party plugin packages.
# Runs in the isolated plugin release build, never on the developer workstation.
set -euo pipefail
cd "$(dirname "$0")/../plugins"
export DISABLE_TELEMETRY=1
node agent-browser/scripts/install.mjs
node officecli/scripts/install.mjs
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
(
  cd "$work"
  npx --yes skills@1.8.1 add vercel-labs/agent-browser#1cc19526f3641c8543d55aa6700e7c55b37ac356 --skill agent-browser --agent codex --copy --yes
)
mkdir -p agent-browser/skills
cp -a "$work/.agents/skills/agent-browser" agent-browser/skills/
mkdir -p "$work/home/.agents"
export HOME="$work/home" DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
# Official installer exports complete embedded resources, not just SKILL.md.
officecli skills codex
for skill in word excel pptx academic-paper data-dashboard financial-model pitch-deck word-form morph-ppt morph-ppt-3d; do
  officecli skills install "$skill" codex
done
cp -a "$HOME/.agents/skills" officecli/
for skill in officecli officecli-docx officecli-xlsx officecli-pptx officecli-academic-paper officecli-data-dashboard officecli-financial-model officecli-pitch-deck officecli-word-form morph-ppt morph-ppt-3d; do
  test -s "officecli/skills/$skill/SKILL.md"
done
test -s officecli/skills/morph-ppt/reference/styles/INDEX.md
test -s agent-browser/skills/agent-browser/SKILL.md
# Original upstream licenses are source-controlled with each wrapper.
test -s agent-browser/UPSTREAM_LICENSE
test -s officecli/UPSTREAM_LICENSE

# Official Skills CLI copies complete original Google Workspace Skills/resources.
mkdir -p "$work/gws"
(
  cd "$work/gws"
  npx --yes skills@1.8.1 add googleworkspace/cli#cd3697e07eb520056dcf142d0c7439bbb9ba32e9 --skill '*' --agent codex --copy --yes
)
cp -a "$work/gws/.agents/skills" google-workspace/
test -s google-workspace/skills/gws-shared/SKILL.md
test -s google-workspace/skills/gws-gmail/SKILL.md
test -s google-workspace/UPSTREAM_LICENSE
