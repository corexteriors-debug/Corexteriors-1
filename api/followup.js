const { kv } = require('@vercel/kv');
const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Auth check
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'No token provided' });

        const tokenData = await kv.get(`token:${token}`);
        if (!tokenData) return res.status(401).json({ error: 'Invalid token' });
        if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

        // Check Gmail config
        const gmailUser = process.env.GMAIL_USER;
        const gmailPass = process.env.GMAIL_APP_PASSWORD;
        if (!gmailUser || !gmailPass) {
            return res.status(500).json({ success: false, error: 'Gmail not configured' });
        }

        // Get all leads
        const leadIds = (await kv.get('lead_ids')) || [];
        const leads = [];
        for (const id of leadIds) {
            const lead = await kv.get(`lead:${id}`);
            if (lead) leads.push(lead);
        }

        // Find stale leads (3+ days old, status New or Quoted, has email)
        const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
        const staleLeads = leads.filter(l => {
            const created = new Date(l.createdAt).getTime();
            return (l.status === 'New' || l.status === 'Quoted')
                && created < threeDaysAgo
                && l.email;
        });

        if (staleLeads.length === 0) {
            return res.status(200).json({ success: true, count: 0, message: 'No leads need follow-up' });
        }

        // Setup transporter
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmailUser, pass: gmailPass }
        });

        let sentCount = 0;

        for (const lead of staleLeads) {
            try {
                const daysSince = Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000);

                await transporter.sendMail({
                    from: `"Core Exteriors" <${gmailUser}>`,
                    to: lead.email,
                    subject: `Following Up on Your Estimate — Core Exteriors`,
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:30px;background:#f8f9fa;border-radius:12px">
                            <div style="text-align:center;margin-bottom:25px">
                                <h1 style="color:#1a2a4a;font-size:24px;margin:0">Core Exteriors</h1>
                                <p style="color:#888;font-size:14px">Professional Exterior Services</p>
                            </div>
                            <div style="background:#fff;padding:25px;border-radius:10px;border:1px solid #e0e0e0">
                                <h2 style="color:#1a2a4a;font-size:18px;margin-top:0">Hi ${lead.clientName},</h2>
                                <p style="color:#555;line-height:1.6">We hope you're doing well! We wanted to follow up on the estimate we provided ${daysSince} day${daysSince > 1 ? 's' : ''} ago for <strong>${lead.serviceType || 'your project'}</strong>.</p>
                                <p style="color:#555;line-height:1.6">We'd love to help you get started and make sure you're completely satisfied. If you have any questions about the estimate or would like to discuss any changes, we're here for you!</p>
                                <p style="color:#555;line-height:1.6">Feel free to reach us anytime:</p>
                                <ul style="color:#555;line-height:1.8;list-style:none;padding:0">
                                    <li>📞 <strong>(606) 616 2026</strong></li>
                                    <li>📧 <strong>corexteriors@gmail.com</strong></li>
                                </ul>
                                <p style="color:#555;line-height:1.6">Looking forward to hearing from you!</p>
                                <p style="color:#1a2a4a;font-weight:600;margin-bottom:0">— The Core Exteriors Team</p>
                            </div>
                            <p style="text-align:center;color:#aaa;font-size:12px;margin-top:20px">Core Exteriors · London, Ontario</p>
                        </div>
                    `
                });

                // Mark lead as follow-up sent
                lead.lastFollowUp = new Date().toISOString();
                lead.followUpCount = (lead.followUpCount || 0) + 1;
                await kv.set(`lead:${lead.id}`, lead);

                sentCount++;
            } catch (emailErr) {
                console.error(`Follow-up email failed for ${lead.email}:`, emailErr);
            }
        }

        return res.status(200).json({
            success: true,
            count: sentCount,
            message: `Sent ${sentCount} follow-up email(s)`
        });

    } catch (error) {
        console.error('Follow-up API error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
