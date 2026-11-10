# KDE/CTE matrix — template

Fill one row per data element once the pilot commodity is chosen (ADR 0001). P5 turns each event type's rows into a versioned KDE schema.

| Event (CTE)         | Who records it | Device | Frequency   | KDE             | Type / unit  | Required? | Source today |
| ------------------- | -------------- | ------ | ----------- | --------------- | ------------ | --------- | ------------ |
| ORIGINATE (harvest) | Producer       | Phone  | per harvest | harvest date    | date         | yes       |              |
| ORIGINATE (harvest) | Producer       | Phone  | per harvest | plot / location | location ref | yes       |              |
| RECEIVE             | Processor      |        |             |                 |              |           |              |
| TRANSFORM           | Processor      |        |             |                 |              |           |              |
| SHIP                |                |        |             |                 |              |           |              |
