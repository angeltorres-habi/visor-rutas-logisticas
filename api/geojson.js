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
 * -> { result: <geojson u otro valor guardado> | null }
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
    res.status(200).json({ result: data.result ?? null });
  } catch (error) {
    console.error(`Error consultando KV para la llave "${key}":`, error);
    res.status(500).json({ error: "No se pudo consultar la base KV." });
  }
};
