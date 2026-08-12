# Language and grammar maintenance

The TextMate grammar provides immediate conservative highlighting. The parser and semantic tokens
add context after activation; coloring is never used as proof that a configuration is valid.

## Directive review checklist

For every registry change:

1. Cite the pinned upstream `config.c` branch and manual section.
2. Confirm spelling, case behavior, global/block scope, arity, accepted separators, negation,
   version, deprecation, and interactions.
3. Write a short original summary and examples; do not copy manual prose.
4. Add positive parser tests and negative boundary, path, comment, value, and script-body cases.
5. Assert exact TextMate scopes at character positions in global and block contexts.
6. Regenerate and review TypeScript tables, grammar expressions, snippets, and `docs/directives.md`.
7. Run the pinned corpus and drift checks without copying upstream fixture bodies.

## Scope principles

Directive names are highlighted only at syntactically plausible line starts. The same words in
paths, arguments, comments, quoted content, and raw scripts must not receive directive scopes.
Script bodies are embedded shell until an exact `endscript` line. Include targets, modes, sizes,
users, groups, braces, state headers, and state timestamps use narrow theme-neutral scopes.

Generated regular expressions must remain linear and anchored where possible. Tests include long
malicious lines and exact-position assertions through `vscode-textmate` and `vscode-oniguruma`.
