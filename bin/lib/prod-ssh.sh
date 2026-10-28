# Sourced by bin/kamal, bin/reboot-caddy, bin/reboot-db.
# SSH access to eduskript-prod as user deploy. Key source, first match wins:
# 1. EDUSKRIPT_DEPLOY_SSH_KEY: the private key itself (OpenSSH format, with
#    newlines). Loaded into a throwaway ssh-agent that dies with this script;
#    the key is never written to disk.
# 2. An already running agent in SSH_AUTH_SOCK that holds the key.
# Callers must not `exec` after sourcing this: exec skips the EXIT trap and
# leaves the throwaway agent running.
PROD_HOST=179.237.126.129
PROD_SSH=(ssh -o BatchMode=yes "deploy@$PROD_HOST")
if [ -n "${EDUSKRIPT_DEPLOY_SSH_KEY:-}" ] && [ -z "${EDUSKRIPT_AGENT_STARTED:-}" ]; then
  eval "$(ssh-agent -s)" >/dev/null
  trap 'ssh-agent -k >/dev/null' EXIT
  export EDUSKRIPT_AGENT_STARTED=1   # nested calls (reboot-* → bin/kamal) reuse this agent
  ssh-add -q - <<<"$EDUSKRIPT_DEPLOY_SSH_KEY"
fi
: "${SSH_AUTH_SOCK:?No SSH key: set EDUSKRIPT_DEPLOY_SSH_KEY or start an ssh-agent holding the eduskript-prod key}"
