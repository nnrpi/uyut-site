const DB = "https://uyut-site-default-rtdb.firebaseio.com/uyut";

async function sendMsg(env, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `chat_id=${env.TELEGRAM_CHAT_ID}&text=${encodeURIComponent(text)}`
  });
}

async function runCheck(env) {
  const res = await fetch(`${DB}.json`);
  const dataRoot = (await res.json()) || {};
  const meta = dataRoot._notifyMeta || {};

  const now = new Date();
  const moscow = new Date(now.getTime() + 3 * 60 * 60 * 1000); // UTC+3
  const today = moscow.toISOString().slice(0, 10);
  const day = moscow.getUTCDate();

  let plants = dataRoot.plants || [];
  let lastFlip = meta.lastFlipDate || "";

  if ((day === 1 || day === 15) && lastFlip !== today) {
    plants = plants.map(p => p.id === "succulent" ? { ...p, status: "red" } : p);
    await fetch(`${DB}/plants.json`, { method: "PUT", body: JSON.stringify(plants) });
    await sendMsg(env, "🌵 Суккулент пора полить! Статус сброшен на «Не полит».");
    lastFlip = today;
  }

  const prevPlants = meta.plantStatuses || {};
  for (const pl of plants) {
    const old = prevPlants[pl.id];
    if (old && old !== pl.status && pl.status === "green") {
      await sendMsg(env, `💧 «${pl.label}» полит!`);
    }
  }
  const newPlantStatuses = {};
  plants.forEach(pl => { newPlantStatuses[pl.id] = pl.status; });

  const products = dataRoot.products || [];
  const prevProducts = meta.productStatuses || {};
  for (const p of products) {
    const old = prevProducts[p.id];
    if (old && old !== p.status) {
      if (p.status === "yellow") await sendMsg(env, `🟡 «${p.name}» кончается!`);
      else if (p.status === "green") await sendMsg(env, `🟢 «${p.name}» снова есть!`);
    }
  }
  const newProductStatuses = {};
  products.forEach(p => { newProductStatuses[p.id] = p.status; });

  await fetch(`${DB}/_notifyMeta.json`, {
    method: "PUT",
    body: JSON.stringify({
      lastFlipDate: lastFlip,
      plantStatuses: newPlantStatuses,
      productStatuses: newProductStatuses
    })
  });
}

export default {
  async scheduled(event, env, ctx) {
    await runCheck(env);
  },
  async fetch(request, env, ctx) {
    await runCheck(env);
    return new Response("ok");
  }
};
