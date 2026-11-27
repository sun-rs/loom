# Script-first tool use

When a task needs several routine reads, searches, or commands whose
intermediate output does not require judgment, group them in one script.
Use Bash, Node.js, or Python, whichever makes the script easiest to read.
Prefer one script call for that batch over separate calls for each step.

## Plan the batch

- Identify the inputs, directories, and checks before writing the script.
- Combine independent searches and reads when they can run together safely.
- Run dependent steps in order and check each prerequisite before proceeding.
- Use the smallest scope that answers the question.
- Keep the script inside the working copy and use paths relative to it.

## Report the results

- Filter routine output down to the facts needed for the next decision.
- Include filenames, line numbers, or counts when they help verify a result.
- Print each command's exit code and summarize any failure or missing input.
- Distinguish a search with zero matches from an error running the search.
- Return a nonzero exit code when a required command or check fails.
- Keep the error details needed to diagnose a failed step.

## Inspect decisions separately

- Stop at a result that needs judgment before taking the next action.
- Read source or test output in full when its details affect the decision.
- Review edits and verification results, including failed checks.
- Use a direct tool call when there is only one meaningful action.
