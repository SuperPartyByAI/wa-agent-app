#!/bin/bash
set -e

echo '==================== WAITING FOR APT LOCKS ===================='
while fuser /var/lib/dpkg/lock >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
    echo "Waiting for apt lock..."
    sleep 5
done

echo '==================== INSTALLING DEPS ===================='
apt-get update
# Prevent interactive dialogs during apt-get
export DEBIAN_FRONTEND=noninteractive
apt-get install -y curl dirmngr apt-transport-https lsb-release ca-certificates git gnupg g++ make jq
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
apt-get install -y chromium-browser chromium libxss1 libnss3 libgconf-2-4 libasound2
npm install -g pm2

echo '==================== CLONING OPEN-WQ ===================='
git clone https://github.com/SuperPartyByAI/open-wq.git /root/open-wq
cd /root/open-wq
npm install

echo '==================== STARTING APP ===================='
pm2 start index.js --name 'open-wa'
pm2 save
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root | tail -n 1 > /tmp/pm2_setup.sh
bash /tmp/pm2_setup.sh
pm2 status
echo "DEPLOYMENT FINISHED SUCCESSFULLY."
