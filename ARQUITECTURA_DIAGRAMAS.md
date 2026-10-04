# Diagramas de arquitectura y flujo de trabajo

Este documento recoge dos visualizaciones del proyecto `keywords-gsc`: la relación entre componentes y el flujo de trabajo mensual del proceso.

## 1) Diagrama de relaciones entre componentes

```mermaid
flowchart LR
    classDef external fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B1B1B
    classDef sheets fill:#E3F2FD,stroke:#1565C0,stroke-width:2px,color:#1B1B1B
    classDef appscript fill:#F3E5F5,stroke:#7B1FA2,stroke-width:2px,color:#1B1B1B
    classDef helper fill:#FFF3E0,stroke:#EF6C00,stroke-width:2px,color:#1B1B1B
    classDef api fill:#FCE4EC,stroke:#C2185B,stroke-width:2px,color:#1B1B1B

    subgraph GS["Google Sheets"]
        A["Data<br/>Configuración y reglas"]
        B["Seguimiento<br/>Keywords en trabajo"]
        C["GSC yyyy-MM-dd<br/>Histórico diario"]
    end

    subgraph AS["Google Apps Script Runtime"]
        D["Code.js<br/>Orquestador principal"]
        E["Script7<br/>Evaluación de estado"]
        F["Script2<br/>Preguntas e idiomas"]
        G["Script5<br/>Banco de contenido"]
        H["Script6<br/>Validación"]
        I["Script8<br/>Verificación web"]
    end

    subgraph EXT["Servicios externos"]
        J["Search Console API<br/>REST + OAuth"]
        K["MailApp<br/>Email de resumen"]
    end

    A --> E
    B --> E
    C --> D
    D --> J
    D --> K
    D -->|lee/escribe| GS
    D --- F
    D --- G
    D --- H
    D --- I
    F --> B
    G --> A
    H --> A
    I --> B

    class A,B,C sheets
    class D,E,F,G,H,I appscript
    class J,K api
```

### Descripción

- `Code.js` es el punto central del proyecto y orquesta la ejecución principal.
- La Hoja de cálculo Google Sheets actúa como base de datos operativa del sistema.
- La pestaña `Data` guarda las reglas, estados, configuración y catálogos que el script usa sin hardcodear datos de cada instalación.
- La pestaña `Seguimiento` es la vista operativa donde se guarda el estado de cada keyword y el trabajo manual.
- La pestaña `GSC yyyy-MM-dd` es un histórico por corrida, que conserva cada extracción del día.
- Los scripts complementarios (`Script2`, `Script5`, `Script6`, `Script7`, `Script8`) agregan comportamiento específico para preguntas, validación, banco de contenido, estados y verificación web.
- El sistema consulta Google Search Console por REST con OAuth, y luego escribe los resultados en Sheets y envía resúmenes por email.

---

## 2) Diagrama del flujo de trabajo

```mermaid
flowchart TD
    classDef trigger fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B1B1B
    classDef core fill:#E3F2FD,stroke:#1565C0,stroke-width:2px,color:#1B1B1B
    classDef manual fill:#FFF3E0,stroke:#EF6C00,stroke-width:2px,color:#1B1B1B
    classDef eval fill:#F3E5F5,stroke:#7B1FA2,stroke-width:2px,color:#1B1B1B
    classDef email fill:#FCE4EC,stroke:#C2185B,stroke-width:2px,color:#1B1B1B

    A["Trigger mensual<br/>1er día / 6:00–7:00"]:::trigger
    B["exportarKeywordsGSC<br/>Code.js"]:::core
    C["consultarSearchConsole"]:::core
    D["Traer consultas<br/>últimos 90 días"]:::core
    E["Clasificar por oportunidad"]:::core
    F["Ordenar por impresiones"]:::core
    G["Seleccionar Top N<br/>keywords"]:::core
    H["Escribir hoja<br/>GSC yyyy-MM-dd"]:::core
    I["Actualizar<br/>Seguimiento"]:::core
    J{Keyword<br/>ya existía?}:::manual
    K["Crear nueva fila<br/>Estado: Pendiente"]:::manual
    L["Actualizar métricas GSC"]:::manual
    M["Revisión manual<br/>volumen y competencia"]:::manual
    N["evaluarEstados<br/>Script7"]:::eval
    O["Aplicar reglas<br/>de Data"]:::eval
    P["Actualizar Estado<br/>de filas"]:::eval
    Q["Verificar web<br/>Script8"]:::eval
    R["Detectar keyword<br/>en página/meta/cuerpo"]:::eval
    S["Actualizar estado final<br/>y fechas"]:::eval
    T["Enviar resumen<br/>por email"]:::email
    U["Fin del ciclo"]:::trigger

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
    G --> I
    I --> J
    J -->|No| K
    J -->|Sí| L
    K --> M
    L --> M
    M --> N
    N --> O
    O --> P
    P --> Q
    Q --> R
    R --> S
    S --> T
    T --> U
```

### Descripción del flujo

1. El sistema se dispara de forma mensual desde Apps Script.
2. `exportarKeywordsGSC()` consulta Search Console con OAuth y trae las consultas relevantes.
3. Las keywords se clasifican según impresiones, CTR y posición.
4. Se genera una hoja histórica por fecha y se sincroniza la pestaña `Seguimiento`.
5. El trabajo manual se hace para cada keyword: volumen, competencia y decisiones operativas.
6. `evaluarEstados()` aplica las reglas de Data para recalcular el estado de cada fila.
7. `Script8_VerificarWeb.js` comprueba si las keywords están realmente aplicadas en el sitio y en qué parte.
8. Finalmente, se envía un correo con el resumen por estado, cambios y enlaces útiles.

---

## Resumen ejecutivo

Este proyecto combina tres capas principales:

- Captura y clasificación de keyword data desde Google Search Console.
- Organización operativa en Google Sheets como herramienta principal de trabajo.
- Automatización y lógica de negocio en Apps Script para mantener y clasificar la información sin necesidad de un backend tradicional.

La estructura está pensada para reutilizarse en distintos sitios o empresas, dejando la configuración específica en `Script Properties` y `Data` y manteniendo el código central genérico.

```text
Proyecto: keywords-gsc
Tipo: Google Apps Script + Google Sheets
Integración externa: Search Console API + Google Mail + Web verification
Modo de operación: flujo mensual automatizado con revisión manual de keywords
```
