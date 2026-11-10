# KDE/CTE matrix — olive oil (ADR 0001)

Draft by engineering from domain knowledge, 2026-11-10. **Needs review by at least one design partner** (Phase 0 gate). P5 turns each event's rows into a versioned KDE schema.

| Event (CTE) | Who | Device | Frequency | KDE | Type / unit | Required |
|---|---|---|---|---|---|---|
| ORIGINATE — harvest | Grower | Phone | per picking day per plot | harvest date | date | yes |
| | | | | plot | location (polygon) | yes |
| | | | | quantity | kg olives | yes |
| | | | | cultivar(s) | list | yes |
| | | | | harvest method | hand / mechanical / net | no |
| SHIP — olives to mill | Grower | Phone | per delivery | delivery date-time | datetime | yes |
| | | | | quantity | kg (gross) | yes |
| | | | | delivery note number | text | no |
| RECEIVE — olives at mill | Mill | Tablet at weighbridge | per delivery | received date-time | datetime | yes |
| | | | | supplier and supplier lot | partner + lot ref | yes |
| | | | | net weight | kg | yes |
| | | | | condition notes / rejected kg | text / kg | no |
| TRANSFORM — milling (extraction) | Mill | Tablet / desktop | per milling batch | start date-time | datetime | yes |
| | | | | input olive lots + kg each | lot refs + kg | yes |
| | | | | output oil lot + quantity | lot + kg | yes |
| | | | | hours from harvest to milling | hours (derived) | derived |
| | | | | extraction method | two-phase / three-phase / press | yes |
| | | | | malaxation max temperature | °C | yes (needed for a "cold extraction" claim) |
| | | | | storage tank | location | yes |
| | | | | pomace output | kg | no |
| TRANSFORM — blending | Mill / bottler | Desktop | per blend | input oil lots + kg each | lot refs + kg | yes |
| | | | | output blend lot | lot + kg | yes |
| TRANSFORM — bottling | Bottler | Desktop | per bottling run | input oil lot(s) + kg | lot refs + kg | yes |
| | | | | output packaged lot | lot + units | yes |
| | | | | pack (product version: size, container) | product | yes |
| | | | | best-before date | date | yes |
| SHIP — to distributor/retailer | Bottler | Desktop | per shipment | ship date | date | yes |
| | | | | customer | partner | yes |
| | | | | lots + units | lot refs + units | yes |
| | | | | SSCC | 18 digits | no |
| RECEIVE — at distributor/retailer | Distributor | Phone / desktop | per shipment | received date | date | yes |
| | | | | lots + units | lot refs + units | yes |

Quality analyses (free acidity % oleic acid, peroxide value, K232/K270, ΔK, sensory panel) are **evidence** attached to oil lots (P4), not KDEs.
