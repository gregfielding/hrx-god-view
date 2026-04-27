# Flutter: Resume upload & parsing

The resume pipeline is implemented in **Firebase Cloud Functions**. The Flutter app (iOS/Android) calls the same HTTPS endpoint as the web app. There is no Flutter-specific SDK.

After a successful parse, the function updates **Firestore** (`users/{uid}`) server-side (resume metadata, work experience, skills, bio, etc.). The client should refresh the user document or rely on existing listeners.

---

## Endpoint

```
POST https://us-central1-<PROJECT_ID>.cloudfunctions.net/parseResumeHttp
```

Replace `<PROJECT_ID>` with your Firebase/GCP project ID (e.g. `hrx1-d3beb`). Use staging project IDs for non-production builds if applicable.

---

## Headers

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <Firebase ID token>` |

Obtain the token with Firebase Auth for the **signed-in user** (same Firebase project as HRX web):

```dart
final token = await FirebaseAuth.instance.currentUser?.getIdToken();
```

---

## Request body (JSON)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fileUrl` | string | Yes | **Data URL**: `data:<mime>;base64,<base64-encoded file bytes>` |
| `fileName` | string | Yes | Original filename (e.g. `resume.pdf`) — used for type detection |
| `fileSize` | number | Yes | Size in bytes (as reported by the file picker / `length` of bytes) |
| `userId` | string | Yes | Firebase UID of the user whose resume is being parsed |
| `tenantId` | string | Conditional | **Required** when an **admin/staff** user parses **on behalf of** another user in that tenant. For **self-upload** (`userId` == current user), the backend allows the call without `tenantId`, but sending the active tenant id is still recommended when available. |

### Building `fileUrl` in Flutter

1. Read the file as bytes (`Uint8List`).
2. Base64-encode the bytes.
3. Prefix with the correct MIME type, for example:
   - PDF: `data:application/pdf;base64,`
   - DOCX: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,`
   - DOC: `data:application/msword;base64,`
   - TXT: `data:text/plain;base64,`
   - JPEG: `data:image/jpeg;base64,`
   - PNG: `data:image/png;base64,`

Example shape:

```dart
final mime = 'application/pdf'; // derive from extension or lookup
final b64 = base64Encode(bytes);
final fileUrl = 'data:$mime;base64,$b64';
```

Match the web client’s approach: `src/components/ResumeUpload.tsx` (`fileToDataUrl` / `effectiveMime`).

### Suggested limits

- **Max file size**: align with web (**10 MB** per file) to avoid huge JSON payloads and timeouts.
- **Timeout**: use a **long** client timeout (e.g. **2–8 minutes**). Parsing includes storage, text extraction, OCR when needed, and OpenAI calls.

---

## Authorization rules (server)

The function verifies the Firebase ID token and then:

1. **Self-upload**: `decodedToken.uid === userId` → allowed (tenant id optional but useful).
2. **Staff on behalf of worker**: caller must be **internal staff (L5+)** for `tenantId`, and the **target user** must belong to that tenant. If `tenantId` is missing or wrong, the call returns **403**.

See `functions/src/resumeParser.ts`: `canParseResumeForUser`.

---

## Success response

HTTP **200** with JSON, for example:

```json
{
  "success": true,
  "uploadId": "...",
  "parsedData": {
    "contact": { "name": "...", "email": "...", ... },
    "summary": "...",
    "bio": "...",
    "skills": [...],
    "education": [...],
    "experience": [...],
    "certifications": [],
    "languages": [],
    "parsedText": "...",
    "confidence": 0.88,
    "aiAnalysis": { ... }
  },
  "duplicate": false,
  "message": "..."
}
```

`duplicate: true` may appear when the same file hash was already processed; `parsedData` may come from the existing parse.

---

## Error responses

- **401** — Missing or invalid `Authorization` token.
- **400** — Missing `fileUrl`, `fileName`, or `userId`.
- **403** — Not allowed to parse for the target user (staff/tenant rules).
- **500** — Server error; body often includes `{ "error": "message", "code": "..." }`.

Parse the JSON error body when present.

---

## CORS

**Browser-only concern.** Flutter mobile uses native HTTP; **CORS does not apply**.  
If you ever call this URL from **Flutter web**, origins must be allowed by the function (see `pickCorsOrigin` in `functions/src/resumeParser.ts` and optional env `RESUME_PARSE_ALLOWED_ORIGINS`).

---

## After success: UI / data refresh

The function persists:

- Resume file in **Firebase Storage** and `users/{uid}.resume` (metadata + token-based `downloadUrl`).
- Parsed merge fields on **`users/{uid}`** (e.g. `workExperience`, `workHistory`, `employmentHistory`, `skills`, `education`, `bio` / `professionalBio`, etc.) via `commitMerge`.

No second “apply merge” HTTP call is required for the default flow. Refresh the user profile from Firestore (or your BFF) so tabs show updated bio, work history, and skills.

---

## Optional environment variables (backend)

Configured on the Cloud Function runtime, not in the Flutter app:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` / `OPENAI_KEY` | Required for extraction |
| `RESUME_PARSE_ALLOWED_ORIGINS` | Extra CORS origins (comma-separated) |
| `RESUME_EXTRACTION_MODEL` | Default `gpt-4o-mini` |
| `RESUME_ANALYSIS_MODEL` | Default `gpt-4o-mini` |
| `RESUME_BIO_MODEL` | Default `gpt-4o-mini` |

---

## Reference implementation (web)

- `src/components/ResumeUpload.tsx` — request shape, timeout, error handling.
- `functions/src/resumeParser.ts` — `parseResumeHttp`, `parseResumeCore`, `canParseResumeForUser`.

---

## Future improvement (not required for parity)

A future architecture may use **direct upload to Cloud Storage** + a small “finalize” call to avoid large base64 JSON bodies. Until then, Flutter should mirror the **data URL + POST** contract above.
