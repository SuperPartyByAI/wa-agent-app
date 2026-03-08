#!/bin/bash
export DEBIAN_FRONTEND=noninteractive

echo "=== System Update ==="
apt-get update && apt-get install -y curl git ufw nginx certbot python3-certbot-nginx

echo "=== Securing Firewall ==="
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw allow 4000
echo "y" | ufw enable

echo "=== Node 20 & PM2 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2
pm2 install pm2-logrotate || true
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 10
pm2 set pm2-logrotate:compress true

echo "=== Cloning Repo ==="
mkdir -p /opt/superparty-backend
cd /opt/superparty-backend
if [ ! -d "/opt/superparty-backend/wa-agent-app" ]; then
    git clone https://github.com/SuperPartyByAI/wa-agent-app.git
else
    cd wa-agent-app
    git reset --hard
    git pull origin main
    cd ..
fi

echo "=== NPM Install ==="
cd /opt/superparty-backend/wa-agent-app/backend
npm install

echo "=== ENV Configuration ==="
cat << 'ENVFILE' > .env
PORT=3000
API_KEY=SUPERPARTY_SECURE_TOKEN_2026
SUPABASE_URL=https://jrfhprnuxxfwkwjwdsez.supabase.co
SUPABASE_SERVICE_ROLE_KEY=PASTE_SERVICE_ROLE_KEY_HERE
ENVFILE

echo "=== PM2 Deployment ==="
pm2 start index.js --name "wa-api" || pm2 restart "wa-api"
pm2 start ai-worker.js --name "ai-worker" || pm2 restart "ai-worker"
pm2 save
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root || true
pm2 resurrect || true

echo "=== NGINX Setup ==="
cat << 'NGINX_CONF' > /etc/nginx/sites-available/wa-api
server {
    listen 80;
    server_name 91.98.16.90.nip.io;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    location /ai-admin/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX_CONF

ln -sf /etc/nginx/sites-available/wa-api /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
systemctl restart nginx

echo "=== SSL Generation ==="
certbot --nginx -d 91.98.16.90.nip.io --non-interactive --agree-tos --register-unsafely-without-email

echo "✓ Deployment Complete!"
pm2 status
