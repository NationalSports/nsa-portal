const FALLBACK_ERROR = 'Topstar email was not accepted by the mail provider';

export const topstarPoMatches = (candidate, target) => (
  target?.id ? candidate?.id === target.id : candidate?.po_id === target?.po_id
);

// The portal's Illustrator uploads are PDF-compatible but retain an .ai URL. Give Brevo the
// payload's actual file type; providers commonly reject .ai attachment names even when their
// bytes are a PDF. Topstar still receives the original artwork bytes.
export const topstarAttachmentName = (url, decoType, index) => {
  const rawExtension = String(url || '').split('?')[0].split('.').pop().toLowerCase();
  const extension = rawExtension === 'ai' ? 'pdf' : (rawExtension || 'png');
  return `${decoType || 'art'}-${index + 1}.${extension}`;
};

export const markTopstarEmailSent = (po, result, at = new Date().toISOString()) => ({
  ...po,
  status: 'waiting',
  topstar_sent_at: at,
  topstar_message_id: result?.messageId || null,
  topstar_send_error: null,
  topstar_send_failed_at: null,
});

export const markTopstarEmailFailed = (po, error, at = new Date().toISOString()) => ({
  ...po,
  status: 'email_failed',
  topstar_send_error: String(error || FALLBACK_ERROR),
  topstar_send_failed_at: at,
});
