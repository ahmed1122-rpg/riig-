# ADR 0001: Modular monolith with isolated workers

## Context

The platform has ordinary SaaS operations plus CPU/GPU-heavy file processing. The initial team and traffic do not justify independently deployed services for every domain.

## Decision

Use one modular API application for transactional product domains. Run AI/PDF and export work in isolated workers connected by versioned contracts and a queue.

## Consequences

- Faster local development and fewer distributed failure modes.
- AI and export workloads can scale independently.
- Modules must not read each other's persistence directly.
- A module may be extracted only when measured scaling, security isolation, or team ownership requires it.

