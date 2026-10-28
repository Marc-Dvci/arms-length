# Demo bank

Synthetic data loaded by Arm's Length's "Load demo bank" button. Every person, agent, repository, pull request and
deployment below is fictional. The rule engine evaluates these chains exactly as it evaluates live ones.

## People

| Name | Role |
|---|---|
| Léa Martin | Payments team lead |
| Tom Becker | Senior engineer |
| Sam Okafor | Product owner |
| Priya Raman | Engineer |
| Marco Bianchi | Engineer |
| Aïcha Diallo | Engineer |
| Noor Haddad | IT risk officer |

Agents: Coding agent (opens pull requests as coder-bot), Fix agent (fixer-bot), Test agent (tester-bot). review-bot is a
service account that approves automatically. Automation for Jira runs two rules: `triage-agent`, owned by Sam Okafor, and
`deps-agent`, with no recorded owner.

## Pipelines

Production deployments run the `payments-release` pipeline. Marco Bianchi triggered prod-459 by hand, with a hotfix commit that no pull request contains.

## ledger-service

### ledger-service 407

PAY-407: Retry SWIFT acknowledgements with backoff. Opened by Aïcha Diallo from `PAY-407-retry-swift-acknowledgements`, merged.
Reviews: Tom Becker approved 2026-07-08 13:55. Verdict PASS.

### ledger-service 416

PAY-416: Add instant payment limit per client segment. Opened by Marco Bianchi from `PAY-416-add-instant-payment`, merged.
Reviews: Priya Raman approved 2026-07-20 13:55. Verdict PASS.

### ledger-service 425

PAY-425: Move the settlement batch to the new scheduler. Opened by Priya Raman from `PAY-425-move-the-settlement`, merged.
Reviews: Tom Becker approved 2026-07-29 13:55. Verdict PASS.

### ledger-service 434

PAY-434: Paginate the transaction history endpoint. Opened by Tom Becker from `PAY-434-paginate-the-transaction`, merged.
Reviews: Marco Bianchi approved 2026-08-10 13:55. Verdict PASS.

### ledger-service 437

PAY-437: Change the rounding of interest accruals. Opened by coder-bot from `PAY-437-change-the-rounding`, merged.
Reviews: Tom Becker approved 2026-08-14 11:55. Verdict FAIL (AL-2).

### ledger-service 443

PAY-443: Upgrade the ISO 20022 schema to 2025 release. Opened by Aïcha Diallo from `PAY-443-upgrade-the-iso`, merged.
Reviews: Tom Becker approved 2026-08-24 13:55. Verdict PASS.

### ledger-service 453

PAY-453: Handle partial refunds on card payments. Opened by Marco Bianchi from `PAY-453-handle-partial-refunds`, merged.
Reviews: Priya Raman approved 2026-09-02 13:55. Verdict PASS.

### ledger-service 461

PAY-461: Add idempotency keys to payment initiation. Opened by Priya Raman from `PAY-461-add-idempotency-keys`, merged.
Reviews: Tom Becker approved 2026-09-14 13:55. Verdict PASS.

### ledger-service 466

PAY-466: Bump the HTTP client in the clearing adapter. Opened by coder-bot from `PAY-466-bump-the-http`, merged.
Reviews: Sam Okafor approved 2026-09-15 12:55. Verdict FAIL (AL-1).

### ledger-service 470

PAY-470: Raise the timeout for the sanctions screening call. Opened by Tom Becker from `PAY-470-raise-the-timeout`, merged.
Reviews: Marco Bianchi approved 2026-09-23 13:55. Verdict PASS.

### ledger-service 471

PAY-471: Update the JSON parser in the statement service. Opened by coder-bot from `PAY-471-update-the-json`, merged.
Reviews: Tom Becker approved 2026-09-22 12:55. Verdict CANNOT DETERMINE (AL-4).


## payments-core

### payments-core 401

PAY-401: Validate IBAN checksum before SEPA submission. Opened by coder-bot from `PAY-401-validate-iban-checksum`, merged.
Reviews: Priya Raman approved 2026-07-02 13:55. Verdict PASS.

### payments-core 410

PAY-410: Show the cut-off time on the transfer form. Opened by fixer-bot from `PAY-410-show-the-cut-off`, merged.
Reviews: Tom Becker approved 2026-07-13 13:55. Verdict PASS.

### payments-core 419

PAY-419: Log reason codes for returned direct debits. Opened by tester-bot from `PAY-419-log-reason-codes`, merged.
Reviews: Priya Raman approved 2026-07-22 13:55. Verdict PASS.

### payments-core 428

PAY-428: Expose mandate status in the client API. Opened by coder-bot from `PAY-428-expose-mandate-status`, merged.
Reviews: Tom Becker approved 2026-08-03 13:55. Verdict PASS.

### payments-core 431

PAY-431: Raise the instant payment ceiling for business clients. Opened by coder-bot from `PAY-431-raise-the-instant`, merged.
Reviews: Léa Martin approved 2026-08-12 10:07. Verdict FAIL (AL-1).

### payments-core 438

PAY-438: Alert on ledger imbalance above threshold. Opened by coder-bot from `PAY-438-alert-on-ledger`, merged.
Reviews: Priya Raman approved 2026-08-17 13:55. Verdict PASS.

### payments-core 444

PAY-444: Skip the second screening pass for low-risk transfers. Opened by fixer-bot from `PAY-444-skip-the-second`, merged.
Reviews: review-bot approved 2026-08-20 10:01; Léa Martin approved 2026-08-20 13:55. Verdict FAIL (AL-3).

### payments-core 446

PAY-446: Add a confirmation step for beneficiary changes. Opened by fixer-bot from `PAY-446-add-a-confirmation`, merged.
Reviews: Tom Becker approved 2026-08-26 13:55. Verdict PASS.

### payments-core 448

PAY-448: Restore the clearing gateway certificate. Opened by Marco Bianchi from `PAY-448-restore-the-clearing`, merged.
Reviews: Tom Becker approved 2026-08-28 10:55. Verdict PASS.

### payments-core 455

PAY-455: Record the requester on manual adjustments. Opened by tester-bot from `PAY-455-record-the-requester`, merged.
Reviews: Priya Raman approved 2026-09-07 13:55. Verdict PASS.

### payments-core 459

PAY-459: Correct the fee table for cross-border transfers. Opened by Priya Raman from `PAY-459-correct-the-fee`, merged.
Reviews: Tom Becker approved 2026-09-08 13:55. Verdict PASS.

### payments-core 464

PAY-464: Show pending holds on the balance screen. Opened by coder-bot from `PAY-464-show-pending-holds`, merged.
Reviews: Tom Becker approved 2026-09-16 13:55. Verdict PASS.

### payments-core 473

PAY-473: Add a health check for the clearing gateway. Opened by coder-bot from `PAY-473-add-a-health`, merged.
Reviews: Priya Raman approved 2026-09-28 13:55. Verdict PASS.

### payments-core 482

PAY-482: Check the IBAN country code against the beneficiary bank. Opened by coder-bot from `PAY-482-check-the-iban`, open.
Reviews: Léa Martin approved 2026-10-27 18:12. Verdict FAIL (AL-1).


## payments-web

### payments-web 404

PAY-404: Round FX conversion to the currency minor unit. Opened by coder-bot from `PAY-404-round-fx-conversion`, merged.
Reviews: Priya Raman approved 2026-07-06 13:55. Verdict PASS.

### payments-web 413

PAY-413: Reject duplicate end-to-end IDs. Opened by coder-bot from `PAY-413-reject-duplicate-end-to-end`, merged.
Reviews: Priya Raman approved 2026-07-15 13:55. Verdict PASS.

### payments-web 422

PAY-422: Mask PAN in the dispute export. Opened by fixer-bot from `PAY-422-mask-pan-in`, merged.
Reviews: Priya Raman approved 2026-07-27 13:55. Verdict PASS.

### payments-web 432

PAY-432: Fix the daylight-saving shift in the value date. Opened by tester-bot from `PAY-432-fix-the-daylight-saving`, merged.
Reviews: Priya Raman approved 2026-08-05 13:55. Verdict PASS.

### payments-web 440

PAY-440: Cache BIC directory lookups. Opened by coder-bot from `PAY-440-cache-bic-directory`, merged.
Reviews: Priya Raman approved 2026-08-19 13:55. Verdict PASS.

### payments-web 449

PAY-449: Split fee lines on the statement. Opened by coder-bot from `PAY-449-split-fee-lines`, merged.
Reviews: Priya Raman approved 2026-08-31 13:55. Verdict PASS.

### payments-web 452

PAY-452: Shorten the dispute window shown to clients. Opened by coder-bot from `PAY-452-shorten-the-dispute`, merged.
Reviews: Priya Raman approved 2026-09-01 17:55. Verdict FAIL (AL-6).

### payments-web 458

PAY-458: Remove the legacy CSV upload. Opened by fixer-bot from `PAY-458-remove-the-legacy`, merged.
Reviews: Priya Raman approved 2026-09-09 13:55. Verdict PASS.

### payments-web 467

PAY-467: Reconcile the nostro accounts nightly. Opened by tester-bot from `PAY-467-reconcile-the-nostro`, merged.
Reviews: Priya Raman approved 2026-09-21 13:55. Verdict PASS.

### payments-web 476

PAY-476: Normalise beneficiary names before screening. Opened by coder-bot from `PAY-476-normalise-beneficiary-names`, merged.
Reviews: Priya Raman approved 2026-09-29 13:55. Verdict PASS.

## Deployments

### prod-401

PAY-401, production, 2026-07-02 16:55 UTC, commit `401m3e2`.

### stg-404

PAY-404, staging, 2026-07-06 10:55 UTC, commit `404a1c0`.

### prod-404

PAY-404, production, 2026-07-06 16:55 UTC, commit `404m3e2`.

### prod-407

PAY-407, production, 2026-07-08 16:55 UTC, commit `407m3e2`.

### prod-410

PAY-410, production, 2026-07-13 16:55 UTC, commit `410m3e2`.

### prod-413

PAY-413, production, 2026-07-15 16:55 UTC, commit `413m3e2`.

### stg-416

PAY-416, staging, 2026-07-20 10:55 UTC, commit `416a1c0`.

### prod-416

PAY-416, production, 2026-07-20 16:55 UTC, commit `416m3e2`.

### prod-419

PAY-419, production, 2026-07-22 16:55 UTC, commit `419m3e2`.

### prod-422

PAY-422, production, 2026-07-27 16:55 UTC, commit `422m3e2`.

### prod-425

PAY-425, production, 2026-07-29 16:55 UTC, commit `425m3e2`.

### stg-428

PAY-428, staging, 2026-08-03 10:55 UTC, commit `428a1c0`.

### prod-428

PAY-428, production, 2026-08-03 16:55 UTC, commit `428m3e2`.

### prod-431

PAY-431, production, 2026-08-12 16:55 UTC, commit `431m3e2`.

### prod-432

PAY-432, production, 2026-08-05 16:55 UTC, commit `432m3e2`.

### prod-434

PAY-434, production, 2026-08-10 16:55 UTC, commit `434m3e2`.

### prod-437

PAY-437, production, 2026-08-14 16:55 UTC, commit `437m3e2`.

### prod-438

PAY-438, production, 2026-08-17 16:55 UTC, commit `438m3e2`.

### stg-440

PAY-440, staging, 2026-08-19 10:55 UTC, commit `440a1c0`.

### prod-440

PAY-440, production, 2026-08-19 16:55 UTC, commit `440m3e2`.

### prod-443

PAY-443, production, 2026-08-24 16:55 UTC, commit `443m3e2`.

### prod-444

PAY-444, production, 2026-08-20 16:55 UTC, commit `444m3e2`.

### prod-446

PAY-446, production, 2026-08-26 16:55 UTC, commit `446m3e2`.

### prod-448

PAY-448, production, 2026-08-27 16:55 UTC, commit `448m3e2`.

### prod-449

PAY-449, production, 2026-08-31 16:55 UTC, commit `449m3e2`.

### prod-452

PAY-452, production, 2026-09-01 16:55 UTC, commit `452m3e2`.

### stg-453

PAY-453, staging, 2026-09-02 10:55 UTC, commit `453a1c0`.

### prod-453

PAY-453, production, 2026-09-02 16:55 UTC, commit `453m3e2`.

### prod-455

PAY-455, production, 2026-09-07 16:55 UTC, commit `455m3e2`.

### prod-458

PAY-458, production, 2026-09-09 16:55 UTC, commit `458m3e2`.

### prod-459

PAY-459, production, 2026-09-08 16:55 UTC, commit `459f9h0`.

### prod-461

PAY-461, production, 2026-09-14 16:55 UTC, commit `461m3e2`.

### stg-464

PAY-464, staging, 2026-09-16 10:55 UTC, commit `464a1c0`.

### prod-464

PAY-464, production, 2026-09-16 16:55 UTC, commit `464m3e2`.

### prod-466

PAY-466, production, 2026-09-15 16:55 UTC, commit `466m3e2`.

### prod-467

PAY-467, production, 2026-09-21 16:55 UTC, commit `467m3e2`.

### prod-470

PAY-470, production, 2026-09-23 16:55 UTC, commit `470m3e2`.

### prod-471

PAY-471, production, 2026-09-22 16:55 UTC, commit `471m3e2`.

### prod-473

PAY-473, production, 2026-09-28 16:55 UTC, commit `473m3e2`.

### stg-476

PAY-476, staging, 2026-09-29 10:55 UTC, commit `476a1c0`.

### prod-476

PAY-476, production, 2026-09-29 16:55 UTC, commit `476m3e2`.
