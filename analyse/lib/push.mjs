// Web-Push an alle angemeldeten Geräte (außer dem Absender).
import webpush from "web-push";

export const VAPID_PUBLIC = "BAHdvRSml9GULT2Qv1SpcV2-jOC_0J88L_cjOQiTmbpBJ5SJmrAVgNVDkEXlGCHm_U9luLOWQjnqpoJa-QkfofE";

export async function sendePush(store, { titel, text, url = "/", ausser = null }) {
  const privat = process.env.VAPID_PRIVATE;
  if (!privat) return 0;
  webpush.setVapidDetails("https://immo-analyse-hamm.netlify.app", VAPID_PUBLIC, privat);
  const { blobs } = await store.list({ prefix: "abos/" });
  let gesendet = 0;
  await Promise.all(blobs.map(async ({ key }) => {
    const abo = await store.get(key, { type: "json" });
    if (!abo?.subscription) return;
    if (ausser && abo.name && abo.name.toLowerCase() === String(ausser).toLowerCase()) return;
    try {
      await webpush.sendNotification(abo.subscription, JSON.stringify({ title: titel, body: text, url }), { TTL: 60 * 60 * 24 });
      gesendet++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await store.delete(key); // Abo abgelaufen
    }
  }));
  return gesendet;
}
