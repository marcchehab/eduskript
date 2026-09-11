# Zusammenarbeit

Teile Inhalte mit anderen Lehrpersonen — sei es für echte gemeinsame Erstellung, für Peer-Review oder als Beitrag zur Lektion von jemand anderem. Eduskript arbeitet nach dem Prinzip **kein Zugang als Standard**: Eine Kollegin oder einen Kollegen hinzuzufügen teilt nicht automatisch etwas; du gewährst Zugang explizit.

---

## Die zwei Rollen

Wenn du jemanden zur Mitarbeit einlädst, wählst du eine Rolle:

| Rolle | Bearbeitungsrechte | Urheberrecht |
|------|-------------|-----------|
| **Author** | ✓ | Gemeinsames Miteigentum am Werk |
| **Contributor** | ✓ | Ihre Änderungen werden den bestehenden Autoren unter CC BY-NC-SA lizenziert |

Beide können dieselben Inhalte bearbeiten. Der Unterschied liegt darin, **wem das entstehende Werk gehört** — relevant, wenn sich die Beteiligten trennen oder Inhalte die Plattform verlassen.

> [!tip] Faustregel
> - Du erstellst mit einer Kollegin einen Kurs von Grund auf gemeinsam? **Author**.
> - Ein Kollege hilft dir, Tippfehler zu korrigieren, eine Übung hinzuzufügen oder ein Kapitel zu übersetzen? **Contributor**.

---

## Berechtigungsstufen

Innerhalb jeder Rolle kannst du Bearbeitungsrechte oder nur Leserechte gewähren:

| Stufe | Darf |
|-------|--------|
| **Author / Contributor (mit Bearbeitung)** | Diese Inhalte ansehen, bearbeiten, löschen und Mitarbeitende verwalten |
| **Viewer** | Nur-Lese-Zugang zu den (veröffentlichten oder unveröffentlichten) Inhalten |

---

## Teilen auf drei Ebenen

Du kannst auf Ebene **Sammlung**, **Skript** oder **Seite** teilen:

```
Collection (Author: you, Maria)
 ├── Skript A (inherits author from collection)
 │    └── Page (Viewer: Yusuf)  ← per-page override
 └── Skript B (inherits author from collection)
```

| Freigabeebene | Mitarbeitende haben Zugang auf |
|-------------|------------------------|
| **Sammlung** | Die Metadaten der Sammlung + jedes Skript darin (veröffentlicht wie Entwurf) |
| **Skript** | Die Metadaten dieses Skripts + alle seine Seiten (veröffentlicht und Entwurf) |
| **Seite** | Nur diese Seite |

Berechtigungen auf Seitenebene **überschreiben** Berechtigungen auf Skriptebene. Du kannst also ein generell geteiltes Skript haben, in dem eine bestimmte Seite gesperrt ist (oder umgekehrt).

---

## Ablauf beim Teilen

1. Öffne eine Sammlung, ein Skript oder eine Seite
2. Klicke auf **Share** (oder das Berechtigungs-Symbol)
3. Suche eine Kollegin oder einen Kollegen per **E-Mail** oder **Seiten-Slug**
4. Wähle **Author** / **Contributor** / **Viewer**
5. Speichern

Die Kollegin oder der Kollege:
- Erhält eine Benachrichtigung (in der App + per E-Mail)
- Sieht die Inhalte sofort im eigenen Dashboard
- Kann mit dem Bearbeiten beginnen (bei Bearbeitungsrechten)

---

## Ablauf beim Co-Teaching

Für einen Kurs, den ihr wirklich gemeinsam unterrichtet:

1. Erstelle die Sammlung mit Input beider Lehrpersonen
2. Teile die Sammlung mit der Berechtigung **Author** mit deiner Co-Lehrperson
3. Beide Lehrpersonen sehen die Sammlung in ihren Dashboards
4. Jede der beiden kann darin Inhalte erstellen/bearbeiten
5. Skripts und Seiten erben die Author-Berechtigungen automatisch von der Sammlung

Die URL der Inhalte verwendet weiterhin den Seiten-Slug der ursprünglichen Erstellerin oder des Erstellers — es gibt keine «gemeinsame URL». Wenn die URL neutral sein soll, verwende eine Organisationsseite (siehe *Organizations* im Developer Guide).

---

## Zugang entfernen

1. Öffne die Freigabeeinstellungen der Inhalte
2. Suche die mitarbeitende Person
3. Klicke auf **Remove**

Sie verliert den Zugang sofort. Ihre bisherigen Beiträge bleiben in den Inhalten (und in der Versionsgeschichte); sie kann nur nicht mehr bearbeiten.

> [!warning] Untergrenze bei Berechtigungen
> Du kannst dich nicht selbst entfernen, wenn du der **einzige** Autor eines Inhalts bist — es muss immer mindestens einen Autor geben. Um solche Inhalte zu verlassen, übertrage die Autorschaft zuerst an eine Kollegin oder einen Kollegen.

---

## Forken — um veröffentlichte Werke anderer anzupassen

Jedes veröffentlichte Skript auf der Plattform lässt sich forken — von jedem, ohne Beziehung zum ursprünglichen Autor. Wenn du eines anpassen möchtest (übersetzen, umsortieren, Übungen hinzufügen), ohne Mitarbeitender zu werden:

1. Öffne die öffentliche Seite des Skripts
2. Klicke auf **Fork**
3. Du erhältst eine Kopie unter deinem Konto, die dir gehört
4. Das Original bleibt unberührt
5. Dein Fork zeigt einen «Forked from»-Link zum Original (automatische Namensnennung)

Forks erben dieselbe CC BY-NC-SA-Lizenz. Du kannst Forks forken. Die Lizenzdetails findest du im Kapitel **Inhaltslizenz**.

---

## Kollaborationsanfragen

Für einmalige «Darf ich deine Arbeit sehen?»-Anfragen, ohne eine Freigabe einzurichten:

1. **Dashboard → Collaboration → Send request**
2. Wähle eine Kollegin oder einen Kollegen + eine Nachricht
3. Die Person erhält eine Benachrichtigung mit Annehmen/Ablehnen

Beim Annehmen öffnet sich ein Diskussionsthread, in dem ihr aushandeln könnt, was geteilt wird. Das ist der höfliche Weg für «Hey, wir unterrichten ähnliche Kurse, wollen wir uns austauschen?» statt direkter Inhaltsfreigabe.

---

## Sichtbarkeit — was Mitarbeitende in ihrem Dashboard sehen

Wenn du Inhalte mit einer Kollegin oder einem Kollegen teilst:

- Erscheinen sie in deren Bereich **shared with me**
- Zeigt deren Page Builder die eigenen Inhalte + die geteilte Sammlung/das geteilte Skript/die geteilte Seite
- Sind die geteilten Inhalte visuell markiert (anderer Hintergrund oder Label «shared by Marie»)
- Können sie diese in ihrer Hauptansicht anpinnen, wenn sie sie prominenter haben möchten

---

## Zusammenarbeit-Spickzettel

| Ziel | Wie |
|------|-----|
| Ein Skript teilen | Öffnen → Share-Symbol → Mitarbeitende suchen → Rolle wählen |
| Co-Teaching | Sammlung mit Author teilen |
| Peer-Review | Skript mit Viewer teilen |
| Einmalige Übersetzungshilfe | Skript mit Contributor teilen |
| Das veröffentlichte Skript einer anderen Person forken | Öffentliche Skript-Seite → Fork |
| Zugang entfernen | Share settings → Remove |
| Sehen, was mit dir geteilt wurde | Dashboard → Shared with me |
