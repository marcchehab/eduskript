# MCP — Eduskript via claude.ai, Cursor & Claude Code

Eduskript exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server so you can author content in natural language from your AI tooling.
You point claude.ai (or Cursor, or Claude Code) at your Eduskript instance,
sign in once in a browser tab, and the AI gains scoped access to your skripts.

The server is **per-teacher scoped**: your token can only read and edit content
you author or co-author. Other teachers' content is invisible.

## What you can do

The v1 server exposes 5 tools:

| Tool | What it does |
|---|---|
| `list_my_skripts` | List the skripts you author |
| `read_page` | Read a page's full markdown content |
| `create_page` | Create a new page in a skript you author |
| `update_page` | Update a page's title / slug / content / publish state |
| `search_my_content` | Substring search across your authored pages |

Destructive actions (delete, manage co-authors, bulk publish) stay in the
dashboard for v1.

## Setup — claude.ai (recommended)

1. Open <https://claude.ai>, click your avatar → **Settings** → **Connectors**
   (or **Integrations**, depending on your plan).
2. Click **Add custom connector**.
3. Paste `https://eduskript.org/api/mcp/mcp` as the server URL and give it a
   name like "Eduskript".
4. Claude opens an OAuth tab. Sign in to your Eduskript account.
5. On the consent screen, click **Allow**.
6. The tab redirects back; the connector is now available in your chats.

Custom connectors are available on Claude Pro, Max, Team, and Enterprise plans.

## Setup — Claude Code

```bash
claude mcp add --transport http eduskript https://eduskript.org/api/mcp/mcp
```

Claude Code opens a browser tab for the OAuth flow; sign in and click Allow.
After that, the tools are available in any Claude Code session.

## Setup — Cursor

In Cursor, open Settings → MCP and add a server:

```json
{
  "eduskript": {
    "url": "https://eduskript.org/api/mcp/mcp"
  }
}
```

The OAuth flow runs the same way as claude.ai.

## Example prompts

Once connected, try:

- *"Show me all my skripts."*
- *"What's in the page on quadratic functions?"*
- *"Update the introduction page in my algebra skript: replace the second
  paragraph with a clearer explanation of completing the square."*
- *"Create a new page in my SQL skript called 'JOINs', summarize the standard
  4 join types with an example query for each."*
- *"Search my content for 'Pythagoras' and tell me which pages mention it."*

## Revoking access

When you stop using an AI client, revoke its access:

1. Go to **Settings → Connected Apps** in the dashboard.
2. Click **Revoke** next to the app.

The next request from that client will return 401.

## What gets logged

Eduskript logs:

- The first 12 characters of your access token (for UI display, not auditable).
- The token's last-used timestamp (bumped on every successful call).
- Tool name + (truncated) arguments at the application level.

We never log full token plaintext.

## Limits

- Access tokens expire after **1 hour**. The client refreshes automatically.
- Refresh tokens expire after **30 days** of inactivity.
- Search returns at most **20 hits**.
- Streamable HTTP runs in stateless mode, so multi-step server-initiated
  notifications aren't available in v1 — every call is request/response.

## Troubleshooting

- **OAuth tab opens but redirects to a login page repeatedly.** Make sure your
  browser is signed into the *same* Eduskript account you want the AI to use.
- **`401 invalid_grant`** when refreshing. The refresh token has expired or
  was rotated by a previous request that crashed before storing the new pair.
  Disconnect and reconnect from the AI client.
- **"Permission denied" on a page you can edit in the dashboard.** Confirm you
  are an *author* (not just viewer) on the parent skript or page in the
  dashboard's permissions panel.
