/**
 * I-9 supporting document completion: List A OR (List B + List C), approved only.
 * `other_supporting` and unknown types do not satisfy the employer document set.
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

/** Valid I-9 document set: one approved List A, or one approved List B and one approved List C. */
export function isI9DocumentSetComplete(documents: I9DocRowLike[]): boolean {
  return hasApprovedListA(documents) || (hasApprovedListB(documents) && hasApprovedListC(documents));
}

export function i9DocumentsFromFirestoreRows(
  rows: Array<{ data: Record<string, unknown> }>,
): I9DocRowLike[] {
  return rows.map((r) => ({
    documentType: String(r.data.documentType || ''),
    status: String(r.data.status || ''),
  }));
}
