# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/portswigger-tim/agent-wrangler-yolo/security/advisories/new),
not in a public issue. We aim to acknowledge reports within three working days.

## Scope

This extension runs inside the Agent Wrangler server with the server's machine
access, and it lets an opted-in agent session merge, release and change
settings on one repository. Reports about a session acting outside the repo it
was launched in, bypassing the pre-commit gate, or weakening a repository
protection without asking are especially welcome.
