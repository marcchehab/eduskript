# Sourced by bin/kamal, bin/reboot-caddy, bin/reboot-db.
# SSH access to eduskript-prod as user deploy. Key source, first match wins:
# 1. EDUSKRIPT_DEPLOY_SSH_KEY: the private key itself (OpenSSH format, with
#    newlines). Loaded into a throwaway ssh-agent that dies with this script;
#    the key is never written to disk.
# 2. The key file ~/.ssh/eduskript-prod (chmod 600), loaded the same way.
# 3. An already running agent in SSH_AUTH_SOCK that holds the key.
# A throwaway agent is needed even for the file: Kamal runs in a container
# and only sees the key through the forwarded agent socket.
# Callers must not `exec` after sourcing this: exec skips the EXIT trap and
# leaves the throwaway agent running.
PROD_HOST=179.237.126.129
PROD_SSH=(ssh -o BatchMode=yes "deploy@$PROD_HOST")
PROD_KEY_FILE="$HOME/.ssh/eduskript-prod"
if [ -z "${EDUSKRIPT_AGENT_STARTED:-}" ] && { [ -n "${EDUSKRIPT_DEPLOY_SSH_KEY:-}" ] || [ -f "$PROD_KEY_FILE" ]; }; then
  eval "$(ssh-agent -s)" >/dev/null
  trap 'ssh-agent -k >/dev/null' EXIT
  export EDUSKRIPT_AGENT_STARTED=1   # nested calls (reboot-* → bin/kamal) reuse this agent
  if [ -n "${EDUSKRIPT_DEPLOY_SSH_KEY:-}" ]; then
    ssh-add -q - <<<"$EDUSKRIPT_DEPLOY_SSH_KEY"
  else
    ssh-add -q "$PROD_KEY_FILE"
  fi
fi
: "${SSH_AUTH_SOCK:?No SSH key: set EDUSKRIPT_DEPLOY_SSH_KEY, create ~/.ssh/eduskript-prod, or start an ssh-agent holding the eduskript-prod key}"
