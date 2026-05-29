const fs = require('fs');
const http = require('http');
const jwt = require('jsonwebtoken');

const LOCAL_JWT_SECRET = 'fb00f0d337eaba80ce2334455bf11557d2fe8806054cdf2284914e453e1f0b0a2dd45513d7be5a033c7c7e6ed372c511';
const token = jwt.sign({ sub: 'admin', email: 'admin@serverdash.local' }, LOCAL_JWT_SECRET, { algorithm: 'HS256' });

const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
let body = '';

const addField = (name, value) => {
  body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
};

addField('name', 'testproject-limits');
addField('dbPassword', 'testpassword123');
addField('dashPassword', 'testdashpass123');

body += `--${boundary}--\r\n`;

const req = http.request({
  hostname: 'localhost',
  port: 4001,
  path: '/api/supabase/create-stream',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': Buffer.byteLength(body)
  }
}, (res) => {
  res.on('data', (d) => process.stdout.write(d));
});

req.on('error', (e) => console.error(e));
req.write(body);
req.end();
