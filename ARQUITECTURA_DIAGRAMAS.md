# Diagramas de arquitectura y flujo de trabajo

Este documento recoge dos visualizaciones del proyecto `keywords-gsc`: la relación entre componentes y el flujo de trabajo mensual del proceso.

## 1) Diagrama de relaciones entre componentes

```mermaid
flowchart LR
    classDef external fill:#E8F5E9,stroke:#2E7D32,stroke-width:1.5px,color:#1B1B1B;
    classDef sheets fill:#E3F2FD,stroke:#1565C0,stroke-width:1.5px,color:#1B1B1B;
    classDef appscript fill:#F3E5F5,stroke:#7B1FA2,stroke-width:1.5px,color:#1B1B1B;
    classDef helper fill:#FFF3E0,stroke:#EF6C00,stroke-width:1.5px,color:#1B1B1B;
    classDef api fill:#FCE4EC,stroke:#C2185B,stroke-width:1.5px,color:#1B1B1B;

    subgraph GS[Google Sheets]
        A[Data\nConfiguración y reglas]
        B[Seguimiento\nKeywords en trabajo]
        C[GSC yyyy-MM-dd\nHistórico diario]
    end

    subgraph AS[Google Apps Script Runtime]
        D[Code.js\nOrquestador principal]
        E[Script7_EvaluarEstados.js\nEvaluación de estado]
        F[Script2_Preguntas.js\nPreguntas e idiomas]
        G[Script5_BancoContenido.js\nBanco de contenido]
        H[Script6_ValidarPreguntas.js\nValidación]
        I[Script8_VerificarWeb.js\nVerificación web]
    end

    subgraph EXT[Servicios externos]
        J[Search Console API\nREST + OAuth]
        K[MailApp\nEmail de resumen]
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

    class A,B,C sheets;
    class D,E,F,G,H,I appscript;
    class J,K api;
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
    classDef trigger fill:#E8F5E9,stroke:#2E7D32,stroke-width:1.5px,color:#1B1B1B;
    classDef core fill:#E3F2FD,stroke:#1565C0,stroke-width:1.5px,color:#1B1B1B;
    classDef manual fill:#FFF3E0,stroke:#EF6C00,stroke-width:1.5px,color:#1B1B1B;
    classDef eval fill:#F3E5F5,stroke:#7B1FA2,stroke-width:1.5px,color:#1B1B1B;
    classDef email fill:#FCE4EC,stroke:#C2185B,stroke-width:1.5px,color:#1B1B1B;

    A[Trigger mensual\n1er día / 6:00–7:00]:::trigger --> B[exportarKeywordsGSC()\nCode.js]:::core

    B --> C[consultarSearchConsole_()]:::core
    C --> D[Traer consultas\núltimos 90 días]:::core
    D --> E[Clasificar por oportunidad]:::core
    E --> F[Ordenar por impresiones]:::core
    F --> G[Seleccionar Top N keywords]:::core

    G --> H[Escribir hoja\nGSC yyyy-MM-dd]:::core
    G --> I[Actualizar Seguimiento]:::core

    I --> J{¿La keyword\nya existía?}:::manual
    J -->|No| K[Crear nueva fila\nEstado: Pendiente]:::manual
    J -->|Sí| L[Actualizar métricas GSC\nCategoría, impresiones, CTR, posición]:::manual

    K --> M[Revisión manual\nvolumen, competencia, notas y estado]:::manual
    L --> M

    M --> N[evaluarEstados()\nScript7]:::eval
    N --> O[Aplicar reglas\nde Data]:::eval
    O --> P[Actualizar Estado\nde filas]:::eval

    P --> Q[Verificar web\nScript8]:::eval
    Q --> R[Detectar si la keyword\nestá en página, meta y cuerpo]:::eval
    R --> S[Actualizar estado final\ny fechas]:::eval

    S --> T[Enviar resumen por email\nenviarCorreo_]:::email
    T --> U[Fin del ciclo mensual]:::trigger
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

Si quieres, puedo dejarte también una versión de este documento con estilo más formal para README o una versión con diagramas más compactos para presentación.
