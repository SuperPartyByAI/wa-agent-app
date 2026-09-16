#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
RUNTIME_DIR="${HOME}/Library/Application Support/SuperPartyPhoneGateway"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
LABEL="com.superpartybyai.phone-gateway-watchdog"
PLIST_PATH="${LAUNCH_AGENTS_DIR}/${LABEL}.plist"
DOMAIN="gui/${UID}"

/bin/mkdir -p "${RUNTIME_DIR}" "${LAUNCH_AGENTS_DIR}" "${HOME}/Library/Logs/SuperPartyPhoneGateway"
/usr/bin/install -m 0755 "${SCRIPT_DIR}/phone_gateway_watchdog.sh" "${RUNTIME_DIR}/phone_gateway_watchdog.sh"
/usr/bin/sed "s|__HOME__|${HOME}|g" "${SCRIPT_DIR}/com.superpartybyai.phone-gateway-watchdog.plist" > "${PLIST_PATH}"
/usr/bin/plutil -lint "${PLIST_PATH}"

/bin/launchctl bootout "${DOMAIN}" "${PLIST_PATH}" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "${DOMAIN}" "${PLIST_PATH}"
/bin/launchctl enable "${DOMAIN}/${LABEL}"
/bin/launchctl kickstart -k "${DOMAIN}/${LABEL}"

/bin/sleep 3
/bin/launchctl print "${DOMAIN}/${LABEL}" | /usr/bin/sed -n '1,80p'
