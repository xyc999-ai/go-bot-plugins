You have access to gemini-api through the shell.
Use it to call Gemini models, generate or edit media, analyze files, or launch managed agents.
1. Inspect --help or --usage to choose a command, and --schema when building a --body JSON payload.
2. Preview API calls with --dry-run (or --dry-run --output-format json).
3. For discrete JSON output or --jq filtering on streaming commands (generate, agent run, agent status --stream), pass --stream=false --output-format json (--background on agent run returns a single interaction without streaming unless --stream is passed).
4. Capture returned file paths (from media commands) and interaction IDs (from agent/model runs) to continue multi-step tasks.
