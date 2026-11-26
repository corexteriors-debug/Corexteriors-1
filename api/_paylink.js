// Branded Stripe pay links: corexteriors.ca/pay/<code>
//
// A pay link is a KV record (paylink:<code>), not a Stripe object, so it never expires.
// Each time the client presses "Pay by card" we open a fresh Stripe Checkout session
// for it, and the webhook marks the link paid. The routes live in api/payment.js
// (the Hobby plan caps us at 12 functions); this file is a shared helper, not a route.

const crypto = require('crypto');
const Stripe = require('stripe');

const SITE = 'https://corexteriors.ca';
const CARD_FEE_RATE = 0.05;
const TYPES = ['deposit', 'balance', 'full'];
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i

const key = (code) => `paylink:${code}`;
const cents = (n) => Math.round(Number(n) * 100);
const clip = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function newCode() {
    let out = '';
    for (const b of crypto.randomBytes(12)) out += ALPHABET[b % ALPHABET.length];
    return out;
}

function validCode(code) {
    return /^[a-z2-9]{8,16}$/.test(String(code || ''));
}

function stripeClient() {
    const k = (process.env.STRIPE_SECRET_KEY || '').trim();
    if (!k) throw Object.assign(new Error('Stripe not configured.'), { status: 500 });
    return new Stripe(k);
}

function feeFor(amountCents) {
    return Math.round(amountCents * CARD_FEE_RATE);
}

async function createPayLink(kv, input, createdBy) {
    const amountCents = cents(input.amount);
    if (!Number.isFinite(amountCents) || amountCents < 50) {
        throw Object.assign(new Error('Amount must be at least $0.50.'), { status: 400 });
    }
    const email = clip(input.clientEmail || input.email, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw Object.assign(new Error('A valid client email is required.'), { status: 400 });
    }
    const type = TYPES.includes(input.type || input.paymentType) ? (input.type || input.paymentType) : 'full';
    let code = newCode();
    while (await kv.get(key(code))) code = newCode();
    const link = {
        code,
        status: 'open',
        type,
        amountCents,
        feeCents: input.noFee === true ? 0 : feeFor(amountCents), // noFee: Luke waived the card fee for this client
        clientName: clip(input.clientName, 120),
        email,
        description: clip(input.description, 300) || 'Exterior services',
        estimateNumber: clip(input.estimateNumber, 40),
        leadId: clip(input.leadId, 80),
        crmRef: clip(input.crmRef, 80),
        createdBy: clip(createdBy, 80),
        createdAt: new Date().toISOString(),
    };
    await kv.set(key(code), link);
    return { code, url: `${SITE}/pay/${code}`, link };
}

// What the public pay page may see: first name only, no email.
function publicView(link) {
    return {
        code: link.code,
        status: link.status,
        type: link.type,
        firstName: (link.clientName || '').split(/\s+/)[0] || '',
        description: link.description,
        estimateNumber: link.estimateNumber,
        amount: link.amountCents / 100,
        fee: link.feeCents / 100,
        total: (link.amountCents + link.feeCents) / 100,
        paidAt: link.paidAt || null,
        amountPaid: link.amountPaidCents != null ? link.amountPaidCents / 100 : null,
    };
}

async function getLink(kv, code) {
    if (!validCode(code)) return null;
    return kv.get(key(code));
}

const LABEL = { deposit: 'Deposit', balance: 'Balance', full: 'Payment' };

async function startCheckout(kv, code) {
    const link = await getLink(kv, code);
    if (!link) throw Object.assign(new Error('This payment link was not found.'), { status: 404 });
    if (link.status === 'paid') throw Object.assign(new Error('This has already been paid. Thank you!'), { status: 409 });
    if (link.status !== 'open') throw Object.assign(new Error('This payment link is no longer active. Call 519-712-1431.'), { status: 410 });

    const stripe = stripeClient();
    // One live checkout per link, so two open tabs can't both be paid.
    if (link.sessionId) {
        try {
            const prev = await stripe.checkout.sessions.retrieve(link.sessionId);
            if (prev.status === 'complete') throw Object.assign(new Error('This has already been paid. Thank you!'), { status: 409 });
            if (prev.status === 'open') await stripe.checkout.sessions.expire(link.sessionId);
        } catch (err) {
            if (err.status === 409) throw err;
        }
    }

    const ref = link.estimateNumber ? ` (${link.estimateNumber})` : '';
    const metadata = {
        payCode: link.code,
        leadId: link.leadId || '',
        crmRef: link.crmRef || '',
        estimateNumber: link.estimateNumber || '',
        clientName: link.clientName || '',
        paymentType: link.type,
    };
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'], // Apple Pay / Google Pay show here too when on in the dashboard
        customer_email: link.email,
        customer_creation: 'always',
        client_reference_id: link.code,
        line_items: [
            {
                price_data: {
                    currency: 'cad',
                    product_data: { name: `${LABEL[link.type]} — Core Exteriors${ref}`, description: link.description },
                    unit_amount: link.amountCents,
                },
                quantity: 1,
            },
            ...(link.feeCents > 0 ? [{
                price_data: {
                    currency: 'cad',
                    product_data: { name: 'Card processing fee (5%)', description: 'Applies to card payments only' },
                    unit_amount: link.feeCents,
                },
                quantity: 1,
            }] : []),
        ],
        payment_intent_data: {
            description: `Core Exteriors ${LABEL[link.type].toLowerCase()}${ref} — ${link.clientName || link.email}`,
            receipt_email: link.email,
            metadata,
        },
        metadata,
        success_url: `${SITE}/pay/${link.code}?paid=1`,
        cancel_url: `${SITE}/pay/${link.code}`,
    });
    link.sessionId = session.id;
    link.lastCheckoutAt = new Date().toISOString();
    await kv.set(key(link.code), link);
    return session.url;
}

// Called by the webhook on checkout.session.completed. Returns the updated link, or null.
async function markPaid(kv, session) {
    const code = session.metadata?.payCode || session.client_reference_id;
    if (!validCode(code)) return null;
    const link = await kv.get(key(code));
    if (!link) return null;
    if (session.payment_status !== 'paid') return null;
    link.status = 'paid';
    link.paidAt = new Date().toISOString();
    link.amountPaidCents = session.amount_total;
    link.sessionId = session.id;
    link.paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || '';
    await kv.set(key(code), link);
    return link;
}

async function voidLink(kv, code) {
    const link = await getLink(kv, code);
    if (!link) return null;
    if (link.status === 'paid') return link;
    link.status = 'void';
    link.voidedAt = new Date().toISOString();
    await kv.set(key(code), link);
    return link;
}

module.exports = { createPayLink, publicView, getLink, startCheckout, markPaid, voidLink, validCode, feeFor, CARD_FEE_RATE };
