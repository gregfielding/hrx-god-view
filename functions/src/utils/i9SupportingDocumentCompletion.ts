/**
 * I-9 supporting document completion (List A OR List B + List C), approved only.
 * Mirrors `src/utils/i9SupportingDocumentCompletion.ts` for Cloud Functions.
 */

export type I9ListGroup = 'a' | 'b' | 'c' | 'other';

export function i9ListGroupForDocumentType(documentType: string): I9ListGroup {
  const v = String(documentType || '').trim().toLowerCase();
  if (v.startsWith('list_a_')) return 'a';
  if (v.startsWith('list_b_')) return 'b';
  if (v.startsWith('list_c_')) return 'c';
  return 'other';
}

export type I9DocRowLike = {
  documentType: string;
  status: string;
};

export function hasApprovedListA(documents: I9DocRowLike[]): boolean {
  return documents.some(
    (d) => String(d.status || '').toLowerCase() === 'approved' && i9ListGroupForDocumentType(d.documentType) === 'a',
  );
}

export function hasApprovedListB(documents: I9DocRowLike[]): boolean {
  return documents.some(
    (d) => String(d.status || '').toLowerCase() === 'approved' && i9ListGroupForDocumentType(d.documentType) === 'b',
  );
}

export function hasApprovedListC(documents: I9DocRowLike[]): boolean {
  return documents.some(
    (d) => String(d.status || '').toLowerCase() === 'approved' && i9ListGroupForDocumentType(d.documentType) === 'c',
  );
}

export function isI9DocumentSetComplete(documents: I9DocRowLike[]): boolean {
  return hasApprovedListA(documents) || (hasApprovedListB(documents) && hasApprovedListC(documents));
}
