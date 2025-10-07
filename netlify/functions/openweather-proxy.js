const fetch = require('node-fetch');

exports.handler = async function(event) {
  // Expected: /?path=/geo/1.0/direct&q=London&limit=5
  const key = process.env.OPENWEATHER_KEY;
  if (!key) return { statusCode: 500, body: JSON.stringify({ error: 'Server missing OPENWEATHER_KEY' }) };

  const qs = new URLSearchParams(event.queryStringParameters || {});
  const path = qs.get('path') || '/data/2.5/weather';
  qs.delete('path');
  // Build OpenWeather URL
  const url = new URL('https://api.openweathermap.org' + path);
  for (const [k, v] of qs.entries()) url.searchParams.set(k, v);
  url.searchParams.set('appid', key);

  try {
    const res = await fetch(url.toString());
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
      body: text
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Bad gateway', detail: String(err) }) };
  }
};
