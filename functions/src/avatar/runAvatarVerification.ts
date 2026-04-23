/**
 * Core avatar (headshot) verification: download an image, run Cloud Vision face detection,
 * translate the response into our AvatarVerification shape.
 *
 * Pure-ish module — takes a URL or bytes and returns a result. No Firestore access. This
 * lets callers (the onUserWritten trigger, the reverify callable, unit tests) all share
 * the same decision logic.
 *
 * Why byte download instead of Vision's imageUri field:
 *   Our avatar URLs are Firebase Storage download URLs with auth tokens, which Vision cannot
 *   fetch (imageUri only works for public gs:// or storage.googleapis.com URIs). Fetching
 *   the bytes ourselves in the function also means we don't care whether the avatar came
 *   from Firebase Storage, a Google OAuth login photo, or anywhere else.
 */
import { ImageAnnotatorClient, protos } from '@google-cloud/vision';
import sharp from 'sharp';
import { logger } from 'firebase-functions/v2';

import {
  AVATAR_VERIFICATION_THRESHOLDS,
  AvatarQualitySignals,
  AvatarRejectionReason,
  AvatarVerificationStatus,
  VISION_LIKELIHOOD_INDEX,
  VisionLikelihood,
} from './avatarVerificationTypes';

type IFace = protos.google.cloud.vision.v1.IFaceAnnotation;
type IVertex = protos.google.cloud.vision.v1.IVertex;

// Single Vision client per process — initialized lazily on first call so cold-start cost is
// only paid when the trigger actually fires. Firebase default credentials are picked up
// automatically via ADC in the Functions runtime.
let _client: ImageAnnotatorClient | null = null;
function visionClient(): ImageAnnotatorClient {
  if (!_client) _client = new ImageAnnotatorClient();
  return _client;
}

/**
 * Caller tells us enough to run the verification. `imageBytes` lets tests (and the reverify
 * callable running with cached bytes) skip the fetch; trigger code will just pass `url`.
 */
export interface RunAvatarVerificationArgs {
  /** The avatar URL being verified — also stored on the output record as sourceAvatarUrl. */
  url: string;
  /** Optional pre-fetched bytes; bypasses the HTTP fetch when provided. */
  imageBytes?: Buffer;
  /** Log-correlation hint; shows up in structured logs. */
  userId?: string;
}

/** Result shape is deliberately a subset of AvatarVerification — callers merge in the timestamps + `verifiedBy`. */
export interface AvatarVerificationDecision {
  status: AvatarVerificationStatus;
  rejectionReason: AvatarRejectionReason | null;
  qualitySignals: AvatarQualitySignals | null;
  errorCode?: string;
  errorMessage?: string;
}

/** Maximum avatar payload we will analyse. Wizard caps at 5 MB; this is a guardrail. */
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

/** How long we'll wait for the avatar URL to return before giving up. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch the avatar bytes. Returns null on any failure so the caller can record an
 * 'error' decision without the whole function throwing.
 */
async function fetchImageBytes(url: string, userId?: string): Promise<Buffer | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) {
      logger.warn('avatar_verification.fetch_non_ok', {
        userId,
        status: res.status,
        url: url.slice(0, 200),
      });
      return null;
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength === 0) return null;
    if (ab.byteLength > MAX_AVATAR_BYTES) {
      logger.warn('avatar_verification.fetch_too_large', {
        userId,
        bytes: ab.byteLength,
      });
      return null;
    }
    return Buffer.from(ab);
  } catch (err) {
    logger.warn('avatar_verification.fetch_failed', {
      userId,
      error: (err as Error)?.message || String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pixel area of a bounding-poly described by 4 vertices. Missing coords are treated as 0. */
function polyAreaPx(vertices: IVertex[] | null | undefined): number {
  if (!vertices || vertices.length === 0) return 0;
  const xs = vertices.map((v) => (typeof v?.x === 'number' ? v.x : 0));
  const ys = vertices.map((v) => (typeof v?.y === 'number' ? v.y : 0));
  const w = Math.max(0, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(0, Math.max(...ys) - Math.min(...ys));
  return w * h;
}

/**
 * Translate the Vision API response into a quality-signals record + an approve/reject
 * decision. Separated from the RPC call so tests can drive it with synthetic annotations.
 */
export function decideFromFaceAnnotations(
  faces: IFace[] | null | undefined,
  imageWidthPx: number | null,
  imageHeightPx: number | null,
): AvatarVerificationDecision {
  const rawFaceCount = Array.isArray(faces) ? faces.length : 0;
  const imageAreaPx = imageWidthPx && imageHeightPx ? imageWidthPx * imageHeightPx : null;

  // Largest face (by bounding poly area) drives the ratio / confidence we evaluate.
  let largest: IFace | null = null;
  let largestAreaPx = 0;
  if (faces) {
    for (const f of faces) {
      const a = polyAreaPx(f.boundingPoly?.vertices as IVertex[] | undefined);
      if (a > largestAreaPx) {
        largest = f;
        largestAreaPx = a;
      }
    }
  }

  /**
   * Count NON-primary faces that look like real people (not Vision false-positives on
   * background clutter). A secondary face counts only when its area ratio AND detection
   * confidence both clear the configured noise floor — see SECONDARY_FACE_* thresholds.
   */
  let significantSecondaryCount = 0;
  if (faces && largest && imageAreaPx && imageAreaPx > 0) {
    for (const f of faces) {
      if (f === largest) continue;
      const areaPx = polyAreaPx(f.boundingPoly?.vertices as IVertex[] | undefined);
      const areaRatio = areaPx / imageAreaPx;
      const confidence = typeof f.detectionConfidence === 'number' ? f.detectionConfidence : 0;
      if (
        areaRatio >= AVATAR_VERIFICATION_THRESHOLDS.SECONDARY_FACE_AREA_RATIO_MIN &&
        confidence >= AVATAR_VERIFICATION_THRESHOLDS.SECONDARY_FACE_DETECTION_CONFIDENCE_MIN
      ) {
        significantSecondaryCount += 1;
      }
    }
  } else if (faces && largest) {
    // Image dimensions unknown — fall back to counting secondaries purely by confidence. This
    // is conservative (more likely to reject) so we preserve the strict "no two people" rule.
    for (const f of faces) {
      if (f === largest) continue;
      const confidence = typeof f.detectionConfidence === 'number' ? f.detectionConfidence : 0;
      if (confidence >= AVATAR_VERIFICATION_THRESHOLDS.SECONDARY_FACE_DETECTION_CONFIDENCE_MIN) {
        significantSecondaryCount += 1;
      }
    }
  }

  // The `faceCount` we persist is the RAW Vision count so recruiters reviewing a rejected
  // record can see exactly what Vision reported. The decision uses the filtered count.
  const faceAreaRatio = imageAreaPx && imageAreaPx > 0 ? largestAreaPx / imageAreaPx : null;
  const detectionConfidence = typeof largest?.detectionConfidence === 'number' ? largest.detectionConfidence : null;

  const blurredLikelihood = normaliseLikelihood(largest?.blurredLikelihood);
  const underExposedLikelihood = normaliseLikelihood(largest?.underExposedLikelihood);
  const headwearLikelihood = normaliseLikelihood(largest?.headwearLikelihood);

  const qualitySignals: AvatarQualitySignals = {
    faceCount: rawFaceCount,
    faceAreaRatio,
    detectionConfidence,
    blurredLikelihood,
    underExposedLikelihood,
    headwearLikelihood,
    imageWidthPx,
    imageHeightPx,
  };

  // Rejection priority — pick the single worst issue for the clearest re-upload guidance.
  if (rawFaceCount === 0) {
    return { status: 'rejected', rejectionReason: 'no_face', qualitySignals };
  }
  if (significantSecondaryCount > 0) {
    return { status: 'rejected', rejectionReason: 'multiple_faces', qualitySignals };
  }

  if (faceAreaRatio != null && faceAreaRatio < AVATAR_VERIFICATION_THRESHOLDS.MIN_FACE_AREA_RATIO) {
    return { status: 'rejected', rejectionReason: 'face_too_small', qualitySignals };
  }

  const blurredIdx = blurredLikelihood ? VISION_LIKELIHOOD_INDEX[blurredLikelihood] : 0;
  if (blurredIdx >= AVATAR_VERIFICATION_THRESHOLDS.REJECT_AT_LIKELIHOOD_INDEX) {
    return { status: 'rejected', rejectionReason: 'too_blurry', qualitySignals };
  }

  const underExposedIdx = underExposedLikelihood ? VISION_LIKELIHOOD_INDEX[underExposedLikelihood] : 0;
  if (underExposedIdx >= AVATAR_VERIFICATION_THRESHOLDS.REJECT_AT_LIKELIHOOD_INDEX) {
    return { status: 'rejected', rejectionReason: 'too_dark', qualitySignals };
  }

  if (
    detectionConfidence != null &&
    detectionConfidence < AVATAR_VERIFICATION_THRESHOLDS.MIN_DETECTION_CONFIDENCE
  ) {
    // Low-confidence face detection — treat as too-blurry for the re-upload message since it's
    // almost always a framing / focus issue. A recruiter can manually override.
    return { status: 'rejected', rejectionReason: 'too_blurry', qualitySignals };
  }

  return { status: 'approved', rejectionReason: null, qualitySignals };
}

/** Vision SDK sometimes returns the likelihood as enum number; normalise to the string form. */
function normaliseLikelihood(
  raw: protos.google.cloud.vision.v1.Likelihood | keyof typeof protos.google.cloud.vision.v1.Likelihood | null | undefined,
): VisionLikelihood | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    return (raw as VisionLikelihood) in VISION_LIKELIHOOD_INDEX
      ? (raw as VisionLikelihood)
      : null;
  }
  // Numeric enum. Map via protos reverse lookup; fall back to index.
  const asString = protos.google.cloud.vision.v1.Likelihood[raw as number];
  if (typeof asString === 'string' && (asString as VisionLikelihood) in VISION_LIKELIHOOD_INDEX) {
    return asString as VisionLikelihood;
  }
  return null;
}

/**
 * Top-level: fetch bytes, read image dimensions, call Vision, decide. Never throws — any
 * failure becomes an 'error' decision so the trigger can always produce a record.
 */
export async function runAvatarVerification(args: RunAvatarVerificationArgs): Promise<AvatarVerificationDecision> {
  const { url, userId } = args;

  const bytes = args.imageBytes ?? (await fetchImageBytes(url, userId));
  if (!bytes) {
    return {
      status: 'error',
      rejectionReason: 'verification_error',
      qualitySignals: null,
      errorCode: 'fetch_failed',
      errorMessage: 'Unable to download avatar image for verification.',
    };
  }

  // sharp.metadata() is robust across JPEG/PNG/WEBP/HEIC(if libvips built with heif) — good
  // enough for the ratio calc. Failure here doesn't stop the verification; we just lose the
  // ability to compute faceAreaRatio and let face detection alone drive the decision.
  let widthPx: number | null = null;
  let heightPx: number | null = null;
  try {
    const meta = await sharp(bytes).metadata();
    widthPx = meta.width ?? null;
    heightPx = meta.height ?? null;
  } catch (err) {
    logger.warn('avatar_verification.sharp_metadata_failed', {
      userId,
      error: (err as Error)?.message || String(err),
    });
  }

  try {
    const [res] = await visionClient().faceDetection({
      image: { content: bytes },
    });
    const decision = decideFromFaceAnnotations(res.faceAnnotations, widthPx, heightPx);
    return decision;
  } catch (err) {
    logger.error('avatar_verification.vision_failed', {
      userId,
      error: (err as Error)?.message || String(err),
    });
    return {
      status: 'error',
      rejectionReason: 'verification_error',
      qualitySignals: null,
      errorCode: 'vision_failed',
      errorMessage: ((err as Error)?.message || 'Vision API call failed').slice(0, 500),
    };
  }
}
