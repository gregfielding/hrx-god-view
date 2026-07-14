/**
 * Adverse-action notice templates (Migration Plan P3) — the code-versioned
 * counterparts of the counsel-draft letters ("C1 Adverse Action Letter
 * Templates" docx, policy Appendix C). Every send records
 * NOTICE_TEMPLATE_VERSION + stateVariant on the case, so the exact content
 * a candidate received is provable years later.
 *
 * English is always sent; the Spanish letter is appended in the same email
 * when the candidate's preferred language is Spanish (counsel-draft rule:
 * send BOTH languages). State variants: 'ca' (Fair Chance Act inserts),
 * 'pa' (CHRIA notice), 'default'.
 *
 * ⚠️ Wording tracks the counsel-review drafts. When counsel edits the
 * letters, update here AND bump NOTICE_TEMPLATE_VERSION.
 */
import type { NoticeKind } from './adjudicationCases';

export const NOTICE_TEMPLATE_VERSION = 'v1.1-draft-2026-07-13';

export type NoticeStateVariant = 'ca' | 'pa' | 'default';

export interface NoticeFields {
  candidateName: string;
  position: string;
  clientOrWorksite: string;
  /** Human-readable deadline, e.g. "Tuesday, July 21, 2026" (pre-adverse only). */
  responseDeadlineText?: string;
  /** CA letters: the conviction item(s) at issue. */
  convictionList?: string;
  /** CRA contact block — REQUIRED, from tenant integration config. */
  craBlock: string;
  compliancePhone?: string;
}

export function stateVariantForWorksiteState(state: string | null | undefined): NoticeStateVariant {
  const s = String(state ?? '').trim().toUpperCase();
  if (s === 'CA') return 'ca';
  if (s === 'PA') return 'pa';
  return 'default';
}

const COMPLIANCE_EMAIL = 'compliance@c1staffing.com';

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function p(text: string): string {
  return `<p style="margin:0 0 12px;line-height:1.55">${text}</p>`;
}
function variant(text: string): string {
  return `<p style="margin:0 0 12px;line-height:1.55;padding:10px 14px;background:#f6efde;border-left:3px solid #8f6412">${text}</p>`;
}

interface LetterBody {
  subjectEn: string;
  htmlEn: string;
  htmlEs: string;
}

function contactLine(f: NoticeFields): string {
  return `${COMPLIANCE_EMAIL}${f.compliancePhone ? ` or ${esc(f.compliancePhone)}` : ''}`;
}

function craBlockHtml(f: NoticeFields): string {
  return `<p style="margin:0 0 12px;line-height:1.5;padding:8px 14px;border:1px solid #d9ddda">${esc(f.craBlock).replace(/\n/g, '<br/>')}</p>`;
}

function preAdverse(f: NoticeFields, sv: NoticeStateVariant): LetterBody {
  const deadline = esc(f.responseDeadlineText ?? '');
  const htmlEn = [
    p(`Dear ${esc(f.candidateName)},`),
    p(`Thank you for your interest in the ${esc(f.position)} assignment with ${esc(f.clientOrWorksite)} through C1 Staffing. As part of our review, we received a consumer report about you from the consumer reporting agency identified below.`),
    p(`Information in that report may affect our decision about your assignment. <strong>No final decision has been made</strong>, and we want to hear from you before we make one.`),
    sv === 'ca' && f.convictionList
      ? variant(`Our preliminary decision is based on the following conviction history item(s): ${esc(f.convictionList)}. Under the California Fair Chance Act, you have the right to respond before this decision becomes final, including by submitting evidence challenging the accuracy of the conviction history and/or evidence of rehabilitation or mitigating circumstances. If you notify us within this period that you dispute the accuracy of the report and are obtaining evidence, you will have 5 additional business days to respond.`)
      : '',
    sv === 'pa'
      ? variant(`This notice is also provided in accordance with the Pennsylvania Criminal History Record Information Act (18 Pa. C.S. § 9125): information in your criminal history record may be considered only to the extent it relates to your suitability for this specific position, and we will notify you in writing if such information contributes to a final adverse decision.`)
      : '',
    p(`Attached to this email you will find: (1) a complete copy of your consumer report, and (2) "A Summary of Your Rights Under the Fair Credit Reporting Act" (English and Spanish).`),
    p(`If any information in the report is inaccurate or incomplete, or if you would like to provide additional context — including facts about the circumstances, evidence of rehabilitation (such as education, training, treatment, or steady employment), or references — please respond by <strong>${deadline}</strong> to ${contactLine(f)}. We will consider everything you send before making a decision. If you tell us you are gathering evidence that the report is inaccurate, we will extend your response window.`),
    p(`Consumer reporting agency that provided the report (the agency did not make any decision and cannot tell you why a decision may be made):`),
    craBlockHtml(f),
  ].filter(Boolean).join('');

  const htmlEs = [
    p(`Estimado/a ${esc(f.candidateName)}:`),
    p(`Gracias por su interés en la asignación de ${esc(f.position)} con ${esc(f.clientOrWorksite)} a través de C1 Staffing. Como parte de nuestra revisión, recibimos un informe del consumidor sobre usted de la agencia identificada abajo.`),
    p(`La información de ese informe podría afectar nuestra decisión sobre su asignación. <strong>No se ha tomado ninguna decisión final</strong>, y queremos escucharle antes de tomarla.`),
    sv === 'ca' && f.convictionList
      ? variant(`Nuestra decisión preliminar se basa en el/los siguiente(s) antecedente(s) de condena: ${esc(f.convictionList)}. Bajo la Ley de Oportunidad Justa de California, usted tiene derecho a responder antes de que esta decisión sea final, incluyendo presentar evidencia que cuestione la exactitud del historial y/o evidencia de rehabilitación o circunstancias atenuantes. Si dentro de ese plazo nos notifica que disputa la exactitud del informe y está obteniendo evidencia, tendrá 5 días hábiles adicionales para responder.`)
      : '',
    sv === 'pa'
      ? variant(`Este aviso también se proporciona conforme a la Ley de Información de Antecedentes Penales de Pennsylvania (CHRIA, 18 Pa. C.S. § 9125): la información de sus antecedentes penales solo puede considerarse en la medida en que se relacione con su idoneidad para este puesto específico, y le notificaremos por escrito si dicha información contribuye a una decisión adversa final.`)
      : '',
    p(`Adjunto encontrará: (1) una copia completa de su informe del consumidor, y (2) "Un Resumen de Sus Derechos Bajo la Ley de Informes de Crédito Justos (FCRA)" (inglés y español).`),
    p(`Si alguna información del informe es inexacta o está incompleta, o si desea proporcionar contexto adicional — incluyendo los hechos y circunstancias, evidencia de rehabilitación o referencias — por favor responda antes del <strong>${deadline}</strong> a ${contactLine(f)}. Consideraremos todo lo que envíe antes de tomar una decisión.`),
    p(`Agencia de informes del consumidor que proporcionó el informe (la agencia no tomó ninguna decisión y no puede explicarle por qué se tomaría una decisión):`),
    craBlockHtml(f),
  ].filter(Boolean).join('');

  return {
    subjectEn: 'Important information about your assignment application — no final decision has been made',
    htmlEn,
    htmlEs,
  };
}

function finalAdverse(f: NoticeFields, sv: NoticeStateVariant): LetterBody {
  const htmlEn = [
    p(`Dear ${esc(f.candidateName)},`),
    p(`We previously sent you a copy of your consumer report and a notice that information in it might affect our decision regarding the ${esc(f.position)} assignment with ${esc(f.clientOrWorksite)}. We have completed our review, including any information you provided.`),
    p(`After careful consideration, we are unable to move forward with this assignment. This decision was based in whole or in part on information contained in the consumer report provided by the agency below.`),
    sv === 'ca' && f.convictionList
      ? variant(`Our final decision is based on the following conviction history item(s): ${esc(f.convictionList)}. We considered the information you submitted, if any, before making this decision. You have the right to file a complaint with the California Civil Rights Department (CRD) at calcivilrights.ca.gov or (800) 884-1684.`)
      : '',
    sv === 'pa'
      ? variant(`In accordance with the Pennsylvania Criminal History Record Information Act (18 Pa. C.S. § 9125), we are notifying you in writing that information from your criminal history record contributed in part to this decision.`)
      : '',
    p(`The consumer reporting agency did not make this decision and cannot explain why it was made:`),
    craBlockHtml(f),
    p(`You have the right to obtain a free additional copy of your report from the agency above within 60 days of this notice, and the right to dispute directly with the agency the accuracy or completeness of any information in the report.`),
    p(`This decision applies to this assignment's requirements. You may remain eligible for other opportunities with C1 Staffing, and we encourage you to continue applying.`),
  ].filter(Boolean).join('');

  const htmlEs = [
    p(`Estimado/a ${esc(f.candidateName)}:`),
    p(`Anteriormente le enviamos una copia de su informe del consumidor y un aviso de que la información contenida en él podría afectar nuestra decisión sobre la asignación de ${esc(f.position)} con ${esc(f.clientOrWorksite)}. Hemos completado nuestra revisión, incluyendo cualquier información que usted proporcionó.`),
    p(`Después de una consideración cuidadosa, no podemos continuar con esta asignación. Esta decisión se basó, en su totalidad o en parte, en información contenida en el informe del consumidor proporcionado por la agencia indicada abajo.`),
    sv === 'ca' && f.convictionList
      ? variant(`Nuestra decisión final se basa en el/los siguiente(s) antecedente(s) de condena: ${esc(f.convictionList)}. Consideramos la información que usted presentó, si la hubo, antes de tomar esta decisión. Usted tiene derecho a presentar una queja ante el Departamento de Derechos Civiles de California (CRD) en calcivilrights.ca.gov o al (800) 884-1684.`)
      : '',
    sv === 'pa'
      ? variant(`Conforme a la Ley de Información de Antecedentes Penales de Pennsylvania (CHRIA, 18 Pa. C.S. § 9125), le notificamos por escrito que la información de sus antecedentes penales contribuyó en parte a esta decisión.`)
      : '',
    p(`La agencia de informes del consumidor no tomó esta decisión y no puede explicar por qué se tomó:`),
    craBlockHtml(f),
    p(`Usted tiene derecho a obtener una copia adicional gratuita de su informe de la agencia indicada arriba dentro de los 60 días posteriores a este aviso, y a disputar directamente con la agencia la exactitud o integridad de cualquier información del informe.`),
    p(`Esta decisión aplica a los requisitos de esta asignación. Usted puede seguir siendo elegible para otras oportunidades con C1 Staffing.`),
  ].filter(Boolean).join('');

  return { subjectEn: 'Decision regarding your assignment application', htmlEn, htmlEs };
}

function disputeAck(f: NoticeFields): LetterBody {
  const htmlEn = [
    p(`Dear ${esc(f.candidateName)},`),
    p(`We received your notice disputing the accuracy of information in your consumer report. We have paused our review, and no decision will be made while your dispute is open.`),
    p(`The consumer reporting agency is reinvestigating the disputed information. When the reinvestigation completes, we will send you the resulting report and a new response window before our review resumes.`),
    p(`If you have documents supporting your dispute, you may also send them to ${contactLine(f)} and we will include them in your file.`),
  ].join('');
  const htmlEs = [
    p(`Estimado/a ${esc(f.candidateName)}:`),
    p(`Recibimos su aviso disputando la exactitud de la información de su informe del consumidor. Hemos pausado nuestra revisión, y no se tomará ninguna decisión mientras su disputa esté abierta.`),
    p(`La agencia de informes del consumidor está reinvestigando la información disputada. Cuando la reinvestigación termine, le enviaremos el informe resultante y un nuevo plazo de respuesta antes de reanudar nuestra revisión.`),
    p(`Si tiene documentos que respalden su disputa, también puede enviarlos a ${contactLine(f)} y los incluiremos en su expediente.`),
  ].join('');
  return { subjectEn: 'We received your dispute — review is paused', htmlEn, htmlEs };
}

export function buildAdjudicationNoticeEmail(params: {
  kind: NoticeKind;
  stateVariant: NoticeStateVariant;
  fields: NoticeFields;
  includeSpanish: boolean;
}): { subject: string; htmlBody: string; textBody: string } {
  const { kind, stateVariant, fields, includeSpanish } = params;
  const body =
    kind === 'pre_adverse'
      ? preAdverse(fields, stateVariant)
      : kind === 'final_adverse'
        ? finalAdverse(fields, stateVariant)
        : disputeAck(fields);

  const signature = p(
    `Sincerely,<br/><strong>Donna Persson</strong><br/>Compliance, C1 Staffing<br/>${COMPLIANCE_EMAIL}${fields.compliancePhone ? ` · ${esc(fields.compliancePhone)}` : ''}`,
  );
  const divider = `<hr style="border:0;border-top:1px solid #d9ddda;margin:20px 0"/>`;
  const esHeader = `<p style="margin:0 0 12px;font-weight:bold">— Español —</p>`;

  const htmlBody = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#20262c;max-width:640px">${
    body.htmlEn
  }${signature}${includeSpanish ? `${divider}${esHeader}${body.htmlEs}${signature}` : ''}</div>`;

  const textBody = htmlBody
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();

  return { subject: body.subjectEn, htmlBody, textBody };
}

/** The only SMS ever permitted about a background check (policy/migration
 *  plan guardrail): a content-free nudge to check email. */
export function buildNoticeNudgeSms(email: string, deadlineText: string | null, es: boolean): string {
  if (es) {
    return `C1 Staffing: le enviamos un correo importante sobre su solicitud a ${email}.${deadlineText ? ` Por favor revise y responda antes del ${deadlineText}.` : ' Por favor revíselo.'}`;
  }
  return `C1 Staffing: we sent an important email about your application to ${email}.${deadlineText ? ` Please review and respond by ${deadlineText}.` : ' Please review it.'}`;
}
