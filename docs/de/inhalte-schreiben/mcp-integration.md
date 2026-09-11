# MCP-Integration

Eduskript stellt einen [Model-Context-Protocol](https://modelcontextprotocol.io)-Server
bereit, damit du Inhalte in natürlicher Sprache aus deinen KI-Werkzeugen heraus verfassen kannst.
Du verbindest claude.ai (oder Cursor oder Claude Code) mit deiner Eduskript-Instanz,
meldest dich einmal in einem Browser-Tab an, und die KI erhält eingeschränkten Zugriff auf deine Skripts.

Der Server ist **pro Lehrperson beschränkt**: Dein Token kann nur Inhalte lesen und bearbeiten,
die du verfasst oder mitverfasst hast. Die Inhalte anderer Lehrpersonen sind unsichtbar.

## Was du tun kannst

Der v1-Server stellt 5 Werkzeuge bereit:

| Werkzeug | Was es tut |
|---|---|
| `list_my_skripts` | Die Skripts auflisten, die du verfasst |
| `read_page` | Den vollständigen Markdown-Inhalt einer Seite lesen |
| `create_page` | Eine neue Seite in einem Skript erstellen, das du verfasst |
| `update_page` | Titel / Slug / Inhalt / Veröffentlichungszustand einer Seite aktualisieren |
| `search_my_content` | Teilstring-Suche über deine verfassten Seiten |

Destruktive Aktionen (Löschen, Mitautoren verwalten, Massen-Veröffentlichung) bleiben in v1
im Dashboard.

## Einrichtung — claude.ai (empfohlen)

1. Öffne <https://claude.ai>, klicke auf deinen Avatar → **Settings** → **Connectors**
   (oder **Integrations**, je nach Plan).
2. Klicke auf **Add custom connector**.
3. Füge `https://eduskript.org/api/mcp/mcp` als Server-URL ein und gib ihm einen
   Namen wie «Eduskript».
4. Claude öffnet einen OAuth-Tab. Melde dich bei deinem Eduskript-Konto an.
5. Klicke auf dem Zustimmungsbildschirm auf **Allow**.
6. Der Tab leitet zurück; der Connector steht jetzt in deinen Chats zur Verfügung.

Custom Connectors sind in den Plänen Claude Pro, Max, Team und Enterprise verfügbar.

## Einrichtung — Claude Code

```bash
claude mcp add --transport http eduskript https://eduskript.org/api/mcp/mcp
```

Claude Code öffnet einen Browser-Tab für den OAuth-Ablauf; melde dich an und klicke auf Allow.
Danach stehen die Werkzeuge in jeder Claude-Code-Sitzung zur Verfügung.

## Einrichtung — Cursor

Öffne in Cursor Settings → MCP und füge einen Server hinzu:

```json
{
  "eduskript": {
    "url": "https://eduskript.org/api/mcp/mcp"
  }
}
```

Der OAuth-Ablauf läuft gleich wie bei claude.ai.

## Beispiel-Prompts

Sobald verbunden, probiere:

- *«Zeig mir alle meine Skripts.»*
- *«Was steht auf der Seite über quadratische Funktionen?»*
- *«Aktualisiere die Einführungsseite in meinem Algebra-Skript: Ersetze den zweiten
  Absatz durch eine klarere Erklärung der quadratischen Ergänzung.»*
- *«Erstelle in meinem SQL-Skript eine neue Seite namens ‹JOINs› und fasse die 4
  Standard-Join-Typen mit je einer Beispielabfrage zusammen.»*
- *«Durchsuche meine Inhalte nach ‹Pythagoras› und sag mir, welche Seiten ihn erwähnen.»*

## Zugriff widerrufen

Wenn du einen KI-Client nicht mehr verwendest, widerrufe seinen Zugriff:

1. Gehe im Dashboard zu **Settings → Connected Apps**.
2. Klicke neben der App auf **Revoke**.

Die nächste Anfrage dieses Clients liefert 401.

## Was protokolliert wird

Eduskript protokolliert:

- Die ersten 12 Zeichen deines Zugriffstokens (zur Anzeige in der Oberfläche, nicht auditierbar).
- Den Zeitstempel der letzten Verwendung des Tokens (bei jedem erfolgreichen Aufruf aktualisiert).
- Werkzeugname + (gekürzte) Argumente auf Anwendungsebene.

Wir protokollieren nie den vollständigen Token im Klartext.

## Grenzen

- Zugriffstokens laufen nach **1 Stunde** ab. Der Client erneuert sie automatisch.
- Refresh-Tokens laufen nach **30 Tagen** Inaktivität ab.
- Die Suche liefert höchstens **20 Treffer**.
- Streamable HTTP läuft im zustandslosen Modus, daher sind mehrstufige, vom Server
  ausgelöste Benachrichtigungen in v1 nicht verfügbar — jeder Aufruf ist Anfrage/Antwort.

## Fehlerbehebung

- **Der OAuth-Tab öffnet sich, leitet aber wiederholt auf eine Login-Seite um.** Stelle sicher, dass dein
  Browser bei *demselben* Eduskript-Konto angemeldet ist, das die KI verwenden soll.
- **`401 invalid_grant`** beim Erneuern. Der Refresh-Token ist abgelaufen oder
  wurde von einer vorherigen Anfrage rotiert, die abstürzte, bevor sie das neue Paar speicherte.
  Trenne die Verbindung im KI-Client und verbinde erneut.
- **«Permission denied» auf einer Seite, die du im Dashboard bearbeiten kannst.** Prüfe, dass du
  im Berechtigungs-Panel des Dashboards *Autor* (nicht nur Betrachter) des übergeordneten Skripts
  oder der Seite bist.
