// monitor_wave1.mjs
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function runChecks() {
  // 1) LLM 5xx rate placeholder - rely on app logs for LLM 5xx
  // 2) Get recent change_log counts
  let { data: counts, error } = await supabase
    .rpc('count_change_logs_recent', { p_interval_minutes: 60 }) // optional rpc if exists
  // Fallback: query directly
  let { data: recentChanges } = await supabase
    .from('ai_event_change_log')
    .select('id,requested_by,confirmed_by_client,created_at,change_reason')
    .gt('created_at', new Date(Date.now() - 1000*60*60).toISOString())
  if (!recentChanges) recentChanges = [];
  const total = recentChanges.length
  const confirmedFalse = recentChanges.filter(r => r.confirmed_by_client === false).length
  const ratioUnconfirmed = total ? (confirmedFalse/total) : 0

  console.log(`ChangeLogs last 60min: total=${total}, unconfirmed=${confirmedFalse}, ratio=${ratioUnconfirmed}`)

  // thresholds
  if (ratioUnconfirmed > 0.10) {
    console.error('ALERT: unconfirmed ratio > 10%')
    process.exitCode = 2
  }

  // Gatekeeper reasons distribution
  let { data: reasons } = await supabase
    .from('ai_event_change_log')
    .select('change_reason')
    .gt('created_at', new Date(Date.now() - 1000*60*60).toISOString())
  
  if (reasons) {
    const reasonsMap = {};
    for (const row of reasons) {
        reasonsMap[row.change_reason] = (reasonsMap[row.change_reason] || 0) + 1;
    }
    console.log('Change reason distribution last 60min:', reasonsMap)
  }

  // quick safety metric: self-check failures => stored in ai_reply_decisions maybe
  let { data: replyDecisions } = await supabase
    .from('ai_reply_decisions')
    .select('id,conversation_id,decision,created_at')
    .gt('created_at', new Date(Date.now()-1000*60*60).toISOString())
  
  if (!replyDecisions) replyDecisions = [];
  let failures = replyDecisions.filter(r => r.decision === 'needs_human_review').length
  if (replyDecisions.length && (failures / replyDecisions.length) > 0.03) {
    console.error('ALERT: reply self-check failure ratio > 3%')
    process.exitCode = 2
  }

  // export snapshots for artifact storage
  console.log('Sample replies:', replyDecisions.slice(0,10))
  console.log('Done checks.')
}

runChecks().catch(e => {
  console.error('Monitor error', e)
  process.exit(3)
})
