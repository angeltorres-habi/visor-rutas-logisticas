/**
 * Vercel Function (Node.js, sin dependencias) que actúa como proxy de
 * solo lectura hacia Upstash Redis / Vercel KV.
 *
 * El token de acceso vive únicamente aquí, en variables de entorno del
 * servidor, y nunca llega al navegador — a diferencia de app.js, que es
 * código estático visible para cualquier visitante del sitio.
 *
 * Configura estas variables en Vercel (Project Settings > Environment
 * Variables) o en .env.local para desarrollo:
 *   KV_REST_API_URL
 *   KV_REST_API_READ_ONLY_TOKEN
 *
 * GET /api/geojson?ciudad=bogota&fecha=2026-08-05
 * -> 200 con el GeoJSON (Feature/FeatureCollection) ya desescapado, o
 * -> 404 { message: "No hay rutas para esta fecha" } si no hay datos.
 */

const KV_URL = process.env.KV_REST_API_URL || "TU_KV_REST_API_URL";
const READ_ONLY_TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN || "TU_KV_REST_API_READ_ONLY_TOKEN";

module.exports = async function handler(req, res) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_READ_ONLY_TOKEN) {
    res.status(500).json({
      error: "Faltan las variables de entorno KV_REST_API_URL / KV_REST_API_READ_ONLY_TOKEN en Vercel.",
    });
    return;
  }

  const ciudad = typeof req.query.ciudad === "string" ? req.query.ciudad.trim() : "";
  const fecha = typeof req.query.fecha === "string" ? req.query.fecha.trim() : "";

  if (!ciudad || !fecha) {
    res.status(400).json({ error: "Faltan los parámetros 'ciudad' y/o 'fecha'." });
    return;
  }

  const key = `${ciudad}_${fecha}`;

  try {
    const respuesta = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${READ_ONLY_TOKEN}` },
    });

    if (!respuesta.ok) {
      res.status(502).json({ error: `Upstash respondió con estado ${respuesta.status} para la llave "${key}".` });
      return;
    }

    const data = await respuesta.json();
    const geoJson = extraerGeoJson(data.result, key);

    const sinRutas = !geoJson || (Array.isArray(geoJson.features) && geoJson.features.length === 0);
    if (sinRutas) {
      res.status(404).json({ message: "No hay rutas para esta fecha" });
      return;
    }

    res.status(200).json(geoJson);
  } catch (error) {
    console.error(`Error consultando KV para la llave "${key}":`, error);
    res.status(500).json({ error: "No se pudo consultar la base KV." });
  }
};

/**
 * Normaliza el valor crudo que devuelve Upstash a un GeoJSON limpio,
 * sin importar la forma en que haya quedado guardado:
 *  - FeatureCollection/Feature directo.
 *  - Envuelto en map_geojson o data.map_geojson (forma de
 *    /get_visit_routes).
 *  - Cualquiera de los niveles anteriores como string (JSON en texto
 *    o incluso doblemente escapado: string dentro de string).
 *
 * @param {unknown} resultado - data.result crudo devuelto por Upstash
 * @param {string} key - solo para logs de error
 * @returns {Object|null}
 */
function extraerGeoJson(resultado, key) {
  const valor = parsearProfundo(resultado, key);
  if (!valor || typeof valor !== "object") return null;

  if (esGeoJson(valor)) return valor;

  const candidato = parsearProfundo(valor.map_geojson ?? valor.data?.map_geojson, key);
  return esGeoJson(candidato) ? candidato : null;
}

// Aplica JSON.parse hasta dos veces mientras el valor siga siendo un
// string: cubre tanto "JSON en texto" como "JSON doblemente escapado"
// (string dentro de string).
function parsearProfundo(valor, key, intentosRestantes = 2) {
  let actual = valor ?? null;

  while (typeof actual === "string" && intentosRestantes > 0) {
    try {
      actual = JSON.parse(actual);
    } catch (error) {
      console.error(`No se pudo parsear el valor de la llave "${key}":`, error);
      return null;
    }
    intentosRestantes--;
  }

  return actual;
}

function esGeoJson(obj) {
  return Boolean(obj) && typeof obj === "object" && (obj.type === "FeatureCollection" || obj.type === "Feature");
}
