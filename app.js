/**
 * Visor de Rutas Logísticas
 * ---------------------------------------------------------
 * Lee ?id_ruta=... de la URL, pide el ruteo a la API,
 * extrae el GeoJSON embebido en la respuesta y lo dibuja
 * en un mapa Leaflet, ajustando el zoom a la ruta completa.
 */

// URL base de la API real. Cámbiala por tu endpoint cuando lo tengas.
const API_BASE_URL = "https://api.empresa.com/rutas";

// Referencia global al mapa (se crea una sola vez).
let mapa = null;

/**
 * Punto de entrada. Orquesta el flujo completo:
 * leer parámetro -> fetch -> extraer geojson -> dibujar.
 */
async function main() {
  const idRuta = obtenerIdRutaDesdeUrl();

  if (!idRuta) {
    mostrarError(
      "Falta el parámetro 'id_ruta' en la URL. " +
        "Agrega algo como ?id_ruta=Ruta01 al final del enlace."
    );
    return;
  }

  document.getElementById("ruta-titulo").textContent = `Ruta: ${idRuta}`;
  mapa = inicializarMapa();
  mostrarCargando(`Cargando datos de la ruta "${idRuta}"...`);

  try {
    const jsonComplejo = await obtenerDatosRuta(idRuta);
    const geoJson = procesarYExtraerGeoJson(jsonComplejo);
    dibujarRuta(geoJson);
    ocultarStatus();
  } catch (error) {
    console.error("Error al cargar la ruta:", error);
    mostrarError(error.message || "Ocurrió un error inesperado al cargar la ruta.");
  }
}

/**
 * Lee el parámetro 'id_ruta' de la query string actual.
 * @returns {string|null}
 */
function obtenerIdRutaDesdeUrl() {
  const params = new URLSearchParams(window.location.search);
  const idRuta = params.get("id_ruta");
  return idRuta && idRuta.trim() !== "" ? idRuta.trim() : null;
}

/**
 * Crea y configura el mapa Leaflet con una capa base OSM.
 * @returns {L.Map}
 */
function inicializarMapa() {
  const map = L.map("map", {
    zoomControl: true,
    zoomSnap: 0, // zoom continuo: evita que fitBounds redondee hacia un zoom que recorte la ruta
  }).setView([4.6097, -74.0817], 6); // Vista inicial: Bogotá, se ajustará luego con fitBounds

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  return map;
}

/**
 * Obtiene los datos de ruteo desde la API para un id_ruta dado.
 *
 * NOTA: Aquí se simula la respuesta de la API para poder probar
 * el visor sin backend real. Para conectar tu API real, reemplaza
 * el cuerpo de esta función por el fetch comentado más abajo.
 *
 * @param {string} idRuta
 * @returns {Promise<Object>} JSON complejo devuelto por la API
 */
async function obtenerDatosRuta(idRuta) {
  const url = `${API_BASE_URL}/${idRuta}`;

  // --- Implementación real (descomentar al conectar tu API) ---
  // const respuesta = await fetch(url);
  // if (!respuesta.ok) {
  //   throw new Error(`La API respondió con estado ${respuesta.status} para "${idRuta}".`);
  // }
  // return await respuesta.json();

  // --- Simulación (para desarrollo/demo sin backend) ---
  return simularFetchApi(idRuta, url);
}

/**
 * Recibe el JSON completo de la API y extrae únicamente
 * el objeto GeoJSON anidado en resultado_ruteo.mapa_geojson.
 *
 * @param {Object} jsonComplejo
 * @returns {Object} GeoJSON válido
 */
function procesarYExtraerGeoJson(jsonComplejo) {
  if (!jsonComplejo || jsonComplejo.status !== "success") {
    throw new Error("La API no devolvió un resultado exitoso ('status' distinto de 'success').");
  }

  const geoJson = jsonComplejo?.resultado_ruteo?.mapa_geojson;

  if (!geoJson || typeof geoJson !== "object") {
    throw new Error("La respuesta de la API no contiene un GeoJSON válido en 'resultado_ruteo.mapa_geojson'.");
  }

  return geoJson;
}

/**
 * Dibuja el GeoJSON de la ruta en el mapa y ajusta el zoom
 * para que encuadre toda la geometría (fitBounds).
 *
 * @param {Object} geoJson
 */
function dibujarRuta(geoJson) {
  const capaRuta = L.geoJSON(geoJson, {
    style: {
      color: "#2563eb",
      weight: 4,
      opacity: 0.9,
    },
    pointToLayer: (feature, latlng) =>
      L.circleMarker(latlng, {
        radius: 6,
        color: "#2563eb",
        fillColor: "#60a5fa",
        fillOpacity: 1,
      }),
  }).addTo(mapa);

  const bounds = capaRuta.getBounds();
  if (bounds.isValid()) {
    mapa.fitBounds(bounds, { padding: [50, 50] });
  } else {
    throw new Error("El GeoJSON de la ruta no tiene coordenadas válidas para encuadrar.");
  }
}

// -------------------------------------------------------------
// Manejo de estado en pantalla (carga / error / mensaje)
// -------------------------------------------------------------

function mostrarCargando(mensaje) {
  const overlay = document.getElementById("status-overlay");
  const box = overlay.querySelector(".status-box");
  const spinner = document.getElementById("status-spinner");
  const texto = document.getElementById("status-message");

  box.classList.remove("error");
  spinner.hidden = false;
  texto.textContent = mensaje;
  overlay.hidden = false;
}

function mostrarError(mensaje) {
  const overlay = document.getElementById("status-overlay");
  const box = overlay.querySelector(".status-box");
  const spinner = document.getElementById("status-spinner");
  const texto = document.getElementById("status-message");

  box.classList.add("error");
  spinner.hidden = true;
  texto.textContent = `⚠️ ${mensaje}`;
  overlay.hidden = false;
}

function ocultarStatus() {
  document.getElementById("status-overlay").hidden = true;
}

// -------------------------------------------------------------
// Simulación de API (solo para desarrollo/pruebas locales).
// En vez de generar coordenadas aleatorias, carga un GeoJSON
// real desde archivo local y lo envuelve en la misma forma
// que devolvería la API verdadera. Así se prueba el flujo
// completo (fetch -> extracción -> dibujo) con datos reales.
//
// El id_ruta de la URL selecciona el archivo: ?id_ruta=2026-05-12
// carga data/2026-05-12.geojson. Para probar tu propio GeoJSON,
// colócalo en data/<id_ruta>.geojson (debe ser un Feature o
// FeatureCollection válido) y navega con ese id_ruta.
// -------------------------------------------------------------

async function simularFetchApi(idRuta, urlSimulada) {
  console.info(`[simulación] GET ${urlSimulada}`);
  await esperar(800); // Latencia simulada para poder ver el estado "Cargando..."

  // Simula un id de ruta inexistente en el backend.
  if (idRuta.toLowerCase() === "inexistente") {
    throw new Error(`No se encontró la ruta "${idRuta}" en la API.`);
  }

  const geoJson = await cargarGeoJsonLocal(`data/${idRuta}.geojson`);

  return {
    status: "success",
    metadata: { fecha: "2026-07-21" },
    resultado_ruteo: {
      detalles: `Ruta optimizada para ${idRuta}`,
      mapa_geojson: geoJson,
    },
  };
}

/**
 * Carga y parsea un archivo GeoJSON servido de forma estática
 * (útil para probar con datos reales sin depender de la API).
 */
async function cargarGeoJsonLocal(rutaArchivo) {
  const respuesta = await fetch(rutaArchivo);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar el archivo GeoJSON local "${rutaArchivo}".`);
  }
  return await respuesta.json();
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Arranca la app cuando el DOM está listo.
document.addEventListener("DOMContentLoaded", main);
