# Change independence test, 2026-07-01 to 2026-09-30

## Objective

Every change deployed to production during the period was approved by a person independent of the people who requested it, wrote it, or directed the agent that wrote it.

## Population

34 production deployments of 34 work items on demo bank, from 2026-07-01 (inclusive) to 2026-10-01 (exclusive).

## Method

- The population is every production deployment recorded in Jira for the period, with the work item it shipped.
- For each work item, Arm's Length rebuilt the change chain from the Jira history, the pull request activity and the MCP declarations of agent work, then applied the versioned rule table below.
- Free text (titles, descriptions, comments, commit messages) is excluded from the evidence, so it cannot change a verdict.
- Each verdict carries the SHA-256 of its evidence. The evidence-set hash covers every row, so any re-performance on the same evidence returns the same hash.

## Results

27 PASS, 6 FAIL, 1 CANNOT DETERMINE.

| Deployed (UTC) | Deployment | Work item | Pull request | Verdict | Rule | Independent approval | Evidence |
|---|---|---|---|---|---|---|---|
| 2026-07-02 16:55 | prod-401 | PAY-401 | payments-core#401 | PASS | - | Priya Raman | `c5c438931a0e` |
| 2026-07-06 16:55 | prod-404 | PAY-404 | payments-web#404 | PASS | - | Priya Raman | `44f16b9de839` |
| 2026-07-08 16:55 | prod-407 | PAY-407 | ledger-service#407 | PASS | - | Tom Becker | `0422e027f29e` |
| 2026-07-13 16:55 | prod-410 | PAY-410 | payments-core#410 | PASS | - | Tom Becker | `2112a952ad7d` |
| 2026-07-15 16:55 | prod-413 | PAY-413 | payments-web#413 | PASS | - | Priya Raman | `00f0c967315d` |
| 2026-07-20 16:55 | prod-416 | PAY-416 | ledger-service#416 | PASS | - | Priya Raman | `0bf924c2c438` |
| 2026-07-22 16:55 | prod-419 | PAY-419 | payments-core#419 | PASS | - | Priya Raman | `839ee2a683ac` |
| 2026-07-27 16:55 | prod-422 | PAY-422 | payments-web#422 | PASS | - | Priya Raman | `16fc2757d3c3` |
| 2026-07-29 16:55 | prod-425 | PAY-425 | ledger-service#425 | PASS | - | Tom Becker | `fb586e27fea9` |
| 2026-08-03 16:55 | prod-428 | PAY-428 | payments-core#428 | PASS | - | Tom Becker | `392c4407c991` |
| 2026-08-05 16:55 | prod-432 | PAY-432 | payments-web#432 | PASS | - | Priya Raman | `1faefc656ae3` |
| 2026-08-10 16:55 | prod-434 | PAY-434 | ledger-service#434 | PASS | - | Marco Bianchi | `2d6fad268b22` |
| 2026-08-12 16:55 | prod-431 | PAY-431 | payments-core#431 | FAIL | AL-1 | - | `4038dcc3745e` |
| 2026-08-14 16:55 | prod-437 | PAY-437 | ledger-service#437 | FAIL | AL-2 | - | `1735771f662b` |
| 2026-08-17 16:55 | prod-438 | PAY-438 | payments-core#438 | PASS | - | Priya Raman | `462342c28913` |
| 2026-08-19 16:55 | prod-440 | PAY-440 | payments-web#440 | PASS | - | Priya Raman | `1674c72b3466` |
| 2026-08-20 16:55 | prod-444 | PAY-444 | payments-core#444 | FAIL | AL-3 | - | `cda5323ce330` |
| 2026-08-24 16:55 | prod-443 | PAY-443 | ledger-service#443 | PASS | - | Tom Becker | `d01ccfb96075` |
| 2026-08-26 16:55 | prod-446 | PAY-446 | payments-core#446 | PASS | - | Tom Becker | `618c1757a210` |
| 2026-08-27 16:55 | prod-448 | PAY-448 | payments-core#448 | PASS | - | Tom Becker | `391c008e6c44` |
| 2026-08-31 16:55 | prod-449 | PAY-449 | payments-web#449 | PASS | - | Priya Raman | `e071fbfb325c` |
| 2026-09-01 16:55 | prod-452 | PAY-452 | payments-web#452 | FAIL | AL-6 | - | `050fa93d10ad` |
| 2026-09-02 16:55 | prod-453 | PAY-453 | ledger-service#453 | PASS | - | Priya Raman | `9b3b74ba51b2` |
| 2026-09-07 16:55 | prod-455 | PAY-455 | payments-core#455 | PASS | - | Priya Raman | `7644c39f5c12` |
| 2026-09-08 16:55 | prod-459 | PAY-459 | - | FAIL | AL-7 | - | `64dc5f894886` |
| 2026-09-09 16:55 | prod-458 | PAY-458 | payments-web#458 | PASS | - | Priya Raman | `bf1dbfb3c0ae` |
| 2026-09-14 16:55 | prod-461 | PAY-461 | ledger-service#461 | PASS | - | Tom Becker | `4060db218603` |
| 2026-09-15 16:55 | prod-466 | PAY-466 | ledger-service#466 | FAIL | AL-1 | - | `16a922a0a06b` |
| 2026-09-16 16:55 | prod-464 | PAY-464 | payments-core#464 | PASS | - | Tom Becker | `27798eaa8490` |
| 2026-09-21 16:55 | prod-467 | PAY-467 | payments-web#467 | PASS | - | Priya Raman | `ce489d3cb486` |
| 2026-09-22 16:55 | prod-471 | PAY-471 | ledger-service#471 | CANNOT DETERMINE | AL-4 | Tom Becker | `e81a62bc060e` |
| 2026-09-23 16:55 | prod-470 | PAY-470 | ledger-service#470 | PASS | - | Marco Bianchi | `cb92d630568d` |
| 2026-09-28 16:55 | prod-473 | PAY-473 | payments-core#473 | PASS | - | Priya Raman | `4867694be5b8` |
| 2026-09-29 16:55 | prod-476 | PAY-476 | payments-web#476 | PASS | - | Priya Raman | `9f9fa3ec3c94` |

## Exceptions

| Deployment | Work item | Rule | Finding | Action item |
|---|---|---|---|---|
| prod-431 | PAY-431 | AL-1 | Independent approval | Not raised |
| prod-437 | PAY-437 | AL-2 | Approval covers the final commit | Not raised |
| prod-444 | PAY-444 | AL-3 | Approvers are people | Not raised |
| prod-452 | PAY-452 | AL-6 | Approval before the merge | Not raised |
| prod-459 | PAY-459 | AL-7 | Production traces to an approved change | Not raised |
| prod-466 | PAY-466 | AL-1 | Independent approval | Not raised |
| prod-471 | PAY-471 | AL-4 | Agent work has a known principal | Not raised |

## Rules applied

Rule table 2026.10.1, policy independence-v1, emergency window 72 hours.

| Rule | Title | Reference |
|---|---|---|
| AL-1 | Independent approval | Commission Delegated Regulation (EU) 2024/1774 (DORA RTS on ICT risk management), Article 17, ICT change management; PCI DSS v4.0.1, Requirement 6.2.3.1 |
| AL-2 | Approval covers the final commit | PCI DSS v4.0.1, Requirement 6.2.3.1; PCI DSS v4.0.1, Requirement 6.5.4 |
| AL-3 | Approvers are people | Commission Delegated Regulation (EU) 2024/1774 (DORA RTS on ICT risk management), Article 17, ICT change management; PCI DSS v4.0.1, Requirement 6.2.3.1 |
| AL-4 | Agent work has a known principal | Commission Delegated Regulation (EU) 2024/1774 (DORA RTS on ICT risk management), Article 17, ICT change management |
| AL-6 | Approval before the merge | PCI DSS v4.0.1, Requirement 6.2.3.1; Commission Delegated Regulation (EU) 2024/1774 (DORA RTS on ICT risk management), Article 17, ICT change management |
| AL-7 | Production traces to an approved change | PCI DSS v4.0.1, Requirement 6.5.4 |

## Evidence integrity

SHA-256 of the evidence set: `3784dc11795bb31eb5eec3076bed18b5b776b896e03f2d4928ee1d7c8dcf0f87`

Prepared by Noor Haddad on 2026-10-05 09:00 UTC.
