#!/bin/zsh
set -u

ADB_BIN="${ADB_BIN:-/opt/homebrew/bin/adb}"
SERIAL="${PHONE_GATEWAY_SERIAL:-AH3SCP5213201199}"
PACKAGE="com.superpartybyai.waagentapp"
SERVICE="${PACKAGE}/.PhoneGatewayService"
INTERVAL="${PHONE_GATEWAY_WATCH_INTERVAL_SECONDS:-15}"
LOG_DIR="${HOME}/Library/Logs/SuperPartyPhoneGateway"
LOG_FILE="${LOG_DIR}/watchdog.log"
LAST_STATE=""

mkdir -p "${LOG_DIR}"

log_line() {
  local message="$1"
  printf '%s %s\n' "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')" "${message}" >> "${LOG_FILE}"
}

report_state() {
  local state="$1"
  if [[ "${state}" != "${LAST_STATE}" ]]; then
    log_line "state=${state}"
    LAST_STATE="${state}"
  fi
}

while true; do
  if [[ ! -x "${ADB_BIN}" ]]; then
    report_state "ADB_MISSING"
    /bin/sleep "${INTERVAL}"
    continue
  fi

  DEVICE_STATE="$("${ADB_BIN}" -s "${SERIAL}" get-state 2>/dev/null || true)"
  if [[ "${DEVICE_STATE}" != "device" ]]; then
    report_state "DEVICE_UNAVAILABLE"
    /bin/sleep "${INTERVAL}"
    continue
  fi

  USER_STATE="$("${ADB_BIN}" -s "${SERIAL}" shell dumpsys user 2>/dev/null | /usr/bin/grep -m 1 -E 'State: RUNNING_(UN)?LOCKED' || true)"
  if [[ "${USER_STATE}" != *"RUNNING_UNLOCKED"* ]]; then
    report_state "DEVICE_LOCKED"
    /bin/sleep "${INTERVAL}"
    continue
  fi

  PID="$("${ADB_BIN}" -s "${SERIAL}" shell pidof "${PACKAGE}" 2>/dev/null | /usr/bin/tr -d '\r' || true)"
  SERVICE_DUMP="$("${ADB_BIN}" -s "${SERIAL}" shell dumpsys activity services "${PACKAGE}" 2>/dev/null || true)"

  if [[ -n "${PID}" && "${SERVICE_DUMP}" == *"PhoneGatewayService"* && "${SERVICE_DUMP}" == *"isForeground=true"* ]]; then
    report_state "SERVICE_HEALTHY"
    /bin/sleep "${INTERVAL}"
    continue
  fi

  START_OUTPUT="$("${ADB_BIN}" -s "${SERIAL}" shell run-as "${PACKAGE}" am start-foreground-service --user 0 -n "${SERVICE}" 2>&1 || true)"
  /bin/sleep 3

  PID="$("${ADB_BIN}" -s "${SERIAL}" shell pidof "${PACKAGE}" 2>/dev/null | /usr/bin/tr -d '\r' || true)"
  SERVICE_DUMP="$("${ADB_BIN}" -s "${SERIAL}" shell dumpsys activity services "${PACKAGE}" 2>/dev/null || true)"

  if [[ -n "${PID}" && "${SERVICE_DUMP}" == *"PhoneGatewayService"* && "${SERVICE_DUMP}" == *"isForeground=true"* ]]; then
    log_line "service_recovered pid=${PID}"
    LAST_STATE="SERVICE_HEALTHY"
  else
    SAFE_OUTPUT="${START_OUTPUT//$'\n'/ }"
    log_line "service_recovery_failed output=${SAFE_OUTPUT}"
    LAST_STATE="SERVICE_RECOVERY_FAILED"
  fi

  /bin/sleep "${INTERVAL}"
done
