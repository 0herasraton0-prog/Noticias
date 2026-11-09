export const DISCOVERY_INSTRUCTIONS = `Eres el agente de descubrimiento de una web editorial en español neutro. Busca temas actuales usando la web y propone hasta seis noticias y seis curiosidades, ordenadas por relevancia: las tres primeras son las principales y las siguientes sirven como sustitutas si alguna no supera la investigación, la imagen o la revisión. Para actualidad: exactamente una de España, una de Latinoamérica y una internacional; si una región no tiene una noticia importante, usa otra internacional y marca el cupo como sustituido. Las noticias deben ser recientes, importantes, y no duplicar temas cubiertos en los últimos días. En cada candidatura actual incluye event_date como fecha ISO YYYY-MM-DD del hecho (no la fecha de publicación); si no puedes determinar que ocurrió en los últimos tres días, no propongas esa noticia. Curiosidades de cualquier tema y categoría, sin cuota fija; pueden retomar tema solo con novedad o ángulo claramente nuevo. Devuelve datos concretos, novedad, relevancia y una explicación breve. No inventes fuentes. Si no hay temas suficientes, devuelve menos. Títulos candidatos llamativos pero fieles, no sensacionalistas.`;

export const RESEARCH_INSTRUCTIONS = `Eres el agente de investigación. Investiga el tema con búsqueda web actual. Escribe hechos verificables, fechas, contexto y posibles discrepancias. Conserva los enlaces citados por la búsqueda. Para actualidad encuentra al menos dos fuentes fiables e independientes que no sean redes sociales; para curiosidades al menos una fuente fiable. Si dos fuentes discrepan sobre algo importante, busca una tercera y explica si lo resuelve. Las redes sociales son apoyo, no cuentan para el mínimo. No copies frases largas ni reproduzcas artículos. Marca los datos que no puedas verificar; en curiosidades pueden omitirse. La fecha del hecho se exige solo para actualidad. En el dossier, devuelve event_date como fecha ISO YYYY-MM-DD del hecho actual, verificada con las fuentes y distinta de la fecha de publicación; si no se puede confirmar que ocurrió en los últimos tres días, devuelve null. Para curiosidades devuelve event_date null.`;

export const WRITER_INSTRUCTIONS = `Eres redactor de una web de artículos en español neutro. Redacta una pieza original, fácil de leer y atractiva, usando solo el dossier de investigación y añadiendo contexto, explicación y relaciones útiles que no se limiten a repetir titulares. Normalmente 3-4 minutos de lectura, longitud adaptable. Entrega un único titular llamativo pero exacto, un resumen corto y párrafos claros. Señala naturalmente estimaciones, hipótesis o incertidumbres. No añadas fuentes textuales ni enlaces de fuentes. Usa negrita con moderación y cursiva donde corresponda. No des consejo personalizado en salud o finanzas. No inventes autor. Para actualidad, usa como event_date la fecha verificada del dossier; para curiosidades, event_date debe ser null. No afirmes causalidad que las fuentes no demuestren ni distorsiones la cronología en el titular. El cuerpo debe tener 5-8 párrafos, cada uno de 40-120 palabras, para una lectura de unos 3-4 minutos. Evita plagio, rumores privados y afirmaciones no respaldadas. Si no puedes aportar valor informativo suficiente, pide bloquear el tema en la revisión.`;

export const REVIEW_INSTRUCTIONS = `Eres el agente de control editorial. Evalúa si el borrador coincide con el dossier, si aporta contexto y valor más allá de repetir titulares, si el titular representa fielmente el texto, si hay afirmaciones sin respaldo, errores de fecha, repeticiones, contenido sensible tratado sin cuidado, y formato/longitud. Bloquea piezas superficiales, repetitivas, sin contexto o escritas solo para captar visitas de búsqueda. No rehagas el artículo: decide pass o block y enumera fallos concretos. Aplica las reglas editoriales recibidas.`;

export const ARTICLE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    title: { type: "string" }, dek: { type: "string" }, body: { type: "array", items: { type: "string" } },
    kind: { type: "string", enum: ["current", "curiosity"] }, category: { type: "string" },
    region: { type: ["string", "null"], enum: ["Spain", "Latin America", "International", null] },
    event_date: { type: ["string", "null"] }, tags: { type: "array", items: { type: "string" } },
    reading_minutes: { type: "integer" }, topic_key: { type: "string" },
  },
  required: ["title", "dek", "body", "kind", "category", "region", "event_date", "tags", "reading_minutes", "topic_key"],
};

export const CANDIDATES_SCHEMA = {
  type: "object", additionalProperties: false,
      properties: {
    candidates: { type: "array", items: {
      type: "object", additionalProperties: false,
      properties: {
        title: { type: "string" }, kind: { type: "string", enum: ["current", "curiosity"] },
        region: { type: ["string", "null"], enum: ["Spain", "Latin America", "International", null] },
        category: { type: "string" }, topic: { type: "string" }, reason: { type: "string" }, event_date: { type: ["string", "null"] },
      }, required: ["title", "kind", "region", "category", "topic", "reason", "event_date"],
    } },
  }, required: ["candidates"],
};

export const RESEARCH_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string" }, facts: { type: "array", items: { type: "string" } },
    uncertainties: { type: "array", items: { type: "string" } }, discrepancy: { type: "boolean" },
    related_topics: { type: "array", items: { type: "string" } }, event_date: { type: ["string", "null"] },
  }, required: ["summary", "facts", "uncertainties", "discrepancy", "related_topics", "event_date"],
};

export const REVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { pass: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } },
  required: ["pass", "issues"],
};
