/**
 * Phone-change recovery — staff approval actions (Slice 3, 2026-08-25).
 *
 * Workers whose number changed file `phone_change_requests` from the sign-in
 * screen (checkOtp's phoneChange leg: new number OTP-verified, account claimed
 * by name + DOB — see twilio.ts resolvePhoneChange). Staff review them at
 * /users/phone-changes and approve or reject here. Approval moves the phone
 * onto the chosen account (users doc + Auth user), keeps the old number in
 * `previousPhones`, audits to `phone_signin_audit`, and texts the worker on
 * the new number. Hosted on workerSupportAssistant — Cloud Run function cap,
 * no new callables.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { HttpsError } from 'firebase-functions/v2/https';
import { isStaff } from './payroll/payrollTicketsCore';
import { sendWorkerMessageInternal } from './twilio';

const db = admin.firestore();
const TENANT_C1 = 'BCiP2bQ9CgVOCTfV6MhD';

export async function approvePhoneChange(input: {
  actorUid: string;
  requestId: string;
  uid: string;
}): Promise<{ success: true; uid: string; newPhoneE164: string }> {
  if (!(await isStaff(input.actorUid))) throw new HttpsError('permission-denied', 'Not allowed.');

  const reqRef = db.collection('phone_change_requests').doc(input.requestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) throw new HttpsError('not-found', 'Request not found.');
  const r = reqSnap.data() as Record<string, any>;
  if (r.status !== 'pending') throw new HttpsError('failed-precondition', 'Request was already processed.');
  if (!Array.isArray(r.candidateUids) || !r.candidateUids.includes(input.uid)) {
    throw new HttpsError('invalid-argument', 'That account is not a candidate on this request.');
  }

  const newPhoneE164 = String(r.newPhoneE164 || '');
  if (!/^\+[1-9]\d{7,14}$/.test(newPhoneE164)) throw new HttpsError('failed-precondition', 'Request has no valid phone.');
  const newTen = newPhoneE164.replace(/\D/g, '').slice(-10);

  const userRef = db.doc(`users/${input.uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'Worker account not found.');
  const u = userSnap.data() as Record<string, any>;
  const oldPhoneE164 = String(u.phoneE164 || '') || null;

  // Move the number in Auth. Two recoverable snags: a throwaway Auth user
  // (no users doc) already holding the number, and a users doc whose Auth
  // user was never minted (legacy migrants sign in via custom token, which
  // creates the Auth user lazily).
  try {
    await admin.auth().updateUser(input.uid, { phoneNumber: newPhoneE164 });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code ?? '';
    if (code === 'auth/phone-number-already-exists') {
      const holder = await admin.auth().getUserByPhoneNumber(newPhoneE164);
      if (holder.uid !== input.uid) {
        const holderDoc = await db.doc(`users/${holder.uid}`).get();
        if (holderDoc.exists) {
          throw new HttpsError(
            'failed-precondition',
            `Another account (${holder.uid}) already uses this number in Auth — resolve that account first.`,
          );
        }
        await admin.auth().updateUser(holder.uid, { phoneNumber: undefined as unknown as string });
        await admin.auth().updateUser(input.uid, { phoneNumber: newPhoneE164 });
      }
    } else if (code === 'auth/user-not-found') {
      await admin.auth().createUser({ uid: input.uid, phoneNumber: newPhoneE164 });
    } else {
      logger.error('phone_change_approve auth update failed', { code, uid: input.uid });
      throw new HttpsError('internal', 'Could not update the sign-in phone. Try again.');
    }
  }

  await userRef.set(
    {
      phone: newTen,
      phoneE164: newPhoneE164,
      phoneVerified: true,
      phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(oldPhoneE164 && oldPhoneE164 !== newPhoneE164
        ? { previousPhones: admin.firestore.FieldValue.arrayUnion(oldPhoneE164) }
        : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await reqRef.set(
    {
      status: 'approved',
      approvedUid: input.uid,
      processedBy: input.actorUid,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await db.collection('phone_signin_audit').add({
    uid: input.uid,
    phoneE164: newPhoneE164,
    oldPhoneE164,
    mode: 'phone_change_approved',
    by: input.actorUid,
    requestId: input.requestId,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });

  const lang = String(u.preferredLanguage || 'en') === 'es' ? 'es' : 'en';
  const body =
    lang === 'es'
      ? 'C1 Staffing: tu número fue actualizado. Ya puedes iniciar sesión con este teléfono en hrxone.com/login.'
      : 'C1 Staffing: your sign-in number was updated. You can now sign in with this phone at hrxone.com/login.';
  await sendWorkerMessageInternal(newPhoneE164, body, {
    systemContext: true,
    source: 'phone_change_approved',
    sourceId: input.requestId,
    tenantId: TENANT_C1,
    userId: input.uid,
  }).catch((e) => logger.warn('phone_change approval SMS failed', { error: String(e) }));

  logger.info('phone change approved', { requestId: input.requestId, uid: input.uid, by: input.actorUid });
  return { success: true, uid: input.uid, newPhoneE164 };
}

export async function rejectPhoneChange(input: {
  actorUid: string;
  requestId: string;
  note?: string;
}): Promise<{ success: true }> {
  if (!(await isStaff(input.actorUid))) throw new HttpsError('permission-denied', 'Not allowed.');
  const reqRef = db.collection('phone_change_requests').doc(input.requestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) throw new HttpsError('not-found', 'Request not found.');
  if ((reqSnap.data() as Record<string, unknown>).status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Request was already processed.');
  }
  await reqRef.set(
    {
      status: 'rejected',
      note: String(input.note || '').trim().slice(0, 500) || null,
      processedBy: input.actorUid,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await db.collection('phone_signin_audit').add({
    phoneE164: String((reqSnap.data() as Record<string, unknown>).newPhoneE164 || ''),
    mode: 'phone_change_rejected',
    by: input.actorUid,
    requestId: input.requestId,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  logger.info('phone change rejected', { requestId: input.requestId, by: input.actorUid });
  return { success: true };
}
