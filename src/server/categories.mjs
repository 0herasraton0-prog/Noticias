export const EDITORIAL_CATEGORIES = Object.freeze([
  "Ciencia",
  "Naturaleza y animales",
  "Geografía y lugares",
  "Historia y arqueología",
  "Espacio y universo",
  "Tecnología e inventos",
  "Cultura y tradiciones",
  "Cuerpo y mente",
  "Famosos y entretenimiento",
  "Datos sorprendentes y vida cotidiana",
]);

export const CATEGORY_VISUAL_QUERIES = Object.freeze({
  "Ciencia": "science experiment laboratory",
  "Naturaleza y animales": "wild animal natural habitat",
  "Geografía y lugares": "landscape mountains coastline",
  "Historia y arqueología": "archaeological ruins artifact",
  "Espacio y universo": "planet satellite space telescope",
  "Tecnología e inventos": "robot electronics computer technology",
  "Cultura y tradiciones": "cultural festival church ceremony",
  "Cuerpo y mente": "human brain anatomy",
  "Famosos y entretenimiento": "film stage performance",
  "Datos sorprendentes y vida cotidiana": "police emergency lights everyday life",
});

const LEGACY_CATEGORY_ALIASES = new Map([
  ["clima", "Ciencia"],
  ["clima y medioambiente", "Ciencia"],
  ["religión y sociedad", "Cultura y tradiciones"],
  ["religion y sociedad", "Cultura y tradiciones"],
  ["sucesos", "Datos sorprendentes y vida cotidiana"],
  ["espacio y tecnología", "Espacio y universo"],
  ["espacio y tecnologia", "Espacio y universo"],
  ["espacio y robótica", "Espacio y universo"],
  ["espacio y robotica", "Espacio y universo"],
]);

export const LEGACY_VISUAL_QUERIES = Object.freeze({
  "clima": ["climate change earth atmosphere", "weather satellite clouds"],
  "religión y sociedad": ["Catholic mass church congregation", "Pope Vatican church"],
  "religion y sociedad": ["Catholic mass church congregation", "Pope Vatican church"],
  "sucesos": ["police car emergency lights", "police emergency lights night"],
  "espacio y tecnología": ["space robot satellite assembly", "robotic arm space station"],
  "espacio y tecnologia": ["space robot satellite assembly", "robotic arm space station"],
});

function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

export function normalizeEditorialCategory(value, article = {}) {
  const subject = normalized([article.title, ...(article.tags || [])].join(" "));
  // Strong subject clues override a generic or incorrect model category.
  if (/\\b(espacio|orbita|planeta|astro|nasa|sat[eé]lite|universo|astronaut|darpa|astra)\\b/.test(subject)) return "Espacio y universo";
  if (/\\b(iglesia|papa|religion|misa|tradicion|cultura|ceremonia|patrimonio)\\b/.test(subject)) return "Cultura y tradiciones";
  if (/\\b(policia|suceso|crimen|explosion|rescate|migrante|huelga|banco|gobierno|eleccion|tribunal|presidente|ministro|elecciones)\\b/.test(subject)) return "Datos sorprendentes y vida cotidiana";
  if (/\\b(clima|temperatura|cop\\d+|calentamiento|medioambiente|el nino|atmosfera|ciencia|cientifico|investigacion)\\b/.test(subject)) return "Ciencia";
  if (/\\b(fosil|arqueolog|maya|ruinas|prehistoria|civilizacion|antiguo|excavacion)\\b/.test(subject)) return "Historia y arqueología";
  if (/\\b(animal|ave|pajaro|dinosaurio|ballena|bosque|fauna|flora|naturaleza|especie)\\b/.test(subject)) return "Naturaleza y animales";
  if (/\\b(robot|tecnologia|invent|computador|inteligencia artificial|circuito|software)\\b/.test(subject)) return "Tecnología e inventos";
  if (/\\b(rio|montana|isla|desierto|canon|paisaje|geografia|cueva|territorio)\\b/.test(subject)) return "Geografía y lugares";
  if (/\\b(cerebro|cuerpo|mente|salud|biologia|medicina)\\b/.test(subject)) return "Cuerpo y mente";
  if (/\\b(actor|actriz|cantante|cine|pelicula|serie|entretenimiento|famoso)\\b/.test(subject)) return "Famosos y entretenimiento";

  const exact = EDITORIAL_CATEGORIES.find((category) => normalized(category) === normalized(value));
  if (exact) return exact;
  const alias = LEGACY_CATEGORY_ALIASES.get(normalized(value));
  if (alias) return alias;
  return "Datos sorprendentes y vida cotidiana";
}
