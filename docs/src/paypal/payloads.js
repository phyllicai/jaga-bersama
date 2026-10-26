// Request bodies for the PayPal REST APIs used by Jaga Bersama. Shared by the live client and the mock,
// so tests can check the mock against exactly what is sent to PayPal.
import { toValue } from '../money.js';

const CAT_LABEL = { clinic: 'Clinic / doctor', medicine: 'Medicine', home_nurse: 'Home nurse', therapy: 'Therapy', supplies: 'Care supplies', transport: 'Transport', other: 'Other care cost' };

// Invoicing v2: POST /v2/invoicing/invoices
export function invoiceBody({ currency, invoicerName, recipient, lines, note, memo, dueDate, reference, invoiceDate }) {
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return {
    detail: {
      currency_code: currency,
      invoice_date: invoiceDate,
      reference: reference?.slice(0, 120),
      note: note?.slice(0, 4000),
      memo: memo?.slice(0, 500),
      payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: dueDate },
    },
    invoicer: { name: { given_name: invoicerName || 'Family care fund' } },
    primary_recipients: [{ billing_info: { name: { given_name: recipient.name }, email_address: recipient.email } }],
    items: lines.map((l) => ({
      name: (l.name || CAT_LABEL[l.category] || 'Care cost').slice(0, 200),
      description: l.description?.slice(0, 1000),
      quantity: '1',
      unit_amount: { currency_code: currency, value: toValue(l.amount) },
      unit_of_measure: 'AMOUNT',
    })),
    configuration: {
      allow_tip: false,
      tax_inclusive: false,
      // Siblings can pay in instalments; the minimum is 25% of the share.
      partial_payment: { allow_partial_payment: true, minimum_amount_due: { currency_code: currency, value: toValue(Math.max(100, Math.round(total * 0.25))) } },
    },
  };
}

// Orders v2: POST /v2/checkout/orders
export function orderBody({ currency, amount, description, referenceId, customId, returnUrl, cancelUrl, brandName }) {
  return {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: referenceId,
      custom_id: customId,
      description: description?.slice(0, 127),
      amount: { currency_code: currency, value: toValue(amount) },
    }],
    payment_source: { paypal: { experience_context: {
      brand_name: brandName || 'Jaga Bersama care fund', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING',
      return_url: returnUrl, cancel_url: cancelUrl,
    } } },
  };
}

// Payouts v1: POST /v1/payments/payouts
export function payoutBody({ currency, senderBatchId, subject, message, items }) {
  return {
    sender_batch_header: { sender_batch_id: senderBatchId, email_subject: subject, email_message: message },
    items: items.map((it) => ({
      recipient_type: 'EMAIL',
      receiver: it.email,
      amount: { currency: currency, value: toValue(it.amount) },
      note: it.note?.slice(0, 4000),
      sender_item_id: it.senderItemId,
    })),
  };
}
