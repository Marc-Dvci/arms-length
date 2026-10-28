# Rule engine scores

Rule table 2026.10.1, policy independence-v1. Reproduce with `npm run eval`.

| Set | Cases | Verdict correct | Primary rule correct | Flags correct |
|---|---:|---:|---:|---:|
| labelled | 42 | 42 | 42 | 42 |
| heldout | 16 | 16 | 16 | 16 |

## labelled

| Labelled ↓ Returned → | PASS | FAIL | CANNOT DETERMINE |
|---|---:|---:|---:|
| PASS | 16 | 0 | 0 |
| FAIL | 0 | 21 | 0 |
| CANNOT DETERMINE | 0 | 0 | 5 |

## heldout

| Labelled ↓ Returned → | PASS | FAIL | CANNOT DETERMINE |
|---|---:|---:|---:|
| PASS | 5 | 0 | 0 |
| FAIL | 0 | 9 | 0 |
| CANNOT DETERMINE | 0 | 0 | 2 |
