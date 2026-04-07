# I-9 Document AI smoke test fixtures

Place **synthetic or redacted** sample images here for `npm run test:i9-extraction` (from repo root).

Expected filenames (see `functions/scripts/testI9Extraction.ts`):

| File | `documentType` |
|------|------------------|
| `ssn_card.jpg` | `list_c_ssn_card` |
| `drivers_license.jpg` | `list_b_drivers_license` |
| `green_card.jpg` | `list_a_pr_card` |
| `ead.jpg` | `list_a_ead` |
| `passport.jpg` | `list_a_us_passport` |
| `state_id.jpg` | `list_b_gov_id` |
| `birth_certificate.jpg` | `list_c_birth_certificate` |

Do **not** commit real government IDs or SSN-bearing images. Use test doubles or blur/redact.

You can also run ad hoc files without copying here:

```bash
npm run test:i9-extraction -- list_a_us_passport /path/to/sample.jpg
```
