# cli-hop

CLI that launches agent CLIs against the CLI Hop gateway using one
user-configured credential.

## Language

**Primary API Key**:
The single CLI Hop key the user configures once; every supported agent CLI is
launched with it.
_Avoid_: token, secret, password

**Credential Store**:
The authoritative home of the Primary API Key while at rest: the OS keychain
when one is usable, otherwise the Settings File. The only place the key is
*entered*.
_Avoid_: single source of truth (ambiguous — the store is a single *input*, not
a single *copy*)

**Settings File**:
The user's non-secret configuration. Also serves as the Credential Store's
fallback location on systems with no usable keychain.
_Avoid_: config, profile

**Agent Config**:
A per-agent file the tool writes so that agent talks to CLI Hop when launched
directly. Always a *derived copy* of the Credential Store + Settings File —
never an independent input, and freely overwritten or removed by the tool.
_Avoid_: credential (it may contain one, but it is not where one is entered)
