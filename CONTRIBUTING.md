# Contributing

Keep device operations small and separately testable. Reads must not require a Samba account. Treat an absent or malformed API field as unknown, not empty. Writes should check assumptions, avoid fixed account IDs, not retry ambiguous outcomes, and document cleanup and concurrency limits. Never include real device information or credentials in tests or reports. Verify changes with `npm test` and state exactly what was tested on real hardware.
