const { kv } = require('@vercel/kv');
const Stripe = require('stripe');

// Disable body parsing so we can verify Stripe signature
module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
    const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

    if (!stripeKey || !webhookSecret) {
        console.error('Stripe webhook: missing env vars');
        return res.status(500).end();
    }

    const stripe = new Stripe(stripeKey);

    // Read raw body for signature verification
    const buf = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });

    let event;
    try {
        event = stripe.webhooks.constructEvent(buf, req.headers['stripe-signature'], webhookSecret);
    } catch (err) {
        console.error('Stripe webhook signature error:', err.message);
        return res.status(400).json({ error: 'Webhook signature failed' });
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const leadId = session.metadata?.leadId;
        const amountPaid = session.amount_total ? session.amount_total / 100 : null;
        const paymentType = session.metadata?.paymentType || 'full';

        if (leadId) {
            try {
                const lead = await kv.get(`lead:${leadId}`);
                if (lead) {
                    lead.paymentStatus = paymentType === 'deposit' ? 'Deposit' : 'Paid';
                    lead.paymentMethod = 'Credit Card';
                    if (amountPaid !== null) lead.paymentAmount = amountPaid;
                    lead.stripeSessionId = session.id;
                    lead.updatedAt = new Date().toISOString();
                    await kv.set(`lead:${leadId}`, lead);
                    console.log(`Lead ${leadId} payment updated to ${lead.paymentStatus} ($${amountPaid})`);
                }
            } catch (err) {
                console.error('Stripe webhook KV update error:', err);
            }
        }
    }

    return res.status(200).json({ received: true });
};
