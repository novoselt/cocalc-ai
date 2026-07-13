# Admin Support Triage

The admin support commands provide bounded, audited, read-only access to
redacted Zendesk ticket data. They are intended to make support reports an
operational signal and to give humans better context for support responses.

They do not modify Zendesk, write customer responses, fetch attachments, read
project files, or send ticket content to an AI provider.

## Commands

Every command requires a human-readable audit reason.

```bash
cocalc --json admin support triage \
  --since-minutes 360 \
  --reason "correlate support spike with current cluster incidents"

cocalc --json admin support list \
  --since-minutes 1440 \
  --status new,open,pending,hold \
  --reason "review unresolved support queue"

cocalc --json admin support show 12345 \
  --reason "understand reported terminal failure"
```

Server-enforced maximums are:

- seven days of ticket creation history
- 100 tickets per list or triage call
- 100 comments per ticket detail call
- 1 MiB per response
- two concurrent Zendesk reads per hub API process
- 20 seconds before the caller receives a timeout

If a timed-out Zendesk HTTP request remains pending, it continues to occupy its
concurrency slot until the underlying request settles. This prevents repeated
operator retries from creating an unbounded request fan-out.

## Output Boundary

Responses include:

- ticket ID, status, priority, type, and timestamps
- redacted subject, description, and comment text
- a pseudonymous fingerprint for the ticket's external account ID
- project IDs extracted from CoCalc project URLs
- attachment counts and total bytes, but no names, content, or URLs
- deterministic categories and known error signatures
- deterministic duplicate groups in `triage` output

Responses omit requester email/name, Zendesk user IDs, raw external account
IDs, HTML, comment metadata, attachment names, and attachment URLs.

Redaction is explicitly marked `best_effort`. Output remains admin-confidential
and must not be copied into public logs or tickets without human review.

## Investigation Workflow

1. Run `triage` over the suspected incident window.
2. Look for groups with multiple ticket IDs, shared error signatures, or a
   concentration in availability, project start, files, terminal, Codex, or
   Jupyter categories.
3. Use `show` for the minimum number of representative tickets needed to
   understand the symptom.
4. Correlate extracted project IDs with existing routed project/host status and
   audited host diagnostics. Do not inspect project files merely because a
   ticket includes a project ID.
5. Report evidence, confidence, and uncertainty. Deterministic categories are
   search aids, not proof of a root cause.
6. Leave customer communication and Zendesk changes to a human operator.

Every successful or failed Zendesk operation records an
`admin_support_operator` central-log event with the actor, reason, operation,
limits, result size/count, duration, and error. Ticket text and comment content
are never written to that audit event.
