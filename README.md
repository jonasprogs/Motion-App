# DIY Motion – v5

**Neu**
- **Inbox + Slider**: Neue Aufgaben landen in der Inbox. Schalte den Slider **aktiv**, damit sie eingeplant werden.
- **Auto-Replan** (optional): Schalter oben. Holt alle 5 Minuten Google-Kalender (read-only) und **verschiebt Tasks automatisch**, wenn neue Termine reinkommen.
- **Drag & Drop**: Geplante Blöcke im Kalender vertikal verschieben (15‑Min‑Raster). Manuell verschobene Blöcke werden **fixiert** und beim Re-Planen respektiert.
- **Prioritätsfarben**: Blöcke bekommen Farbe nach Prio (1–5).
- **Harte Deadlines**: Checkbox beim Anlegen. Blöcke werden nicht hinter die harte Deadline gelegt. Unerfüllbar → Task bleibt (teilweise) ungeplant.

**Tipps**
- „Google verbinden“ in `app.js` mit deiner `clientId` und `apiKey` füllen.
- „Auto-Replan“ aktiviert? Dann nach jedem Sync → automatische Neuplanung (fixierte Blöcke bleiben).
- Abhängigkeiten „nach/vor“ gelten weiter (Tasks & Kalender).

**Roadmap-Ideen**
- Resize per Drag (Blocklänge ändern)
- Day-to-day Drag (Block auf anderen Tag schieben)
- Mehrere Kalender wählbar und ICS-Feed abonnieren
