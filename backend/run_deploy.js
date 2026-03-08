const { Client } = require('ssh2');
const fs = require('fs');

const b64_script = fs.readFileSync(__dirname + '/deploy_b64.sh', 'utf8');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH Client :: ready');
  conn.exec('echo "' + Buffer.from(b64_script).toString('base64') + '" | base64 -d > /tmp/install.sh && chmod +x /tmp/install.sh && /tmp/install.sh', (err, stream) => {
    if (err) throw err;
    stream.on('close', (code, signal) => {
      console.log('\nStream :: close :: code: ' + code + ', signal: ' + signal);
      conn.end();
    }).on('data', (data) => {
      process.stdout.write(data);
    }).stderr.on('data', (data) => {
      process.stderr.write(data);
    });
  });
}).on('error', (err) => {
  console.error("SSH Connection Error: ", err);
}).connect({
  host: '91.98.16.90',
  port: 22,
  username: 'root',
  password: '9vAxpqRLv7bF',
  readyTimeout: 20000
});
