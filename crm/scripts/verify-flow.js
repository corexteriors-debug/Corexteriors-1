const http = require('http');

const lead = JSON.stringify({
    name: 'Verification Bot',
    phone: '555-000-9999',
    email: 'bot@verification.com',
    address: '100 Test Plaza, Commercial District',
    service: 'Commercial Window Cleaning',
    source: 'Internal Verification',
    client_type: 'Commercial',
    message: 'This is an automated verification test.'
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/leads',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': lead.length
    }
};

const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('✅ API Response: Success');
            console.log('Body:', data);
        } else {
            console.error('❌ API Error:', data);
            process.exit(1);
        }
    });
});

req.on('error', (error) => {
    console.error('Request Failed:', error.message);
    process.exit(1);
});

req.write(lead);
req.end();
